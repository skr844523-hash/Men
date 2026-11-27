import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';

// Stable session signing secret is required in production. Development may use an ephemeral fallback.
const configuredSessionSecret = process.env.SESSION_SECRET?.trim();
if (process.env.NODE_ENV === 'production' && (!configuredSessionSecret || configuredSessionSecret.length < 32)) {
  throw new Error('SESSION_SECRET must be configured with at least 32 characters in production.');
}
if (!configuredSessionSecret) {
  console.warn('[MEEN] SESSION_SECRET is not configured; sessions will be invalidated when the server restarts.');
}
const SESSION_SECRET = configuredSessionSecret || crypto.randomBytes(32).toString('hex');

export interface AuthUser {
  id: number;
  username: string;
  email: string | null;
  phone: string | null;
  role: 'user' | 'moderator' | 'admin';
  status: 'active' | 'suspended' | 'banned';
  displayName: string;
  avatar: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser | null;
      sessionToken?: string;
    }
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

export function hashToken(token: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
}

export function createSession(userId: number, rememberMe: boolean, userAgent = ''): {
  token: string;
  expiresAt: Date;
} {
  const id = crypto.randomUUID();
  const rawSecret = crypto.randomBytes(32).toString('hex');
  const token = `${id}.${rawSecret}`;
  const tokenHash = hashToken(token);
  const days = rememberMe ? 30 : 2;
  const expiresAt = new Date(Date.now() + days * 86400 * 1000);

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, userId, tokenHash, userAgent.slice(0, 200), expiresAt.toISOString());

  return { token, expiresAt };
}

export function verifySessionToken(token: string): AuthUser | null {
  if (!token || !token.includes('.')) return null;
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.phone, u.role, u.status,
              p.display_name, p.avatar, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN profiles p ON p.user_id = u.id
       WHERE s.token_hash = ?
       LIMIT 1`
    )
    .get(tokenHash) as
    | {
        id: number;
        username: string;
        email: string | null;
        phone: string | null;
        role: 'user' | 'moderator' | 'admin';
        status: 'active' | 'suspended' | 'banned';
        display_name: string;
        avatar: string;
        expires_at: string;
      }
    | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    displayName: row.display_name,
    avatar: row.avatar,
  };
}

export function revokeSession(token: string): void {
  if (!token) return;
  const tokenHash = hashToken(token);
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function setSessionCookie(
  res: Response,
  req: Request,
  token: string,
  expiresAt: Date,
  rememberMe = true
): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

  // Browsers reject SameSite=None cookies without Secure. On plain-HTTP
  // deployments (local network, testing) fall back to SameSite=Lax so the
  // session cookie is actually stored instead of silently dropped.
  const parts = [
    `meen_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    ...(rememberMe ? [`Expires=${expiresAt.toUTCString()}`] : []),
  ];
  if (isHttps) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response, req: Request): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    'meen_session=',
    'Path=/',
    'HttpOnly',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (isHttps) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

export function extractToken(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies['meen_session'] || '';
}

export function attachAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    req.sessionToken = token;
    req.user = verifySessionToken(token);
  } else {
    req.user = null;
  }
  next();
}

export function verifyCsrfForMutations(req: Request, res: Response, next: NextFunction): void {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    // Allow if Bearer token used OR X-Requested-With header present OR same-origin Origin header
    const hasBearer = Boolean(req.headers.authorization?.startsWith('Bearer '));
    const hasCustomHeader = req.headers['x-requested-with'] === 'MEEN-App';
    const origin = req.headers.origin;
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;

    let originMatches = false;
    if (origin && host) {
      try {
        originMatches = new URL(origin).host === host;
      } catch {
        originMatches = false;
      }
    }

    if (!hasBearer && !hasCustomHeader && !originMatches) {
      res.status(403).json({ error: 'طلب غير مصرح به (تحقق CSRF).' });
      return;
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'يرجى تسجيل الدخول أولًا للمتابعة.' });
    return;
  }
  if (req.user.status === 'banned') {
    res.status(403).json({ error: 'تم حظر هذا الحساب لمخالفة سياسات الاستخدام.' });
    return;
  }
  next();
}

export function requireActiveAccount(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'يرجى تسجيل الدخول أولًا.' });
    return;
  }
  if (req.user.status !== 'active') {
    res.status(403).json({ error: 'حسابك موقوف حاليًا ولا يمكنك النشر أو التفاعل.' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'غير مصرح.' });
    return;
  }
  if (req.user.role !== 'admin' && req.user.role !== 'moderator') {
    res.status(403).json({ error: 'ليس لديك صلاحية الوصول إلى لوحة الإدارة.' });
    return;
  }
  next();
}

// Simple sliding-window rate limiter per IP + route bucket
const rateBuckets = new Map<string, number[]>();

export function rateLimit(bucket: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${bucket}:${req.user?.id ?? req.ip ?? 'anon'}`;
    const now = Date.now();
    const list = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= maxRequests) {
      res.status(429).json({
        error: 'تم تجاوز الحد المسموح مؤقتًا. انتظر قليلًا ثم حاول مرة أخرى.',
      });
      return;
    }
    list.push(now);
    rateBuckets.set(key, list);
    next();
  };
}

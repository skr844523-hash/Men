import type { Request, Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { auth } from './admin.ts';
import { get, lookupUnique } from './store.ts';

export interface AuthUser {
  id: number;
  uid: string;
  username: string;
  email: string | null;
  phone: string | null;
  role: 'user' | 'moderator' | 'admin';
  status: 'active' | 'suspended' | 'banned';
  displayName: string;
  avatar: string;
  // From the verified Firebase ID token, not the database row.
  emailVerified: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser | null;
      fbToken?: DecodedIdToken | null;
    }
  }
}

export function extractToken(req: Request): string {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

export async function attachAuth(req: Request, _res: Response, next: NextFunction) {
  req.user = null;
  req.fbToken = null;
  const token = extractToken(req);
  if (!token) return next();
  try {
    const decoded = await auth.verifyIdToken(token, true);
    req.fbToken = decoded;
    const id = await lookupUnique('uid', decoded.uid);
    if (id != null) {
      const u = await get<any>('users', id as number);
      if (u) {
        req.user = {
          id: u.id, uid: u.uid, username: u.username, email: u.email ?? null, phone: u.phone ?? null,
          role: u.role, status: u.status, displayName: u.display_name, avatar: u.avatar,
          emailVerified: Boolean(decoded.email_verified),
        };
      }
    }
  } catch {
    // invalid / expired / revoked token: treated as signed out
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
  // A confirmed email is required before writing anything: it is what stops
  // throwaway accounts from posting spam or evading a ban.
  if (!req.user.emailVerified) {
    res.status(403).json({
      error: 'أكد بريدك الإلكتروني أولًا من الإعدادات، وبعدها تقدر تنشر وتتفاعل.',
      code: 'email_not_verified',
    });
    return;
  }
  next();
}

export function requireStaff(req: Request, res: Response, next: NextFunction): void {
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

export function requireAdminOnly(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'هذه العملية للأدمن فقط.' });
    return;
  }
  next();
}

// Rate limiting must survive serverless cold starts and multiple instances, so
// counters live in Realtime Database (transactional), keyed by bucket + id + window.
import { rtdb } from './admin.ts';
export function rateLimit(bucket: string, maxRequests: number, windowMs: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const who = String(req.user?.id ?? req.headers['x-forwarded-for'] ?? req.ip ?? 'anon').split(',')[0].trim();
      const win = Math.floor(Date.now() / windowMs);
      const key = `${bucket}:${who}:${win}`.replace(/[.#$\[\]/]/g, '_');
      const r = await rtdb.ref(`ratelimits/${key}`).transaction((v) => (Number(v) || 0) + 1);
      if (Number(r.snapshot.val()) === 1) {
        // First hit of this window: drop the counter from the window before it so
        // the node does not grow one key per caller per window forever.
        const prevKey = `${bucket}:${who}:${win - 1}`.replace(/[.#$\[\]/]/g, '_');
        void rtdb.ref(`ratelimits/${prevKey}`).remove().catch(() => {});
      }
      if (Number(r.snapshot.val()) > maxRequests) {
        res.status(429).json({ error: 'تم تجاوز الحد المسموح مؤقتًا. انتظر قليلًا ثم حاول مرة أخرى.' });
        return;
      }
    } catch {
      // never block users because the limiter failed
    }
    next();
  };
}

// Cheap per-instance limiter for read endpoints. Reads are the expensive path
// (a single feed request can touch hundreds of records), and writing a counter to
// the database on every read would cost more than it saves. This keeps the counter
// in the function's memory, which is enough to stop one client hammering a warm
// instance, and adds no database traffic at all.
const memCounters = new Map<string, { count: number; resetAt: number }>();
export function rateLimitMemory(bucket: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const who = String(req.user?.id ?? req.headers['x-forwarded-for'] ?? req.ip ?? 'anon').split(',')[0].trim();
    const key = `${bucket}:${who}`;
    const now = Date.now();
    if (memCounters.size > 5000) memCounters.clear();
    const cur = memCounters.get(key);
    if (!cur || now >= cur.resetAt) {
      memCounters.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    cur.count += 1;
    if (cur.count > maxRequests) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((cur.resetAt - now) / 1000))));
      res.status(429).json({ error: 'تم تجاوز الحد المسموح مؤقتًا. انتظر قليلًا ثم حاول مرة أخرى.' });
      return;
    }
    next();
  };
}

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

import { Router } from 'express';
import { rateLimitMemory, requireAuth } from '../middleware.ts';
import { registerPushToken, unregisterPushToken } from '../push.ts';
import { nowIso, patch } from '../store.ts';

export const pushRouter = Router();

// The Android app registers its FCM token here after the user grants the
// notification permission. Tokens are device identifiers, not secrets.
pushRouter.post('/push/register', requireAuth, rateLimitMemory('push-register', 20, 60_000), async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (token.length < 20 || token.length > 4096) {
    res.status(400).json({ error: 'رمز الإشعارات غير صالح.' });
    return;
  }
  const platform = typeof req.body?.platform === 'string' ? req.body.platform.slice(0, 20) : 'android';
  const tokens = await registerPushToken(req.user!.id, token, platform);
  res.json({ ok: true, tokens });
});

pushRouter.post('/push/unregister', requireAuth, rateLimitMemory('push-register', 20, 60_000), async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (token) await unregisterPushToken(req.user!.id, token);
  res.json({ ok: true });
});

// Presence: the client pings while it is open (and once when it leaves), so
// "online" on the server (last_active_at within two minutes) reflects reality
// instead of only moving when some other API call happens.
pushRouter.post('/presence/ping', requireAuth, rateLimitMemory('presence-ping', 30, 60_000), async (req, res) => {
  const active = req.body?.active !== false;
  await patch('users', req.user!.id, { last_active_at: active ? nowIso() : new Date(0).toISOString() });
  res.json({ ok: true });
});

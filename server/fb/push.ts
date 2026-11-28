import { getMessaging } from 'firebase-admin/messaging';
import { app } from './admin.ts';
import { get, patch } from './store.ts';

// Android push via FCM. Tokens are registered by the Capacitor app through
// /api/push/register and stored on the user row (a few devices per user max).
// Sending never blocks or breaks notification creation: every failure is
// swallowed here and only dead tokens are pruned.
const MAX_TOKENS_PER_USER = 5;

export async function registerPushToken(userId: number, token: string, platform: string): Promise<number> {
  const u = await get<any>('users', userId);
  if (!u) return 0;
  const tokens: string[] = Array.isArray(u.fcm_tokens) ? u.fcm_tokens.filter((t: unknown) => typeof t === 'string') : [];
  if (!tokens.includes(token)) tokens.push(token);
  while (tokens.length > MAX_TOKENS_PER_USER) tokens.shift();
  await patch('users', userId, { fcm_tokens: tokens, fcm_platform: platform });
  return tokens.length;
}

export async function unregisterPushToken(userId: number, token: string): Promise<void> {
  const u = await get<any>('users', userId);
  if (!u || !Array.isArray(u.fcm_tokens)) return;
  const next = u.fcm_tokens.filter((t: string) => t !== token);
  if (next.length !== u.fcm_tokens.length) await patch('users', userId, { fcm_tokens: next });
}

export async function sendPushToUser(
  userId: number,
  payload: { title: string; body: string; data?: Record<string, string> }
): Promise<void> {
  try {
    const u = await get<any>('users', userId);
    const tokens: string[] = Array.isArray(u?.fcm_tokens) ? u.fcm_tokens.filter((t: unknown) => typeof t === 'string') : [];
    if (!u || tokens.length === 0) return;
    const res = await getMessaging(app).sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
      android: { priority: 'high', notification: { channelId: 'meen_default' } },
    });
    const dead: string[] = [];
    res.responses.forEach((r, i) => {
      const code = r.error?.code || '';
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        dead.push(tokens[i]);
      }
    });
    if (dead.length) {
      await patch('users', userId, { fcm_tokens: tokens.filter((t) => !dead.includes(t)) });
    }
  } catch {
    // Push is best-effort; the in-app notification and realtime event already landed.
  }
}

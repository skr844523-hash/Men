import { rtdb } from './admin.ts';
import { get, insert, nowIso, where } from './store.ts';
import { DEFAULT_NOTIFICATION_SETTINGS, areFriends, getSetting } from './core.ts';

// Realtime without a WebSocket server: events are pushed to Realtime Database channels
// that clients subscribe to. Private channel: live/<firebaseUid> (rules: only that user reads).
// Public hint channels carry no private content (ids and counters only); clients refetch details
// through the API, which enforces visibility.
async function pushEvent(channel: string, payload: Record<string, unknown>) {
  const r = rtdb.ref(`live/${channel}`);
  await r.push({ ...payload, _ts: Date.now() });
  // keep each channel small
  const snap = await r.orderByKey().limitToFirst(1).get();
  const count = (await r.get()).numChildren();
  if (count > 60 && snap.exists()) {
    const first = Object.keys(snap.val())[0];
    await r.child(first).remove();
  }
}

export async function sendToUser(userId: number, payload: Record<string, unknown>): Promise<void> {
  const u = await get<any>('users', userId);
  if (!u?.uid) return;
  await pushEvent(u.uid, payload);
}

export async function broadcastToAll(payload: Record<string, unknown>): Promise<void> {
  await pushEvent('_all', payload);
}

export async function broadcastPostEvent(postId: number, payload: Record<string, unknown>): Promise<void> {
  const post = await get<any>('posts', postId);
  if (!post || post.is_hidden) return;
  // Only broadcast hints for content that is public to everyone.
  if (post.community_id || post.audience !== 'public') return;
  const safe: Record<string, unknown> = { type: payload.type, postId };
  for (const k of ['likesCount', 'supportsCount', 'commentsCount', 'commentId']) if (k in payload) safe[k] = payload[k];
  await pushEvent('_posts', safe);
}

const PREF_KEY: Record<string, string> = {
  message: 'messages', comment: 'comments', reply: 'comments', reaction: 'reactions',
  friend_request: 'friends', friend_accept: 'friends', community_invite: 'communities',
  challenge: 'challenges', daily_question: 'daily',
};

export async function pushNotification(params: {
  userId: number; type: string; title: string; body: string;
  targetType?: string; targetId?: number; actorId?: number | null; isAnonymousActor?: boolean;
}): Promise<void> {
  if (params.actorId && params.actorId === params.userId) return;
  const g: any = await getSetting('notification_settings', DEFAULT_NOTIFICATION_SETTINGS);
  if (params.type === 'reaction' && g.allowReactionNotifs === false) return;
  if ((params.type === 'comment' || params.type === 'reply') && g.allowCommentNotifs === false) return;
  if ((params.type === 'friend_request' || params.type === 'friend_accept') && g.allowFriendNotifs === false) return;
  if (params.type === 'message' && g.allowMessageNotifs === false) return;
  if (params.type === 'admin_announcement' && g.allowBroadcastBanner === false) return;

  const target = await get<any>('users', params.userId);
  if (!target) return;
  const prefKey = PREF_KEY[params.type];
  if (prefKey && target.notify_prefs && target.notify_prefs[prefKey] === false) return;

  const isFriendActor = Boolean(!params.isAnonymousActor && params.actorId && (await areFriends(params.userId, params.actorId)));
  const createdAt = nowIso();
  const row = await insert('notifications', {
    user_id: params.userId, type: params.type, title: params.title, body: params.body,
    target_type: params.targetType ?? null, target_id: params.targetId ?? null,
    actor_id: params.isAnonymousActor ? null : params.actorId ?? null,
    is_anonymous_actor: params.isAnonymousActor ? 1 : 0, is_read: 0, created_at: createdAt,
  });
  await sendToUser(params.userId, {
    type: 'notification:new',
    notification: {
      id: row.id, type: params.type, title: params.title, body: params.body,
      targetType: params.targetType ?? null, targetId: params.targetId ?? null,
      isFriendActor, isAnonymousActor: Boolean(params.isAnonymousActor), isRead: false, createdAt,
    },
  });
}
export { where };

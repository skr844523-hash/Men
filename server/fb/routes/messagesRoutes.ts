import { Router } from 'express';
import { claimUnique, get, insert, lookupUnique, nowIso, patch, setUnique, where } from '../store.ts';
import { rateLimit, requireActiveAccount, requireAuth } from '../middleware.ts';
import { pushNotification, sendToUser } from '../realtime.ts';
import { buildCtx, isBlocked } from '../posts.ts';
import { sanitizeMediaUrl } from '../../../src/lib/validation.ts';

export const messagesRouter = Router();
const num = (v: unknown) => Number(v);
const peerOf = (c: any, me: number) => (c.user1_id === me ? c.user2_id : c.user1_id);
const GONE = 'تم حذف هذه الرسالة';
// "online" = active in the last 2 minutes (no socket server any more).
const isOnline = (u: any) => Boolean(u?.show_activity) && Date.now() - new Date(u.last_active_at).getTime() < 120000;

async function myConv(convId: number, userId: number) {
  const conv = await get<any>('conversations', convId);
  return conv && (conv.user1_id === userId || conv.user2_id === userId) ? conv : null;
}
async function myConversations(userId: number) {
  return [...(await where<any>('conversations', 'user1_id', userId)), ...(await where<any>('conversations', 'user2_id', userId))];
}
async function markRead(convId: number, userId: number): Promise<number> {
  const msgs = await where<any>('messages', 'conversation_id', convId);
  const unread = msgs.filter((m) => m.sender_id !== userId && m.status !== 'read');
  await Promise.all(unread.map((m) => patch('messages', m.id, { status: 'read' })));
  return unread.length;
}

messagesRouter.get('/messages/conversations', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const q = String(req.query.q || '').trim().toLowerCase();
  const ctx = await buildCtx(userId);
  const convs = (await myConversations(userId)).filter((c) => c.status !== 'declined').sort((a, b) => String(b.last_message_at).localeCompare(String(a.last_message_at)));
  const list: any[] = [];
  for (const c of convs) {
    const peerId = peerOf(c, userId);
    if (isBlocked(ctx, peerId)) continue;
    const peer = await get<any>('users', peerId);
    if (!peer || peer.status === 'banned') continue;
    const msgs = (await where<any>('messages', 'conversation_id', c.id)).sort((a, b) => b.id - a.id);
    const last = msgs[0];
    list.push({
      id: c.id, status: c.status, isInitiator: c.user1_id === userId, lastMessageAt: c.last_message_at,
      unreadCount: msgs.filter((m) => m.sender_id !== userId && m.status !== 'read' && !m.deleted_by_sender).length,
      peer: { id: peer.id, username: peer.username, displayName: peer.display_name, avatar: peer.avatar, isOnline: isOnline(peer) },
      lastMessage: last ? { id: last.id, senderId: last.sender_id, content: last.deleted_by_sender ? GONE : last.content, messageType: last.message_type, status: last.status, createdAt: last.created_at } : null,
    });
  }
  res.json({ conversations: q ? list.filter((c) => c.peer.displayName.toLowerCase().includes(q) || c.peer.username.toLowerCase().includes(q)) : list });
});

messagesRouter.post('/messages/conversations', requireActiveAccount, async (req, res) => {
  const userId = req.user!.id;
  const peerId = num(req.body?.peerId);
  if (!peerId || peerId === userId) return void res.status(400).json({ error: 'مستخدم غير صالح.' });
  const ctx = await buildCtx(userId);
  if (isBlocked(ctx, peerId)) return void res.status(403).json({ error: 'لا يمكن مراسلة هذا المستخدم بسبب الحظر.' });
  const peer = await get<any>('users', peerId);
  if (!peer || peer.status === 'banned') return void res.status(404).json({ error: 'المستخدم غير موجود.' });
  const pair = `${Math.min(userId, peerId)}_${Math.max(userId, peerId)}`;
  const existingId = await lookupUnique('conv', pair);
  if (existingId != null && existingId !== 'pending') {
    const existing = await get<any>('conversations', Number(existingId));
    if (existing) {
      if (existing.status === 'declined') return void res.status(403).json({ error: 'تم رفض طلب المراسلة من قبل هذا المستخدم.' });
      return void res.json({ conversationId: existing.id, status: existing.status });
    }
  }
  const friend = ctx.friends.has(peerId);
  if (peer.allow_messages_from === 'none') return void res.status(403).json({ error: 'هذا المستخدم أغلق استقبال الرسائل حاليًا.' });
  if (peer.allow_messages_from === 'friends' && !friend) return void res.status(403).json({ error: 'هذا المستخدم يسمح بالرسائل من الأصدقاء فقط.' });
  if (!(await claimUnique('conv', pair, 'pending')) && existingId == null) {
    // lost a race with a concurrent create: re-read
    const again = await lookupUnique('conv', pair);
    if (again != null && again !== 'pending') return void res.json({ conversationId: Number(again), status: (await get<any>('conversations', Number(again)))?.status });
  }
  const status = friend ? 'active' : 'request';
  const now = nowIso();
  const conv = await insert('conversations', { user1_id: userId, user2_id: peerId, status, last_message_at: now, created_at: now });
  await setUnique('conv', pair, conv.id);
  await sendToUser(peerId, { type: 'conversation:updated', conversationId: conv.id });
  res.status(201).json({ conversationId: conv.id, status });
});

messagesRouter.post('/messages/conversations/:id/respond', requireAuth, async (req, res) => {
  const convId = num(req.params.id);
  const userId = req.user!.id;
  const conv = await myConv(convId, userId);
  if (!conv) return void res.status(404).json({ error: 'المحادثة غير موجودة.' });
  if (conv.user2_id !== userId) return void res.status(403).json({ error: 'فقط المستلم يمكنه قبول أو رفض طلب المراسلة.' });
  const next = req.body?.action === 'accept' ? 'active' : 'declined';
  await patch('conversations', convId, { status: next });
  await sendToUser(conv.user1_id, { type: 'conversation:updated', conversationId: convId });
  res.json({ ok: true, status: next });
});

messagesRouter.get('/messages/conversations/:id', requireAuth, async (req, res) => {
  const convId = num(req.params.id);
  const userId = req.user!.id;
  const conv = await myConv(convId, userId);
  if (!conv) return void res.status(404).json({ error: 'المحادثة غير موجودة.' });
  const peerId = peerOf(conv, userId);
  const ctx = await buildCtx(userId);
  if (isBlocked(ctx, peerId)) return void res.status(403).json({ error: 'تم حظر التواصل في هذه المحادثة.' });
  if ((await markRead(convId, userId)) > 0) await sendToUser(peerId, { type: 'message:read', conversationId: convId });
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.min(300, Math.max(20, Math.trunc(rawLimit))) : 150;
  const all = (await where<any>('messages', 'conversation_id', convId)).sort((a, b) => a.id - b.id);
  const byId = new Map(all.map((m) => [m.id, m]));
  res.json({
    conversationId: convId, status: conv.status,
    messages: all.slice(0, limit).map((m) => {
      const rm = m.reply_to_id ? byId.get(m.reply_to_id) : undefined;
      return {
        id: m.id, conversationId: m.conversation_id, senderId: m.sender_id,
        content: m.deleted_by_sender ? GONE : m.content, mediaUrl: m.deleted_by_sender ? null : m.media_url ?? null,
        messageType: m.message_type, replyToId: m.reply_to_id ?? null,
        replyContent: rm ? (rm.deleted_by_sender ? GONE : rm.content) : null,
        status: m.status, deleted: Boolean(m.deleted_by_sender), createdAt: m.created_at,
      };
    }),
  });
});

messagesRouter.post('/messages/conversations/:id/read', requireAuth, async (req, res) => {
  const convId = num(req.params.id);
  const userId = req.user!.id;
  const conv = await myConv(convId, userId);
  if (!conv) return void res.status(404).json({ error: 'المحادثة غير موجودة.' });
  const peerId = peerOf(conv, userId);
  if (isBlocked(await buildCtx(userId), peerId)) return void res.status(403).json({ error: 'تم حظر التواصل في هذه المحادثة.' });
  const n = await markRead(convId, userId);
  if (n > 0) await sendToUser(peerId, { type: 'message:read', conversationId: convId });
  res.json({ ok: true, updated: n });
});

// Replaces the old WebSocket "typing" frame.
messagesRouter.post('/messages/conversations/:id/typing', requireAuth, rateLimit('typing', 60, 60000), async (req, res) => {
  const convId = num(req.params.id);
  const userId = req.user!.id;
  const conv = await myConv(convId, userId);
  if (!conv || conv.status === 'declined') return void res.status(404).json({ error: 'المحادثة غير موجودة.' });
  const peerId = peerOf(conv, userId);
  if (isBlocked(await buildCtx(userId), peerId)) return void res.json({ ok: true });
  await sendToUser(peerId, { type: 'typing', conversationId: convId, userId });
  res.json({ ok: true });
});

messagesRouter.post('/messages/conversations/:id', requireActiveAccount, rateLimit('send_msg', 40, 60000), async (req, res) => {
  const convId = num(req.params.id);
  const userId = req.user!.id;
  const { content = '', mediaUrl = null, messageType = 'text', replyToId = null } = req.body ?? {};
  const conv = await myConv(convId, userId);
  if (!conv) return void res.status(404).json({ error: 'المحادثة غير موجودة.' });
  if (conv.status === 'declined') return void res.status(403).json({ error: 'تم رفض هذه المحادثة.' });
  const peerId = peerOf(conv, userId);
  if (isBlocked(await buildCtx(userId), peerId)) return void res.status(403).json({ error: 'لا يمكنك مراسلة مستخدم محظور.' });
  const clean = String(content || '').trim();
  const media = sanitizeMediaUrl(mediaUrl);
  const type = messageType === 'image' || messageType === 'audio' ? messageType : 'text';
  if (!clean && !media) return void res.status(400).json({ error: 'الرسالة فارغة.' });
  let replyTarget: any = null;
  if (replyToId) {
    replyTarget = await get<any>('messages', num(replyToId));
    if (!replyTarget || replyTarget.conversation_id !== convId) return void res.status(400).json({ error: 'الرسالة التي تحاول الرد عليها غير موجودة في هذه المحادثة.' });
  }
  const peer = await get<any>('users', peerId);
  const status = isOnline(peer) ? 'delivered' : 'sent';
  const createdAt = nowIso();
  const m = await insert('messages', {
    conversation_id: convId, sender_id: userId, content: clean.slice(0, 2000), media_url: media ?? null, message_type: type,
    reply_to_id: replyTarget ? replyTarget.id : null, status, deleted_by_sender: 0, created_at: createdAt,
  });
  await patch('conversations', convId, { last_message_at: createdAt });
  const payload = {
    id: m.id, conversationId: convId, senderId: userId, content: clean.slice(0, 2000), mediaUrl: media ?? null, messageType: type,
    replyToId: replyTarget ? replyTarget.id : null,
    replyContent: replyTarget ? (replyTarget.deleted_by_sender ? GONE : replyTarget.content) : null,
    status, deleted: false, createdAt,
  };
  await sendToUser(peerId, { type: 'message:new', message: payload });
  await sendToUser(userId, { type: 'message:new', message: payload });
  await pushNotification({
    userId: peerId, type: 'message', title: 'رسالة جديدة',
    body: type === 'text' ? `${req.user!.displayName}: ${clean.slice(0, 50)}` : `أرسل لك ${req.user!.displayName} مرفقًا في المحادثة.`,
    targetType: 'messages', targetId: convId, actorId: userId,
  });
  res.status(201).json({ message: payload });
});

messagesRouter.delete('/messages/:messageId', requireAuth, async (req, res) => {
  const msgId = num(req.params.messageId);
  const userId = req.user!.id;
  const msg = await get<any>('messages', msgId);
  if (!msg || msg.sender_id !== userId) return void res.status(403).json({ error: 'يمكنك حذف رسائلك فقط.' });
  await patch('messages', msgId, { deleted_by_sender: 1, content: '', media_url: null });
  const conv = await get<any>('conversations', msg.conversation_id);
  if (conv) await sendToUser(peerOf(conv, userId), { type: 'message:deleted', conversationId: msg.conversation_id, messageId: msgId });
  res.json({ ok: true });
});

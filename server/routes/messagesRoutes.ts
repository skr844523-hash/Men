import { Router } from 'express';
import { areFriends, db, isBlockedBetween } from '../db.ts';
import { rateLimit, requireActiveAccount, requireAuth } from '../auth.ts';
import { isUserOnline, pushNotification, sendToUser } from '../realtime.ts';
import { sanitizeMediaUrl } from '../../src/lib/validation.ts';

export const messagesRouter = Router();

function getPeerId(conv: { user1_id: number; user2_id: number }, myId: number): number {
  return conv.user1_id === myId ? conv.user2_id : conv.user1_id;
}

messagesRouter.get('/messages/conversations', requireAuth, (req, res) => {
  const userId = req.user!.id;
  const q = String(req.query.q || '').trim().toLowerCase();

  const rows = db
    .prepare(
      `SELECT c.*,
              CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END AS peer_id
       FROM conversations c
       WHERE (c.user1_id = ? OR c.user2_id = ?) AND c.status != 'declined'
       ORDER BY c.last_message_at DESC`
    )
    .all(userId, userId, userId) as Array<{
    id: number;
    user1_id: number;
    user2_id: number;
    status: 'active' | 'request' | 'declined';
    last_message_at: string;
    peer_id: number;
  }>;

  const list = rows
    .filter((c) => !isBlockedBetween(userId, c.peer_id))
    .map((c) => {
      const peer = db
        .prepare(
          `SELECT u.id, u.username, u.status, p.display_name, p.avatar, p.show_activity
           FROM users u JOIN profiles p ON p.user_id = u.id
           WHERE u.id = ?`
        )
        .get(c.peer_id) as Record<string, unknown> | undefined;

      if (!peer || peer.status === 'banned') return null;

      const lastMsg = db
        .prepare(
          `SELECT id, sender_id, content, message_type, status, deleted_by_sender, created_at
           FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1`
        )
        .get(c.id) as Record<string, unknown> | undefined;

      const unreadRow = db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM messages
           WHERE conversation_id = ? AND sender_id != ? AND status != 'read' AND deleted_by_sender = 0`
        )
        .get(c.id, userId) as { cnt: number };

      return {
        id: c.id,
        status: c.status,
        isInitiator: c.user1_id === userId,
        lastMessageAt: c.last_message_at,
        unreadCount: Number(unreadRow?.cnt ?? 0),
        peer: {
          id: peer.id,
          username: peer.username,
          displayName: peer.display_name,
          avatar: peer.avatar,
          isOnline: Number(peer.show_activity) === 1 ? isUserOnline(Number(peer.id)) : false,
        },
        lastMessage: lastMsg
          ? {
              id: lastMsg.id,
              senderId: lastMsg.sender_id,
              content: Number(lastMsg.deleted_by_sender) === 1 ? 'تم حذف هذه الرسالة' : lastMsg.content,
              messageType: lastMsg.message_type,
              status: lastMsg.status,
              createdAt: lastMsg.created_at,
            }
          : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .filter((c) => {
      if (!q) return true;
      return (
        String(c.peer.displayName).toLowerCase().includes(q) ||
        String(c.peer.username).toLowerCase().includes(q)
      );
    });

  res.json({ conversations: list });
});

messagesRouter.post('/messages/conversations', requireActiveAccount, (req, res) => {
  const userId = req.user!.id;
  const peerId = Number(req.body?.peerId);
  if (!peerId || peerId === userId) {
    res.status(400).json({ error: 'مستخدم غير صالح.' });
    return;
  }

  if (isBlockedBetween(userId, peerId)) {
    res.status(403).json({ error: 'لا يمكن مراسلة هذا المستخدم بسبب الحظر.' });
    return;
  }

  const peerProf = db
    .prepare(
      `SELECT u.status, p.allow_messages_from
       FROM users u JOIN profiles p ON p.user_id = u.id
       WHERE u.id = ?`
    )
    .get(peerId) as { status: string; allow_messages_from: string } | undefined;

  if (!peerProf || peerProf.status === 'banned') {
    res.status(404).json({ error: 'المستخدم غير موجود.' });
    return;
  }

  // Check existing conversation first
  const existing = db
    .prepare(
      `SELECT * FROM conversations
       WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)`
    )
    .get(userId, peerId, peerId, userId) as { id: number; status: string } | undefined;

  if (existing) {
    if (existing.status === 'declined') {
      res.status(403).json({ error: 'تم رفض طلب المراسلة من قبل هذا المستخدم.' });
      return;
    }
    res.json({ conversationId: existing.id, status: existing.status });
    return;
  }

  const friend = areFriends(userId, peerId);
  if (peerProf.allow_messages_from === 'none') {
    res.status(403).json({ error: 'هذا المستخدم أغلق استقبال الرسائل حاليًا.' });
    return;
  }
  if (peerProf.allow_messages_from === 'friends' && !friend) {
    res.status(403).json({ error: 'هذا المستخدم يسمح بالرسائل من الأصدقاء فقط.' });
    return;
  }

  // Friends get 'active' immediately; non-friends start as 'request' if allow_messages_from === 'everyone'
  const convStatus = friend ? 'active' : 'request';
  const insert = db
    .prepare(`INSERT INTO conversations (user1_id, user2_id, status) VALUES (?, ?, ?)`)
    .run(userId, peerId, convStatus);
  const conversationId = Number(insert.lastInsertRowid);
  sendToUser(peerId, { type: 'conversation:updated', conversationId });

  res.status(201).json({ conversationId, status: convStatus });
});

messagesRouter.post('/messages/conversations/:id/respond', requireAuth, (req, res) => {
  const convId = Number(req.params.id);
  const userId = req.user!.id;
  const accept = req.body?.action === 'accept';

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId) as
    | { id: number; user1_id: number; user2_id: number; status: string }
    | undefined;

  if (!conv || (conv.user1_id !== userId && conv.user2_id !== userId)) {
    res.status(404).json({ error: 'المحادثة غير موجودة.' });
    return;
  }
  if (conv.user2_id !== userId) {
    res.status(403).json({ error: 'فقط المستلم يمكنه قبول أو رفض طلب المراسلة.' });
    return;
  }

  const nextStatus = accept ? 'active' : 'declined';
  db.prepare('UPDATE conversations SET status = ? WHERE id = ?').run(nextStatus, convId);
  res.json({ ok: true, status: nextStatus });
});

messagesRouter.get('/messages/conversations/:id', requireAuth, (req, res) => {
  const convId = Number(req.params.id);
  const userId = req.user!.id;

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId) as
    | { id: number; user1_id: number; user2_id: number; status: string }
    | undefined;

  if (!conv || (conv.user1_id !== userId && conv.user2_id !== userId)) {
    res.status(404).json({ error: 'المحادثة غير موجودة.' });
    return;
  }

  const peerId = getPeerId(conv, userId);
  if (isBlockedBetween(userId, peerId)) {
    res.status(403).json({ error: 'تم حظر التواصل في هذه المحادثة.' });
    return;
  }

  // Mark incoming messages as read
  const updated = db
    .prepare(
      `UPDATE messages SET status = 'read'
       WHERE conversation_id = ? AND sender_id != ? AND status != 'read'`
    )
    .run(convId, userId);

  if (Number(updated.changes) > 0) {
    sendToUser(peerId, { type: 'message:read', conversationId: convId });
  }

  const rows = db
    .prepare(
      `SELECT m.*, rm.content AS reply_content, rm.sender_id AS reply_sender_id
       FROM messages m
       LEFT JOIN messages rm ON rm.id = m.reply_to_id
       WHERE m.conversation_id = ?
       ORDER BY m.id ASC LIMIT 150`
    )
    .all(convId) as Array<Record<string, unknown>>;

  res.json({
    conversationId: convId,
    status: conv.status,
    messages: rows.map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      content: Number(m.deleted_by_sender) === 1 ? 'تم حذف هذه الرسالة' : m.content,
      mediaUrl: Number(m.deleted_by_sender) === 1 ? null : m.media_url,
      messageType: m.message_type,
      replyToId: m.reply_to_id,
      replyContent: m.reply_content ?? null,
      status: m.status,
      deleted: Number(m.deleted_by_sender) === 1,
      createdAt: m.created_at,
    })),
  });
});

messagesRouter.post('/messages/conversations/:id/read', requireAuth, (req, res) => {
  const convId = Number(req.params.id);
  const userId = req.user!.id;

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId) as
    | { id: number; user1_id: number; user2_id: number; status: string }
    | undefined;

  if (!conv || (conv.user1_id !== userId && conv.user2_id !== userId)) {
    res.status(404).json({ error: 'المحادثة غير موجودة.' });
    return;
  }

  const peerId = getPeerId(conv, userId);
  if (isBlockedBetween(userId, peerId)) {
    res.status(403).json({ error: 'تم حظر التواصل في هذه المحادثة.' });
    return;
  }

  const updated = db
    .prepare(
      `UPDATE messages SET status = 'read'
       WHERE conversation_id = ? AND sender_id != ? AND status != 'read'`
    )
    .run(convId, userId);

  if (Number(updated.changes) > 0) {
    sendToUser(peerId, { type: 'message:read', conversationId: convId });
  }

  res.json({ ok: true, updated: Number(updated.changes) });
});

messagesRouter.post(
  '/messages/conversations/:id',
  requireActiveAccount,
  rateLimit('send_msg', 40, 60000),
  (req, res) => {
    const convId = Number(req.params.id);
    const userId = req.user!.id;
    const { content = '', mediaUrl = null, messageType = 'text', replyToId = null } = req.body ?? {};

    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId) as
      | { id: number; user1_id: number; user2_id: number; status: string }
      | undefined;

    if (!conv || (conv.user1_id !== userId && conv.user2_id !== userId)) {
      res.status(404).json({ error: 'المحادثة غير موجودة.' });
      return;
    }
    if (conv.status === 'declined') {
      res.status(403).json({ error: 'تم رفض هذه المحادثة.' });
      return;
    }

    const peerId = getPeerId(conv, userId);
    if (isBlockedBetween(userId, peerId)) {
      res.status(403).json({ error: 'لا يمكنك مراسلة مستخدم محظور.' });
      return;
    }

    const cleanContent = String(content || '').trim();
    const safeMedia = sanitizeMediaUrl(mediaUrl);
    const validType =
      messageType === 'image' || messageType === 'audio' ? messageType : 'text';

    if (!cleanContent && !safeMedia) {
      res.status(400).json({ error: 'الرسالة فارغة.' });
      return;
    }

    const deliveredOnline = isUserOnline(peerId);
    const initialStatus = deliveredOnline ? 'delivered' : 'sent';

    const insert = db
      .prepare(
        `INSERT INTO messages (conversation_id, sender_id, content, media_url, message_type, reply_to_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        convId,
        userId,
        cleanContent.slice(0, 2000),
        safeMedia,
        validType,
        replyToId ? Number(replyToId) : null,
        initialStatus
      );

    const msgId = Number(insert.lastInsertRowid);
    db.prepare(`UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?`).run(convId);

    let replyContent: string | null = null;
    if (replyToId) {
      const replyRow = db
        .prepare('SELECT content, deleted_by_sender FROM messages WHERE id = ? AND conversation_id = ?')
        .get(Number(replyToId), convId) as { content: string; deleted_by_sender: number } | undefined;
      if (replyRow) {
        replyContent = replyRow.deleted_by_sender ? 'تم حذف هذه الرسالة' : replyRow.content;
      }
    }

    const msgPayload = {
      id: msgId,
      conversationId: convId,
      senderId: userId,
      content: cleanContent,
      mediaUrl: safeMedia,
      messageType: validType,
      replyToId: replyToId ? Number(replyToId) : null,
      replyContent,
      status: initialStatus,
      deleted: false,
      createdAt: new Date().toISOString(),
    };

    // Real-time WebSocket push to recipient and sender tabs
    sendToUser(peerId, { type: 'message:new', message: msgPayload });
    sendToUser(userId, { type: 'message:new', message: msgPayload });

    pushNotification({
      userId: peerId,
      type: 'message',
      title: 'رسالة جديدة',
      body:
        validType === 'text'
          ? `${req.user!.displayName}: ${cleanContent.slice(0, 50)}`
          : `أرسل لك ${req.user!.displayName} مرفقًا في المحادثة.`,
      targetType: 'messages',
      targetId: convId,
      actorId: userId,
    });

    res.status(201).json({ message: msgPayload });
  }
);

messagesRouter.delete('/messages/:messageId', requireAuth, (req, res) => {
  const msgId = Number(req.params.messageId);
  const userId = req.user!.id;

  const msg = db
    .prepare(
      `SELECT m.id, m.sender_id, m.conversation_id, c.user1_id, c.user2_id
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = ?`
    )
    .get(msgId) as
    | { id: number; sender_id: number; conversation_id: number; user1_id: number; user2_id: number }
    | undefined;

  if (!msg || msg.sender_id !== userId) {
    res.status(403).json({ error: 'يمكنك حذف رسائلك فقط.' });
    return;
  }

  db.prepare('UPDATE messages SET deleted_by_sender = 1, content = "", media_url = NULL WHERE id = ?').run(
    msgId
  );

  const peerId = msg.user1_id === userId ? msg.user2_id : msg.user1_id;
  sendToUser(peerId, {
    type: 'message:deleted',
    conversationId: msg.conversation_id,
    messageId: msgId,
  });

  res.json({ ok: true });
});

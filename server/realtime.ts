import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { areFriends, db, DEFAULT_NOTIFICATION_SETTINGS, getSetting, isBlockedBetween } from './db.ts';
import { verifySessionToken } from './auth.ts';
import { canViewPost, type PostRow } from './serializers.ts';

interface ClientSocket extends WebSocket {
  userId?: number;
  isAlive?: boolean;
}

const userSockets = new Map<number, Set<ClientSocket>>();

export function attachWebSocketServer(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws') {
      return; // Let Vite handle any other upgrade paths if present
    }

    // Authenticate from HttpOnly session cookie only; never accept session tokens in URLs.
    let token = '';
    if (request.headers.cookie) {
      const cookies = Object.fromEntries(
        request.headers.cookie.split(';').map((c) => {
          const idx = c.indexOf('=');
          if (idx === -1) return [c.trim(), ''];
          return [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1).trim())];
        })
      );
      token = cookies['meen_session'] || '';
    }

    const user = token ? verifySessionToken(token) : null;
    if (!user || user.status === 'banned') {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const client = ws as ClientSocket;
      client.userId = user.id;
      client.isAlive = true;
      wss.emit('connection', client, request);
    });
  });

  wss.on('connection', (client: ClientSocket) => {
    const userId = client.userId!;
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(client);

    db.prepare(`UPDATE users SET last_active_at = datetime('now') WHERE id = ?`).run(userId);

    client.on('pong', () => {
      client.isAlive = true;
    });

    client.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          conversationId?: number;
          recipientId?: number;
        };
        const convId = Number(msg.conversationId);
        if (!convId || Number.isNaN(convId)) return;

        const conv = db
          .prepare('SELECT id, user1_id, user2_id, status FROM conversations WHERE id = ?')
          .get(convId) as
          | { id: number; user1_id: number; user2_id: number; status: string }
          | undefined;
        if (!conv || (conv.user1_id !== userId && conv.user2_id !== userId) || conv.status === 'declined') {
          return;
        }
        const peerId = conv.user1_id === userId ? conv.user2_id : conv.user1_id;
        if (isBlockedBetween(userId, peerId)) return;

        if (msg.type === 'typing') {
          sendToUser(peerId, {
            type: 'typing',
            conversationId: convId,
            userId,
          });
        } else if (msg.type === 'message:mark_read') {
          const updated = db
            .prepare(
              `UPDATE messages SET status = 'read'
               WHERE conversation_id = ? AND sender_id != ? AND status != 'read'`
            )
            .run(convId, userId);
          if (Number(updated.changes) > 0) {
            sendToUser(peerId, { type: 'message:read', conversationId: convId });
          }
        }
      } catch {
        // Ignore malformed client frames
      }
    });

    client.on('close', () => {
      const set = userSockets.get(userId);
      if (set) {
        set.delete(client);
        if (set.size === 0) {
          userSockets.delete(userId);
        }
      }
    });

    client.send(JSON.stringify({ type: 'connected', userId }));
  });

  // Heartbeat every 30s
  const interval = setInterval(() => {
    for (const client of wss.clients) {
      const c = client as ClientSocket;
      if (c.isAlive === false) {
        c.terminate();
        continue;
      }
      c.isAlive = false;
      c.ping();
    }
  }, 30000);

  wss.on('close', () => clearInterval(interval));
}

export function isUserOnline(userId: number): boolean {
  const set = userSockets.get(userId);
  return Boolean(set && set.size > 0);
}

export function getOnlineUsersCount(): number {
  return userSockets.size;
}

export function sendToUser(userId: number, payload: unknown): void {
  const set = userSockets.get(userId);
  if (!set || set.size === 0) return;
  const serialized = JSON.stringify(payload);
  for (const sock of set) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(serialized);
    }
  }
}

export function broadcastToAll(payload: unknown, excludeUserId?: number): void {
  const serialized = JSON.stringify(payload);
  for (const [uid, set] of userSockets.entries()) {
    if (excludeUserId && uid === excludeUserId) continue;
    for (const sock of set) {
      if (sock.readyState === WebSocket.OPEN) {
        sock.send(serialized);
      }
    }
  }
}

export function getPostAccessRow(postId: number): PostRow | undefined {
  return db
    .prepare(
      `SELECT p.*, u.username, pr.display_name, pr.avatar, pr.show_posts_to
       FROM posts p
       JOIN users u ON u.id = p.author_id
       JOIN profiles pr ON pr.user_id = p.author_id
       WHERE p.id = ?`
    )
    .get(postId) as PostRow | undefined;
}

export function broadcastPostRowEvent(
  postRow: PostRow | undefined,
  payload: unknown,
  excludeUserId?: number
): void {
  if (!postRow || postRow.is_hidden === 1) return;
  const serialized = JSON.stringify(payload);
  for (const [uid, set] of userSockets.entries()) {
    if (excludeUserId && uid === excludeUserId) continue;
    if (isBlockedBetween(uid, postRow.author_id)) continue;
    if (!canViewPost(postRow, uid)) continue;
    for (const sock of set) {
      if (sock.readyState === WebSocket.OPEN) {
        sock.send(serialized);
      }
    }
  }
}

export function broadcastPostEvent(
  postId: number,
  payload: unknown,
  excludeUserId?: number
): void {
  const postRow = getPostAccessRow(postId);
  broadcastPostRowEvent(postRow, payload, excludeUserId);
}

export function pushNotification(params: {
  userId: number;
  type: string;
  title: string;
  body: string;
  targetType?: string;
  targetId?: number;
  actorId?: number | null;
  isAnonymousActor?: boolean;
}): void {
  if (params.actorId && params.actorId === params.userId) return;

  // Respect platform-wide global notification policy
  const globalNotifCfg = getSetting('notification_settings', DEFAULT_NOTIFICATION_SETTINGS);
  if (params.type === 'reaction' && globalNotifCfg.allowReactionNotifs === false) return;
  if ((params.type === 'comment' || params.type === 'reply') && globalNotifCfg.allowCommentNotifs === false) {
    return;
  }
  if (
    (params.type === 'friend_request' || params.type === 'friend_accept') &&
    globalNotifCfg.allowFriendNotifs === false
  ) {
    return;
  }
  if (params.type === 'message' && globalNotifCfg.allowMessageNotifs === false) return;
  if (params.type === 'admin_announcement' && globalNotifCfg.allowBroadcastBanner === false) return;

  // Respect recipient notification preferences
  const profileRow = db
    .prepare('SELECT notify_prefs_json FROM profiles WHERE user_id = ?')
    .get(params.userId) as { notify_prefs_json: string } | undefined;

  if (profileRow) {
    try {
      const prefs = JSON.parse(profileRow.notify_prefs_json) as Record<string, boolean>;
      const mapKey: Record<string, string> = {
        message: 'messages',
        comment: 'comments',
        reply: 'comments',
        reaction: 'reactions',
        friend_request: 'friends',
        friend_accept: 'friends',
        community_invite: 'communities',
        challenge: 'challenges',
        daily_question: 'daily',
      };
      const prefKey = mapKey[params.type];
      if (prefKey && prefs[prefKey] === false) {
        return;
      }
    } catch {
      // proceed with defaults
    }
  }

  const isFriendActor = Boolean(
    !params.isAnonymousActor && params.actorId && areFriends(params.userId, params.actorId)
  );

  const res = db
    .prepare(
      `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, actor_id, is_anonymous_actor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.userId,
      params.type,
      params.title,
      params.body,
      params.targetType ?? null,
      params.targetId ?? null,
      params.isAnonymousActor ? null : params.actorId ?? null,
      params.isAnonymousActor ? 1 : 0
    );

  sendToUser(params.userId, {
    type: 'notification:new',
    notification: {
      id: Number(res.lastInsertRowid),
      type: params.type,
      title: params.title,
      body: params.body,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      isFriendActor,
      isAnonymousActor: Boolean(params.isAnonymousActor),
      isRead: false,
      createdAt: new Date().toISOString(),
    },
  });
}

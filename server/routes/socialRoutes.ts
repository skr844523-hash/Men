import { Router } from 'express';
import {
  areFriends,
  awardUserPoints,
  db,
  getUserPointsTotal,
  isBlockedBetween,
} from '../db.ts';
import { rateLimit, requireActiveAccount, requireAuth } from '../auth.ts';
import {
  broadcastPostEvent,
  broadcastPostRowEvent,
  getPostAccessRow,
  pushNotification,
  sendToUser,
} from '../realtime.ts';
import { canViewPost, PostRow, serializePost } from '../serializers.ts';
import { checkContentSafety, sanitizeMediaUrl } from '../../src/lib/validation.ts';
import { getLevelInfo } from '../../src/lib/gamification.ts';

export const socialRouter = Router();

const POST_BASE_SELECT = `
  SELECT p.*, u.username, pr.display_name, pr.avatar, pr.show_posts_to,
         c.mood_type, cm.name AS community_name, cm.slug AS community_slug
  FROM posts p
  JOIN users u ON u.id = p.author_id
  JOIN profiles pr ON pr.user_id = p.author_id
  LEFT JOIN confessions c ON c.post_id = p.id
  LEFT JOIN communities cm ON cm.id = p.community_id
`;

// Feed with pagination & filters
socialRouter.get('/posts', (req, res) => {
  const currentUserId = req.user?.id ?? null;
  const filter = String(req.query.filter || 'latest');
  const category = String(req.query.category || '');
  const type = String(req.query.type || '');
  const moodType = String(req.query.moodType || '');
  const communityId = req.query.communityId ? Number(req.query.communityId) : null;
  const limit = Math.min(30, Math.max(1, Number(req.query.limit || 15)));
  const offset = Math.max(0, Number(req.query.offset || 0));

  const conditions: string[] = ['p.is_hidden = 0', "u.status != 'banned'"];
  const params: (string | number)[] = [];

  if (type) {
    conditions.push('p.type = ?');
    params.push(type);
  }
  if (category && category !== 'الكل') {
    conditions.push('p.category = ?');
    params.push(category);
  }
  if (moodType && moodType !== 'الكل') {
    conditions.push('c.mood_type = ?');
    params.push(moodType);
  }
  if (communityId) {
    conditions.push('p.community_id = ?');
    params.push(communityId);
  }
  if (currentUserId) {
    conditions.push(
      `p.author_id NOT IN (SELECT blocked_id FROM blocked_users WHERE blocker_id = ?)`,
      `p.author_id NOT IN (SELECT blocker_id FROM blocked_users WHERE blocked_id = ?)`
    );
    params.push(currentUserId, currentUserId);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`${POST_BASE_SELECT} ${whereClause} ORDER BY p.id DESC LIMIT 120`)
    .all(...params) as unknown as PostRow[];

  let visible = rows
    .filter((r) => canViewPost(r, currentUserId))
    .map((r) => serializePost(r, currentUserId));

  // Filter by added friends if requested
  if (filter === 'friends' && currentUserId) {
    visible = visible.filter(
      (p) =>
        p.isOwner ||
        (!p.isAnonymous && p.author?.id !== undefined && areFriends(currentUserId, p.author.id))
    );
  }

  // Filter by user's interests if requested
  if (filter === 'interests' && currentUserId) {
    const prof = db
      .prepare('SELECT interests_json FROM profiles WHERE user_id = ?')
      .get(currentUserId) as { interests_json: string } | undefined;
    let interests: string[] = [];
    try {
      interests = JSON.parse(prof?.interests_json || '[]');
    } catch {
      interests = [];
    }
    if (interests.length > 0) {
      const interestSet = new Set(interests);
      const matched = visible.filter((p) => interestSet.has(p.category));
      if (matched.length > 0) {
        visible = matched;
      }
    }
  }

  if (filter === 'top' || filter === 'trending') {
    visible.sort((a, b) => b.trendingScore - a.trendingScore);
  }

  const total = visible.length;
  const items = visible.slice(offset, offset + limit);
  res.json({
    items,
    total,
    hasMore: offset + limit < total,
  });
});

// Single post detail
socialRouter.get('/posts/:id', (req, res) => {
  const postId = Number(req.params.id);
  const currentUserId = req.user?.id ?? null;
  const row = db
    .prepare(`${POST_BASE_SELECT} WHERE p.id = ? LIMIT 1`)
    .get(postId) as PostRow | undefined;

  if (!row || !canViewPost(row, currentUserId)) {
    res.status(404).json({ error: 'المنشور غير موجود أو غير متاح للعرض.' });
    return;
  }
  if (currentUserId && isBlockedBetween(currentUserId, row.author_id)) {
    res.status(404).json({ error: 'المنشور غير متاح.' });
    return;
  }

  res.json({ post: serializePost(row, currentUserId) });
});

// Create post / confession / question / poll
socialRouter.post(
  '/posts',
  requireActiveAccount,
  rateLimit('create_post', 12, 60000),
  (req, res) => {
    const userId = req.user!.id;
    const {
      type = 'post',
      category = 'فضفضة',
      moodType = 'فضفضة عامة',
      content,
      mediaUrl,
      isAnonymous = false,
      allowComments = true,
      audience = 'public',
      communityId = null,
      questionType = 'عام',
      allowVoting = true,
      pollOptions = [],
      pollShowResults = 'always',
      pollDurationHours = null,
    } = req.body ?? {};

    const allowedTypes = new Set(['post', 'confession', 'question', 'poll']);
    if (!allowedTypes.has(type)) {
      res.status(400).json({ error: 'نوع المنشور غير صالح.' });
      return;
    }

    const cleanContent = typeof content === 'string' ? content.trim() : '';
    const safety = checkContentSafety(cleanContent);
    if (!safety.safe) {
      res.status(400).json({ error: safety.reason });
      return;
    }
    if (cleanContent.length > 3000) {
      res.status(400).json({ error: 'النص يتجاوز الحد الأقصى (3000 حرف).' });
      return;
    }

    const safeMedia = sanitizeMediaUrl(mediaUrl);
    const cleanAudience =
      audience === 'friends' || audience === 'community' ? audience : 'public';

    // Community posting permissions check
    if (communityId) {
      const comm = db
        .prepare('SELECT id, privacy, who_can_post FROM communities WHERE id = ? AND is_hidden = 0')
        .get(Number(communityId)) as
        | { id: number; privacy: string; who_can_post: string }
        | undefined;
      if (!comm) {
        res.status(404).json({ error: 'المجتمع غير موجود.' });
        return;
      }
      const member = db
        .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
        .get(comm.id, userId) as { role: string } | undefined;
      if (!member) {
        res.status(403).json({ error: 'يجب الانضمام للمجتمع أولًا قبل النشر فيه.' });
        return;
      }
      if (comm.who_can_post === 'moderators' && member.role === 'member') {
        res.status(403).json({ error: 'النشر في هذا المجتمع متاح للمشرفين فقط.' });
        return;
      }
    }

    if (type === 'poll') {
      const validOpts = Array.isArray(pollOptions)
        ? pollOptions.map((o) => String(o).trim()).filter(Boolean)
        : [];
      if (validOpts.length < 2 || validOpts.length > 8) {
        res.status(400).json({ error: 'التصويت يجب أن يحتوي على خيارين إلى 8 خيارات.' });
        return;
      }
    }

    const anonFlag = isAnonymous || moodType === 'فضفضة بدون اسم' ? 1 : 0;

    const insertRes = db
      .prepare(
        `INSERT INTO posts (author_id, type, category, content, media_url, is_anonymous, allow_comments, audience, community_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        type,
        String(category || 'فضفضة'),
        cleanContent,
        safeMedia,
        anonFlag,
        allowComments ? 1 : 0,
        communityId ? 'community' : cleanAudience,
        communityId ? Number(communityId) : null
      );

    const postId = Number(insertRes.lastInsertRowid);

    if (type === 'confession') {
      db.prepare(
        `INSERT INTO confessions (post_id, mood_type, is_nameless) VALUES (?, ?, ?)`
      ).run(postId, String(moodType || 'فضفضة عامة'), anonFlag);
    } else if (type === 'question') {
      db.prepare(
        `INSERT INTO questions (post_id, question_type, allow_voting) VALUES (?, ?, ?)`
      ).run(postId, String(questionType || 'عام'), allowVoting ? 1 : 0);
    } else if (type === 'poll') {
      const endsAt =
        pollDurationHours && Number(pollDurationHours) > 0
          ? new Date(Date.now() + Number(pollDurationHours) * 3600 * 1000).toISOString()
          : null;
      db.prepare(`INSERT INTO polls (post_id, ends_at, show_results_mode) VALUES (?, ?, ?)`).run(
        postId,
        endsAt,
        pollShowResults === 'after_vote' ? 'after_vote' : 'always'
      );
      const insertOpt = db.prepare(
        `INSERT INTO poll_options (poll_post_id, label, sort_order) VALUES (?, ?, ?)`
      );
      (pollOptions as string[]).forEach((opt, i) => {
        const cleanOpt = String(opt).trim();
        if (cleanOpt) insertOpt.run(postId, cleanOpt.slice(0, 100), i);
      });
    }

    if (communityId) {
      db.prepare('INSERT OR IGNORE INTO community_posts (community_id, post_id) VALUES (?, ?)').run(
        Number(communityId),
        postId
      );
    }

    awardUserPoints(userId, 'create_post', postId, cleanContent);

    const createdRow = db
      .prepare(`${POST_BASE_SELECT} WHERE p.id = ?`)
      .get(postId) as unknown as PostRow;
    const serialized = serializePost(createdRow, userId);

    // Notify authorized connected clients of a new post (respecting audience, community, blocks, and anonymity)
    broadcastPostEvent(postId, { type: 'feed:new_post', postId }, userId);

    res.status(201).json({ post: serialized });
  }
);

// Edit own post
socialRouter.patch('/posts/:id', requireActiveAccount, (req, res) => {
  const postId = Number(req.params.id);
  const post = getPostAccessRow(postId);
  if (!post || post.is_hidden === 1) {
    res.status(404).json({ error: 'المنشور غير موجود.' });
    return;
  }
  if (post.author_id !== req.user!.id) {
    res.status(403).json({ error: 'لا يمكنك تعديل منشور لا تملكه.' });
    return;
  }

  const cleanContent = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  const safety = checkContentSafety(cleanContent);
  if (!safety.safe) {
    res.status(400).json({ error: safety.reason });
    return;
  }
  if (cleanContent.length > 3000) {
    res.status(400).json({ error: 'النص يتجاوز الحد الأقصى (3000 حرف).' });
    return;
  }

  db.prepare(`UPDATE posts SET content = ?, updated_at = datetime('now') WHERE id = ?`).run(
    cleanContent,
    postId
  );

  const updatedRow = db
    .prepare(`${POST_BASE_SELECT} WHERE p.id = ?`)
    .get(postId) as unknown as PostRow;
  const serialized = serializePost(updatedRow, req.user!.id);

  broadcastPostEvent(postId, {
    type: 'post:updated',
    postId,
    content: cleanContent,
  });

  res.json({ post: serialized });
});

// Delete own post
socialRouter.delete('/posts/:id', requireAuth, (req, res) => {
  const postId = Number(req.params.id);
  const post = getPostAccessRow(postId);
  if (!post) {
    res.status(404).json({ error: 'المنشور غير موجود.' });
    return;
  }
  if (post.author_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'لا يمكنك حذف منشور لا تملكه.' });
    return;
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
  broadcastPostRowEvent(post, { type: 'post:deleted', postId });
  res.json({ ok: true });
});

// Toggle reaction (like | support)
socialRouter.post(
  '/posts/:id/react',
  requireActiveAccount,
  rateLimit('react', 40, 60000),
  (req, res) => {
    const postId = Number(req.params.id);
    const userId = req.user!.id;
    const reactionType = req.body?.reactionType === 'support' ? 'support' : 'like';

    const post = db
      .prepare('SELECT id, author_id, is_anonymous FROM posts WHERE id = ? AND is_hidden = 0')
      .get(postId) as { id: number; author_id: number; is_anonymous: number } | undefined;
    if (!post) {
      res.status(404).json({ error: 'المنشور غير موجود.' });
      return;
    }
    if (isBlockedBetween(userId, post.author_id)) {
      res.status(403).json({ error: 'لا يمكن التفاعل مع هذا المنشور.' });
      return;
    }

    const existing = db
      .prepare(
        `SELECT id FROM reactions WHERE target_type = 'post' AND target_id = ? AND user_id = ? AND reaction_type = ?`
      )
      .get(postId, userId, reactionType) as { id: number } | undefined;

    let active = false;
    if (existing) {
      db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
      active = false;
    } else {
      db.prepare(
        `INSERT INTO reactions (target_type, target_id, user_id, reaction_type) VALUES ('post', ?, ?, ?)`
      ).run(postId, userId, reactionType);
      active = true;
      if (reactionType === 'support') {
        awardUserPoints(userId, 'give_support', postId);
      }
      pushNotification({
        userId: post.author_id,
        type: 'reaction',
        title: reactionType === 'support' ? 'وصلتك رسالة دعم' : 'إعجاب جديد',
        body:
          reactionType === 'support'
            ? `${req.user!.displayName} قدّم دعمًا لمنشورك.`
            : `${req.user!.displayName} أعجب بمنشورك.`,
        targetType: 'post',
        targetId: postId,
        actorId: userId,
      });
    }

    const counts = db
      .prepare(
        `SELECT
           SUM(CASE WHEN reaction_type = 'like' THEN 1 ELSE 0 END) AS likesCount,
           SUM(CASE WHEN reaction_type = 'support' THEN 1 ELSE 0 END) AS supportsCount
         FROM reactions WHERE target_type = 'post' AND target_id = ?`
      )
      .get(postId) as { likesCount: number; supportsCount: number };

    const likesCount = Number(counts?.likesCount ?? 0);
    const supportsCount = Number(counts?.supportsCount ?? 0);

    broadcastPostEvent(postId, {
      type: 'post:reaction',
      postId,
      likesCount,
      supportsCount,
    });

    res.json({
      active,
      reactionType,
      likesCount,
      supportsCount,
    });
  }
);

// Share counter increment
socialRouter.post('/posts/:id/share', (req, res) => {
  const postId = Number(req.params.id);
  db.prepare('UPDATE posts SET shares_count = shares_count + 1 WHERE id = ?').run(postId);
  const row = db.prepare('SELECT shares_count FROM posts WHERE id = ?').get(postId) as
    | { shares_count: number }
    | undefined;
  res.json({ sharesCount: Number(row?.shares_count ?? 0) });
});

// Follow/Unfollow a specific post/confession
socialRouter.post('/posts/:id/follow', requireAuth, (req, res) => {
  const postId = Number(req.params.id);
  const userId = req.user!.id;
  const exists = db
    .prepare('SELECT id FROM post_follows WHERE user_id = ? AND post_id = ?')
    .get(userId, postId) as { id: number } | undefined;

  if (exists) {
    db.prepare('DELETE FROM post_follows WHERE id = ?').run(exists.id);
    res.json({ following: false });
  } else {
    db.prepare('INSERT INTO post_follows (user_id, post_id) VALUES (?, ?)').run(userId, postId);
    res.json({ following: true });
  }
});

// Save / Unsave post
socialRouter.post('/posts/:id/save', requireAuth, (req, res) => {
  const postId = Number(req.params.id);
  const userId = req.user!.id;
  const tag = typeof req.body?.tag === 'string' && req.body.tag.trim() ? req.body.tag.trim() : 'عام';

  const exists = db
    .prepare('SELECT id FROM saved_posts WHERE user_id = ? AND post_id = ?')
    .get(userId, postId) as { id: number } | undefined;

  if (exists) {
    db.prepare('DELETE FROM saved_posts WHERE id = ?').run(exists.id);
    res.json({ saved: false });
  } else {
    db.prepare('INSERT INTO saved_posts (user_id, post_id, collection_tag) VALUES (?, ?, ?)').run(
      userId,
      postId,
      tag
    );
    res.json({ saved: true });
  }
});

// Saved posts list
socialRouter.get('/saved', requireAuth, (req, res) => {
  const userId = req.user!.id;
  const q = String(req.query.q || '').trim().toLowerCase();
  const type = String(req.query.type || '');

  const rows = db
    .prepare(
      `SELECT p.*, u.username, pr.display_name, pr.avatar, pr.show_posts_to,
              c.mood_type, cm.name AS community_name, cm.slug AS community_slug,
              sp.collection_tag, sp.created_at AS saved_at
       FROM saved_posts sp
       JOIN posts p ON p.id = sp.post_id
       JOIN users u ON u.id = p.author_id
       JOIN profiles pr ON pr.user_id = p.author_id
       LEFT JOIN confessions c ON c.post_id = p.id
       LEFT JOIN communities cm ON cm.id = p.community_id
       WHERE sp.user_id = ? AND p.is_hidden = 0
       ORDER BY sp.created_at DESC`
    )
    .all(userId) as unknown as Array<PostRow & { collection_tag: string; saved_at: string }>;

  let items = rows.map((r) => ({
    ...serializePost(r, userId),
    collectionTag: r.collection_tag,
    savedAt: r.saved_at,
  }));

  if (type && type !== 'all') {
    items = items.filter((item) =>
      type === 'community' ? item.communityId !== null : item.type === type
    );
  }
  if (q) {
    items = items.filter(
      (item) =>
        item.content.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
    );
  }

  res.json({ items });
});

// Comments & Replies for a post
socialRouter.get('/posts/:id/comments', (req, res) => {
  const postId = Number(req.params.id);
  const currentUserId = req.user?.id ?? null;

  const comments = db
    .prepare(
      `SELECT c.*, u.username, pr.display_name, pr.avatar
       FROM comments c
       JOIN users u ON u.id = c.author_id
       JOIN profiles pr ON pr.user_id = c.author_id
       WHERE c.post_id = ? AND c.is_hidden = 0
       ORDER BY c.created_at ASC`
    )
    .all(postId) as Array<Record<string, unknown>>;

  const serialized = comments.map((c) => {
    const isAnon = Number(c.is_anonymous) === 1;
    const replies = db
      .prepare(
        `SELECT r.*, u.username, pr.display_name, pr.avatar
         FROM comment_replies r
         JOIN users u ON u.id = r.author_id
         JOIN profiles pr ON pr.user_id = r.author_id
         WHERE r.comment_id = ? AND r.is_hidden = 0
         ORDER BY r.created_at ASC`
      )
      .all(Number(c.id)) as Array<Record<string, unknown>>;

    return {
      id: c.id,
      postId: c.post_id,
      content: c.content,
      isAnonymous: isAnon,
      isOwner: currentUserId === Number(c.author_id),
      author: isAnon
        ? null
        : {
            id: c.author_id,
            username: c.username,
            displayName: c.display_name,
            avatar: c.avatar,
          },
      createdAt: c.created_at,
      replies: replies.map((r) => {
        const rAnon = Number(r.is_anonymous) === 1;
        return {
          id: r.id,
          commentId: r.comment_id,
          content: r.content,
          isAnonymous: rAnon,
          isOwner: currentUserId === Number(r.author_id),
          author: rAnon
            ? null
            : {
                id: r.author_id,
                username: r.username,
                displayName: r.display_name,
                avatar: r.avatar,
              },
          createdAt: r.created_at,
        };
      }),
    };
  });

  res.json({ comments: serialized });
});

socialRouter.post(
  '/posts/:id/comments',
  requireActiveAccount,
  rateLimit('comment', 25, 60000),
  (req, res) => {
    const postId = Number(req.params.id);
    const userId = req.user!.id;
    const { content, isAnonymous = false } = req.body ?? {};

    const post = db
      .prepare(
        `SELECT p.id, p.author_id, p.allow_comments, pr.allow_comments_from
         FROM posts p
         JOIN profiles pr ON pr.user_id = p.author_id
         WHERE p.id = ? AND p.is_hidden = 0`
      )
      .get(postId) as
      | { id: number; author_id: number; allow_comments: number; allow_comments_from: string }
      | undefined;

    if (!post) {
      res.status(404).json({ error: 'المنشور غير موجود.' });
      return;
    }
    if (post.allow_comments === 0) {
      res.status(403).json({ error: 'التعليقات مغلقة على هذا المنشور.' });
      return;
    }
    if (isBlockedBetween(userId, post.author_id)) {
      res.status(403).json({ error: 'لا يمكنك التعليق على هذا المنشور.' });
      return;
    }
    if (post.author_id !== userId) {
      if (post.allow_comments_from === 'none') {
        res.status(403).json({ error: 'صاحب المنشور أوقف التعليقات حاليًا.' });
        return;
      }
      if (post.allow_comments_from === 'friends' && !areFriends(userId, post.author_id)) {
        res.status(403).json({ error: 'التعليقات متاحة للأصدقاء فقط.' });
        return;
      }
    }

    const clean = typeof content === 'string' ? content.trim() : '';
    const safety = checkContentSafety(clean);
    if (!safety.safe) {
      res.status(400).json({ error: safety.reason });
      return;
    }

    const anonFlag = isAnonymous ? 1 : 0;
    const insert = db
      .prepare(
        `INSERT INTO comments (post_id, author_id, content, is_anonymous) VALUES (?, ?, ?, ?)`
      )
      .run(postId, userId, clean.slice(0, 1200), anonFlag);

    const commentId = Number(insert.lastInsertRowid);
    awardUserPoints(userId, 'create_comment', commentId, clean);

    pushNotification({
      userId: post.author_id,
      type: 'comment',
      title: 'تعليق جديد',
      body: anonFlag
        ? 'أضاف شخص مجهول تعليقًا على منشورك.'
        : `${req.user!.displayName} علّق على منشورك.`,
      targetType: 'post',
      targetId: postId,
      actorId: userId,
      isAnonymousActor: Boolean(anonFlag),
    });

    // Notify followers of this post/confession
    const followers = db
      .prepare('SELECT user_id FROM post_follows WHERE post_id = ? AND user_id != ?')
      .all(postId, userId) as Array<{ user_id: number }>;
    for (const f of followers) {
      pushNotification({
        userId: f.user_id,
        type: 'comment',
        title: 'تحديث على منشور تتابعه',
        body: 'تمت إضافة تعليق جديد على منشور تتابعه.',
        targetType: 'post',
        targetId: postId,
        actorId: userId,
        isAnonymousActor: Boolean(anonFlag),
      });
    }

    const commentPayload = {
      id: commentId,
      postId,
      content: clean,
      isAnonymous: Boolean(anonFlag),
      isOwner: true,
      author: anonFlag
        ? null
        : {
            id: userId,
            username: req.user!.username,
            displayName: req.user!.displayName,
            avatar: req.user!.avatar,
          },
      createdAt: new Date().toISOString(),
      replies: [],
    };

    const countRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM comments WHERE post_id = ? AND is_hidden = 0')
      .get(postId) as { cnt: number };

    broadcastPostEvent(
      postId,
      {
        type: 'post:comment_new',
        postId,
        commentsCount: Number(countRow?.cnt ?? 0),
        comment: { ...commentPayload, isOwner: false },
      },
      userId
    );

    res.status(201).json({ comment: commentPayload });
  }
);

socialRouter.post(
  '/comments/:commentId/replies',
  requireActiveAccount,
  rateLimit('reply', 25, 60000),
  (req, res) => {
    const commentId = Number(req.params.commentId);
    const userId = req.user!.id;
    const { content, isAnonymous = false } = req.body ?? {};

    const comment = db
      .prepare(
        `SELECT c.id, c.post_id, c.author_id, p.author_id AS post_author_id, p.is_hidden AS post_hidden
         FROM comments c
         JOIN posts p ON p.id = c.post_id
         WHERE c.id = ? AND c.is_hidden = 0`
      )
      .get(commentId) as
      | { id: number; post_id: number; author_id: number; post_author_id: number; post_hidden: number }
      | undefined;
    if (!comment || comment.post_hidden === 1) {
      res.status(404).json({ error: 'التعليق غير موجود.' });
      return;
    }
    if (isBlockedBetween(userId, comment.author_id) || isBlockedBetween(userId, comment.post_author_id)) {
      res.status(403).json({ error: 'غير مصرح بالرد على هذا التعليق.' });
      return;
    }

    const clean = typeof content === 'string' ? content.trim() : '';
    const safety = checkContentSafety(clean);
    if (!safety.safe) {
      res.status(400).json({ error: safety.reason });
      return;
    }

    const anonFlag = isAnonymous ? 1 : 0;
    const insert = db
      .prepare(
        `INSERT INTO comment_replies (comment_id, author_id, content, is_anonymous) VALUES (?, ?, ?, ?)`
      )
      .run(commentId, userId, clean.slice(0, 1000), anonFlag);

    pushNotification({
      userId: comment.author_id,
      type: 'reply',
      title: 'رد على تعليقك',
      body: anonFlag
        ? 'رد شخص مجهول على تعليقك.'
        : `${req.user!.displayName} رد على تعليقك.`,
      targetType: 'post',
      targetId: comment.post_id,
      actorId: userId,
      isAnonymousActor: Boolean(anonFlag),
    });

    const replyPayload = {
      id: Number(insert.lastInsertRowid),
      commentId,
      content: clean,
      isAnonymous: Boolean(anonFlag),
      isOwner: true,
      author: anonFlag
        ? null
        : {
            id: userId,
            username: req.user!.username,
            displayName: req.user!.displayName,
            avatar: req.user!.avatar,
          },
      createdAt: new Date().toISOString(),
    };

    broadcastPostEvent(
      comment.post_id,
      {
        type: 'post:reply_new',
        postId: comment.post_id,
        commentId,
        reply: { ...replyPayload, isOwner: false },
      },
      userId
    );

    res.status(201).json({ reply: replyPayload });
  }
);

// Public User Profile with privacy controls
socialRouter.get('/users/:username', (req, res) => {
  const handle = String(req.params.username).trim().toLowerCase().replace(/^@+/, '');
  const currentUserId = req.user?.id ?? null;

  const row = db
    .prepare(
      `SELECT u.id, u.username, u.status, u.created_at, u.last_active_at,
              p.display_name, p.avatar, p.bio, p.interests_json, p.privacy_level,
              p.show_activity, p.allow_messages_from
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       WHERE u.username = ?
       LIMIT 1`
    )
    .get(handle) as Record<string, unknown> | undefined;

  if (!row || row.status === 'banned') {
    res.status(404).json({ error: 'المستخدم غير موجود.' });
    return;
  }

  const targetId = Number(row.id);
  if (currentUserId && isBlockedBetween(currentUserId, targetId)) {
    res.status(404).json({ error: 'المستخدم غير متاح.' });
    return;
  }

  const isSelf = currentUserId === targetId;
  const isFriend = currentUserId ? areFriends(currentUserId, targetId) : false;

  let friendStatus: 'none' | 'pending_sent' | 'pending_received' | 'friends' = 'none';
  if (currentUserId && !isSelf) {
    const fRow = db
      .prepare(
        `SELECT requester_id, addressee_id, status FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
      )
      .get(currentUserId, targetId, targetId, currentUserId) as
      | { requester_id: number; addressee_id: number; status: string }
      | undefined;
    if (fRow) {
      if (fRow.status === 'accepted') friendStatus = 'friends';
      else if (fRow.status === 'pending') {
        friendStatus = fRow.requester_id === currentUserId ? 'pending_sent' : 'pending_received';
      }
    }
  }

  const isFollowing = currentUserId
    ? Boolean(
        db
          .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
          .get(currentUserId, targetId)
      )
    : false;

  const friendsCountRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM friendships
       WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'`
    )
    .get(targetId, targetId) as { cnt: number };

  const followersCountRow = db
    .prepare('SELECT COUNT(*) AS cnt FROM follows WHERE following_id = ?')
    .get(targetId) as { cnt: number };

  const postsCountRow = db
    .prepare('SELECT COUNT(*) AS cnt FROM posts WHERE author_id = ? AND is_anonymous = 0 AND is_hidden = 0')
    .get(targetId) as { cnt: number };

  const points = getUserPointsTotal(targetId);
  const level = getLevelInfo(points);
  const badges = db
    .prepare(
      `SELECT b.slug, b.title, b.description, b.icon_name
       FROM user_badges ub JOIN badges b ON b.slug = ub.badge_slug
       WHERE ub.user_id = ?`
    )
    .all(targetId);

  const privacyLevel = String(row.privacy_level || 'public');
  const canSeeFullProfile =
    isSelf || privacyLevel === 'public' || (privacyLevel === 'friends' && isFriend);

  let posts: unknown[] = [];
  if (canSeeFullProfile) {
    const rawPosts = db
      .prepare(
        `${POST_BASE_SELECT}
         WHERE p.author_id = ? AND p.is_hidden = 0 ${isSelf ? '' : 'AND p.is_anonymous = 0'}
         ORDER BY p.id DESC LIMIT 30`
      )
      .all(targetId) as unknown as PostRow[];
    posts = rawPosts
      .filter((r) => canViewPost(r, currentUserId))
      .map((r) => serializePost(r, currentUserId));
  }

  let interests: string[] = [];
  try {
    interests = JSON.parse(String(row.interests_json || '[]'));
  } catch {
    interests = [];
  }

  res.json({
    profile: {
      id: targetId,
      username: row.username,
      displayName: row.display_name,
      avatar: row.avatar,
      bio: canSeeFullProfile ? row.bio : '',
      interests: canSeeFullProfile ? interests : [],
      privacyLevel,
      canSeeFullProfile,
      isSelf,
      friendStatus,
      isFollowing,
      allowMessagesFrom: row.allow_messages_from,
      lastActiveAt: Number(row.show_activity) === 1 ? row.last_active_at : null,
      createdAt: row.created_at,
      friendsCount: Number(friendsCountRow?.cnt ?? 0),
      followersCount: Number(followersCountRow?.cnt ?? 0),
      postsCount: Number(postsCountRow?.cnt ?? 0),
      points,
      level,
      badges,
      posts,
    },
  });
});

// Friends & Suggestions & Follow
socialRouter.get('/friends', requireAuth, (req, res) => {
  const userId = req.user!.id;

  const friends = db
    .prepare(
      `SELECT u.id, u.username, p.display_name, p.avatar, p.bio
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       JOIN profiles p ON p.user_id = u.id
       WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted' AND u.status = 'active'`
    )
    .all(userId, userId, userId);

  const incomingRequests = db
    .prepare(
      `SELECT f.id AS request_id, u.id, u.username, p.display_name, p.avatar, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       JOIN profiles p ON p.user_id = u.id
       WHERE f.addressee_id = ? AND f.status = 'pending' AND u.status = 'active'
       ORDER BY f.created_at DESC`
    )
    .all(userId);

  const outgoingRequests = db
    .prepare(
      `SELECT f.id AS request_id, u.id, u.username, p.display_name, p.avatar, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       JOIN profiles p ON p.user_id = u.id
       WHERE f.requester_id = ? AND f.status = 'pending' AND u.status = 'active'`
    )
    .all(userId);

  // Real users suggested (excluding self, blocked, and existing friends/pending)
  const suggestions = db
    .prepare(
      `SELECT u.id, u.username, p.display_name, p.avatar, p.bio
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       WHERE u.id != ?
         AND u.status = 'active'
         AND p.privacy_level != 'limited'
         AND u.id NOT IN (SELECT blocked_id FROM blocked_users WHERE blocker_id = ?)
         AND u.id NOT IN (SELECT blocker_id FROM blocked_users WHERE blocked_id = ?)
         AND u.id NOT IN (
           SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
           FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status IN ('accepted', 'pending')
         )
       ORDER BY u.last_active_at DESC LIMIT 12`
    )
    .all(userId, userId, userId, userId, userId, userId) as Array<Record<string, unknown>>;

  // Compute mutual friends count
  const myFriendIds = new Set(friends.map((f: Record<string, unknown>) => Number(f.id)));
  const suggestionsWithMutuals = suggestions.map((s) => {
    const targetId = Number(s.id);
    const theirFriends = db
      .prepare(
        `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS fid
         FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'`
      )
      .all(targetId, targetId, targetId) as Array<{ fid: number }>;
    const mutualCount = theirFriends.filter((tf) => myFriendIds.has(Number(tf.fid))).length;
    return { ...s, mutualCount };
  });

  const following = db
    .prepare(
      `SELECT u.id, u.username, p.display_name, p.avatar
       FROM follows fl JOIN users u ON u.id = fl.following_id JOIN profiles p ON p.user_id = u.id
       WHERE fl.follower_id = ?`
    )
    .all(userId);

  res.json({
    friends,
    incomingRequests,
    outgoingRequests,
    suggestions: suggestionsWithMutuals,
    following,
  });
});

socialRouter.post('/friends/request', requireActiveAccount, (req, res) => {
  const userId = req.user!.id;
  const targetId = Number(req.body?.userId);
  if (!targetId || targetId === userId) {
    res.status(400).json({ error: 'طلب غير صالح.' });
    return;
  }
  if (isBlockedBetween(userId, targetId)) {
    res.status(403).json({ error: 'لا يمكن إرسال طلب صداقة لهذا المستخدم.' });
    return;
  }
  const existing = db
    .prepare(
      `SELECT id, status FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
    )
    .get(userId, targetId, targetId, userId) as { id: number; status: string } | undefined;

  if (existing) {
    if (existing.status === 'accepted') {
      res.status(400).json({ error: 'أنتما أصدقاء بالفعل.' });
      return;
    }
    if (existing.status === 'pending') {
      res.status(400).json({ error: 'يوجد طلب صداقة قيد الانتظار بالفعل.' });
      return;
    }
    db.prepare(
      `UPDATE friendships SET requester_id = ?, addressee_id = ?, status = 'pending', updated_at = datetime('now') WHERE id = ?`
    ).run(userId, targetId, existing.id);
  } else {
    db.prepare(
      `INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')`
    ).run(userId, targetId);
  }

  pushNotification({
    userId: targetId,
    type: 'friend_request',
    title: 'طلب صداقة جديد',
    body: `أرسل لك ${req.user!.displayName} طلب صداقة.`,
    targetType: 'friends',
    targetId: userId,
    actorId: userId,
  });

  sendToUser(targetId, { type: 'friend:request', userId });
  sendToUser(userId, { type: 'friend:updated', userId: targetId });

  res.json({ ok: true, status: 'pending_sent' });
});

socialRouter.post('/friends/respond', requireActiveAccount, (req, res) => {
  const userId = req.user!.id;
  const requesterId = Number(req.body?.userId);
  const action = req.body?.action === 'accept' ? 'accepted' : 'rejected';

  const row = db
    .prepare(
      `SELECT id FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`
    )
    .get(requesterId, userId) as { id: number } | undefined;
  if (!row) {
    res.status(404).json({ error: 'طلب الصداقة غير موجود.' });
    return;
  }

  db.prepare(`UPDATE friendships SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    action,
    row.id
  );

  if (action === 'accepted') {
    pushNotification({
      userId: requesterId,
      type: 'friend_accept',
      title: 'تم قبول طلب الصداقة',
      body: `وافق ${req.user!.displayName} على طلب صداقتك.`,
      targetType: 'profile',
      targetId: userId,
      actorId: userId,
    });
    sendToUser(requesterId, { type: 'friend:accepted', userId });
    sendToUser(userId, { type: 'friend:accepted', userId: requesterId });
  } else {
    sendToUser(requesterId, { type: 'friend:removed', userId });
    sendToUser(userId, { type: 'friend:removed', userId: requesterId });
  }

  res.json({ ok: true, status: action });
});

socialRouter.delete('/friends/:targetId', requireAuth, (req, res) => {
  const userId = req.user!.id;
  const targetId = Number(req.params.targetId);
  db.prepare(
    `DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
  ).run(userId, targetId, targetId, userId);
  sendToUser(targetId, { type: 'friend:removed', userId });
  sendToUser(userId, { type: 'friend:removed', userId: targetId });
  res.json({ ok: true });
});

socialRouter.post('/follow/:targetId', requireActiveAccount, (req, res) => {
  const userId = req.user!.id;
  const targetId = Number(req.params.targetId);
  if (targetId === userId || isBlockedBetween(userId, targetId)) {
    res.status(400).json({ error: 'عملية غير متاحة.' });
    return;
  }
  const existing = db
    .prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?')
    .get(userId, targetId) as { id: number } | undefined;
  if (existing) {
    db.prepare('DELETE FROM follows WHERE id = ?').run(existing.id);
    res.json({ following: false });
  } else {
    db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(userId, targetId);
    res.json({ following: true });
  }
});

// Block & Unblock
socialRouter.get('/blocks', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, p.display_name, p.avatar, b.created_at
       FROM blocked_users b
       JOIN users u ON u.id = b.blocked_id
       JOIN profiles p ON p.user_id = u.id
       WHERE b.blocker_id = ?
       ORDER BY b.created_at DESC`
    )
    .all(req.user!.id);
  res.json({ blocked: rows });
});

socialRouter.post('/blocks/:targetId', requireAuth, (req, res) => {
  const userId = req.user!.id;
  const targetId = Number(req.params.targetId);
  if (targetId === userId) {
    res.status(400).json({ error: 'لا يمكنك حظر نفسك.' });
    return;
  }
  db.prepare('INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)').run(
    userId,
    targetId
  );
  // Also remove friendships & follows
  db.prepare(
    'DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)'
  ).run(userId, targetId, targetId, userId);
  db.prepare(
    'DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)'
  ).run(userId, targetId, targetId, userId);

  sendToUser(userId, { type: 'block:updated', targetId });
  res.json({ ok: true });
});

socialRouter.delete('/blocks/:targetId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').run(
    req.user!.id,
    Number(req.params.targetId)
  );
  res.json({ ok: true });
});

// Reports
socialRouter.get('/reports/mine', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, target_type, target_id, reason, details, status, resolution_note, created_at, resolved_at
       FROM reports WHERE reporter_id = ? ORDER BY created_at DESC LIMIT 50`
    )
    .all(req.user!.id);
  res.json({ reports: rows });
});

socialRouter.post('/reports', requireAuth, rateLimit('report', 10, 60000), (req, res) => {
  const { targetType, targetId, reason, details = '' } = req.body ?? {};
  const allowedTargets = new Set(['post', 'comment', 'user', 'community', 'message']);
  if (!allowedTargets.has(targetType) || !Number(targetId) || !String(reason || '').trim()) {
    res.status(400).json({ error: 'يرجى تحديد نوع وسبب البلاغ.' });
    return;
  }
  const insert = db
    .prepare(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, details)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      req.user!.id,
      targetType,
      Number(targetId),
      String(reason).trim().slice(0, 120),
      String(details).trim().slice(0, 600)
    );
  res.status(201).json({ id: Number(insert.lastInsertRowid), ok: true });
});

// Notifications
socialRouter.get('/notifications', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, type, title, body, target_type, target_id, is_read, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60`
    )
    .all(req.user!.id);
  res.json({ notifications: rows });
});

socialRouter.post('/notifications/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(
    Number(req.params.id),
    req.user!.id
  );
  res.json({ ok: true });
});

socialRouter.post('/notifications/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
  res.json({ ok: true });
});

// Help Center & Support Requests
socialRouter.post('/support', rateLimit('support', 6, 60000), (req, res) => {
  const { category, subject, description, imageUrl } = req.body ?? {};
  const cleanSubject = String(subject || '').trim();
  const cleanDesc = String(description || '').trim();
  if (!cleanSubject || !cleanDesc) {
    res.status(400).json({ error: 'يرجى كتابة عنوان ووصف المشكلة أو الاقتراح.' });
    return;
  }
  const safeImg = sanitizeMediaUrl(imageUrl);
  const insert = db
    .prepare(
      `INSERT INTO support_requests (user_id, category, subject, description, image_url)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      req.user?.id ?? null,
      String(category || 'أخرى').slice(0, 80),
      cleanSubject.slice(0, 150),
      cleanDesc.slice(0, 2000),
      safeImg
    );
  res.status(201).json({ id: Number(insert.lastInsertRowid), ok: true });
});

socialRouter.get('/support/mine', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM support_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
    .all(req.user!.id);
  res.json({ requests: rows });
});

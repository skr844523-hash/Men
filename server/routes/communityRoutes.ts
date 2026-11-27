import { Router } from 'express';
import { awardUserPoints, db, getSetting } from '../db.ts';
import { rateLimit, requireActiveAccount, requireAuth } from '../auth.ts';
import { broadcastPostEvent, pushNotification } from '../realtime.ts';
import { canViewPost, PostRow, serializePost } from '../serializers.ts';
import { checkContentSafety, sanitizeMediaUrl } from '../../src/lib/validation.ts';

export const communityRouter = Router();

const POST_BASE_SELECT = `
  SELECT p.*, u.username, pr.display_name, pr.avatar, pr.show_posts_to,
         c.mood_type, cm.name AS community_name, cm.slug AS community_slug
  FROM posts p
  JOIN users u ON u.id = p.author_id
  JOIN profiles pr ON pr.user_id = p.author_id
  LEFT JOIN confessions c ON c.post_id = p.id
  LEFT JOIN communities cm ON cm.id = p.community_id
`;

// Questions: answers, voting, best answer
communityRouter.get('/questions/:postId/answers', (req, res) => {
  const postId = Number(req.params.postId);
  const currentUserId = req.user?.id ?? null;

  const answers = db
    .prepare(
      `SELECT a.*, u.username, pr.display_name, pr.avatar,
              COALESCE(SUM(av.value), 0) AS score
       FROM answers a
       JOIN users u ON u.id = a.author_id
       JOIN profiles pr ON pr.user_id = a.author_id
       LEFT JOIN answer_votes av ON av.answer_id = a.id
       WHERE a.question_post_id = ?
       GROUP BY a.id
       ORDER BY a.is_best DESC, score DESC, a.created_at ASC`
    )
    .all(postId) as Array<Record<string, unknown>>;

  const serialized = answers.map((a) => {
    const isAnon = Number(a.is_anonymous) === 1;
    let userVote = 0;
    if (currentUserId) {
      const vRow = db
        .prepare('SELECT value FROM answer_votes WHERE answer_id = ? AND user_id = ?')
        .get(Number(a.id), currentUserId) as { value: number } | undefined;
      userVote = vRow?.value ?? 0;
    }
    return {
      id: a.id,
      questionPostId: a.question_post_id,
      content: a.content,
      isAnonymous: isAnon,
      isOwner: currentUserId === Number(a.author_id),
      isBest: Number(a.is_best) === 1,
      score: Number(a.score ?? 0),
      userVote,
      author: isAnon
        ? null
        : {
            id: a.author_id,
            username: a.username,
            displayName: a.display_name,
            avatar: a.avatar,
          },
      createdAt: a.created_at,
    };
  });

  res.json({ answers: serialized });
});

communityRouter.post(
  '/questions/:postId/answers',
  requireActiveAccount,
  rateLimit('answer', 20, 60000),
  (req, res) => {
    const postId = Number(req.params.postId);
    const userId = req.user!.id;
    const { content, isAnonymous = false } = req.body ?? {};

    const qRow = db
      .prepare(
        `SELECT p.id, p.author_id FROM posts p JOIN questions q ON q.post_id = p.id WHERE p.id = ? AND p.is_hidden = 0`
      )
      .get(postId) as { id: number; author_id: number } | undefined;

    if (!qRow) {
      res.status(404).json({ error: 'السؤال غير موجود.' });
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
        `INSERT INTO answers (question_post_id, author_id, content, is_anonymous) VALUES (?, ?, ?, ?)`
      )
      .run(postId, userId, clean.slice(0, 1500), anonFlag);

    const answerId = Number(insert.lastInsertRowid);
    awardUserPoints(userId, 'answer_question', answerId, clean);

    pushNotification({
      userId: qRow.author_id,
      type: 'comment',
      title: 'إجابة جديدة على سؤالك',
      body: anonFlag
        ? 'أجاب شخص مجهول على سؤالك.'
        : `${req.user!.displayName} أجاب على سؤالك.`,
      targetType: 'post',
      targetId: postId,
      actorId: userId,
      isAnonymousActor: Boolean(anonFlag),
    });

    res.status(201).json({ id: answerId, ok: true });
  }
);

communityRouter.post('/answers/:answerId/vote', requireActiveAccount, (req, res) => {
  const answerId = Number(req.params.answerId);
  const userId = req.user!.id;
  const value = req.body?.value === -1 ? -1 : 1;

  const ans = db
    .prepare(
      `SELECT a.id, q.allow_voting
       FROM answers a
       JOIN questions q ON q.post_id = a.question_post_id
       WHERE a.id = ?`
    )
    .get(answerId) as { id: number; allow_voting: number } | undefined;

  if (!ans) {
    res.status(404).json({ error: 'الإجابة غير موجودة.' });
    return;
  }
  if (ans.allow_voting === 0) {
    res.status(403).json({ error: 'التصويت غير مفعل على هذا السؤال.' });
    return;
  }

  const existing = db
    .prepare('SELECT id, value FROM answer_votes WHERE answer_id = ? AND user_id = ?')
    .get(answerId, userId) as { id: number; value: number } | undefined;

  if (existing) {
    if (existing.value === value) {
      db.prepare('DELETE FROM answer_votes WHERE id = ?').run(existing.id);
    } else {
      db.prepare('UPDATE answer_votes SET value = ? WHERE id = ?').run(value, existing.id);
    }
  } else {
    db.prepare('INSERT INTO answer_votes (answer_id, user_id, value) VALUES (?, ?, ?)').run(
      answerId,
      userId,
      value
    );
  }

  const sumRow = db
    .prepare('SELECT COALESCE(SUM(value), 0) AS score FROM answer_votes WHERE answer_id = ?')
    .get(answerId) as { score: number };

  res.json({ score: Number(sumRow?.score ?? 0) });
});

communityRouter.post('/questions/:postId/best-answer', requireAuth, (req, res) => {
  const postId = Number(req.params.postId);
  const answerId = Number(req.body?.answerId);
  const post = db.prepare('SELECT author_id FROM posts WHERE id = ?').get(postId) as
    | { author_id: number }
    | undefined;

  if (!post || post.author_id !== req.user!.id) {
    res.status(403).json({ error: 'صاحب السؤال فقط يمكنه اختيار أفضل إجابة.' });
    return;
  }

  const ans = db
    .prepare('SELECT id, author_id FROM answers WHERE id = ? AND question_post_id = ?')
    .get(answerId, postId) as { id: number; author_id: number } | undefined;
  if (!ans) {
    res.status(404).json({ error: 'الإجابة غير موجودة.' });
    return;
  }

  db.prepare('UPDATE answers SET is_best = 0 WHERE question_post_id = ?').run(postId);
  db.prepare('UPDATE answers SET is_best = 1 WHERE id = ?').run(answerId);
  db.prepare('UPDATE questions SET best_answer_id = ? WHERE post_id = ?').run(answerId, postId);

  if (ans.author_id !== req.user!.id) {
    awardUserPoints(ans.author_id, 'best_answer', answerId);
    pushNotification({
      userId: ans.author_id,
      type: 'reaction',
      title: 'أفضل إجابة!',
      body: 'تم اختيار إجابتك كأفضل إجابة وحصلت على 25 نقطة.',
      targetType: 'post',
      targetId: postId,
      actorId: req.user!.id,
    });
  }

  res.json({ ok: true, bestAnswerId: answerId });
});

// Polls: vote once per account
communityRouter.post('/polls/:postId/vote', requireActiveAccount, (req, res) => {
  const postId = Number(req.params.postId);
  const optionId = Number(req.body?.optionId);
  const userId = req.user!.id;

  const poll = db.prepare('SELECT ends_at FROM polls WHERE post_id = ?').get(postId) as
    | { ends_at: string | null }
    | undefined;
  if (!poll) {
    res.status(404).json({ error: 'التصويت غير موجود.' });
    return;
  }
  if (poll.ends_at && new Date(poll.ends_at).getTime() < Date.now()) {
    res.status(400).json({ error: 'انتهت مدة هذا التصويت.' });
    return;
  }

  const opt = db
    .prepare('SELECT id FROM poll_options WHERE id = ? AND poll_post_id = ?')
    .get(optionId, postId);
  if (!opt) {
    res.status(400).json({ error: 'خيار التصويت غير صالح.' });
    return;
  }

  const already = db
    .prepare('SELECT id FROM poll_votes WHERE poll_post_id = ? AND user_id = ?')
    .get(postId, userId);
  if (already) {
    res.status(409).json({ error: 'يمكن التصويت مرة واحدة فقط لكل حساب.' });
    return;
  }

  db.prepare('INSERT INTO poll_votes (poll_post_id, option_id, user_id) VALUES (?, ?, ?)').run(
    postId,
    optionId,
    userId
  );

  const row = db
    .prepare(`${POST_BASE_SELECT} WHERE p.id = ?`)
    .get(postId) as unknown as PostRow;
  const serialized = serializePost(row, userId);
  if (serialized.poll) {
    broadcastPostEvent(
      postId,
      {
        type: 'poll:voted',
        postId,
        options: serialized.poll.options,
        totalVotes: serialized.poll.totalVotes,
      },
      userId
    );
  }
  res.json({ post: serialized });
});

// Communities
communityRouter.get('/communities', (req, res) => {
  const currentUserId = req.user?.id ?? null;
  const q = String(req.query.q || '').trim().toLowerCase();
  const category = String(req.query.category || '');

  const rows = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id) AS members_count,
              (SELECT COUNT(*) FROM posts p WHERE p.community_id = c.id AND p.is_hidden = 0) AS posts_count
       FROM communities c
       WHERE c.is_hidden = 0
       ORDER BY members_count DESC, c.created_at DESC`
    )
    .all() as Array<Record<string, unknown>>;

  let items = rows.map((r) => {
    let myRole: string | null = null;
    if (currentUserId) {
      const m = db
        .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
        .get(Number(r.id), currentUserId) as { role: string } | undefined;
      myRole = m?.role ?? null;
    }
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      category: r.category,
      avatarUrl: r.avatar_url,
      coverUrl: r.cover_url,
      rules: r.rules,
      privacy: r.privacy,
      whoCanPost: r.who_can_post,
      membersCount: Number(r.members_count ?? 0),
      postsCount: Number(r.posts_count ?? 0),
      isMember: myRole !== null,
      myRole,
      createdAt: r.created_at,
    };
  });

  if (category && category !== 'الكل') {
    items = items.filter((c) => c.category === category);
  }
  if (q) {
    items = items.filter(
      (c) =>
        String(c.name).toLowerCase().includes(q) ||
        String(c.description).toLowerCase().includes(q) ||
        String(c.category).toLowerCase().includes(q)
    );
  }

  res.json({ communities: items });
});

communityRouter.post('/communities', requireActiveAccount, rateLimit('community', 5, 60000), (req, res) => {
  const userId = req.user!.id;
  const {
    name,
    description,
    category = 'عام',
    rules = '',
    privacy = 'public',
    whoCanPost = 'members',
    avatarUrl,
    coverUrl,
  } = req.body ?? {};

  const cleanName = String(name || '').trim();
  const cleanDesc = String(description || '').trim();
  if (cleanName.length < 3 || cleanName.length > 60) {
    res.status(400).json({ error: 'اسم المجتمع يجب أن يكون بين 3 و60 حرفًا.' });
    return;
  }
  if (cleanDesc.length < 8) {
    res.status(400).json({ error: 'يرجى كتابة وصف واضح للمجتمع.' });
    return;
  }

  const safety = checkContentSafety(`${cleanName} ${cleanDesc}`);
  if (!safety.safe) {
    res.status(400).json({ error: safety.reason });
    return;
  }

  const dup = db.prepare('SELECT id FROM communities WHERE name = ?').get(cleanName);
  if (dup) {
    res.status(409).json({ error: 'يوجد مجتمع بهذا الاسم بالفعل.' });
    return;
  }

  const slug = `comm-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const safeAvatar =
    sanitizeMediaUrl(avatarUrl) || '/src/assets/images/meen_brand_emblem_1795731517188.jpg';
  const safeCover =
    sanitizeMediaUrl(coverUrl) || '/src/assets/images/meen_community_cover_1795731518126.jpg';

  const insert = db
    .prepare(
      `INSERT INTO communities (name, slug, description, category, avatar_url, cover_url, rules, privacy, who_can_post, creator_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      cleanName,
      slug,
      cleanDesc.slice(0, 400),
      String(category),
      safeAvatar,
      safeCover,
      String(rules || 'احترم الجميع والتزم بقواعد مين؟ الآمنة.').slice(0, 800),
      privacy === 'private' ? 'private' : 'public',
      whoCanPost === 'moderators' ? 'moderators' : 'members',
      userId
    );

  const communityId = Number(insert.lastInsertRowid);
  db.prepare(
    `INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, 'owner')`
  ).run(communityId, userId);

  awardUserPoints(userId, 'community_join', communityId);

  res.status(201).json({ id: communityId, slug, ok: true });
});

communityRouter.get('/communities/:id', (req, res) => {
  const communityId = Number(req.params.id);
  const currentUserId = req.user?.id ?? null;

  const comm = db
    .prepare('SELECT * FROM communities WHERE id = ? AND is_hidden = 0')
    .get(communityId) as Record<string, unknown> | undefined;
  if (!comm) {
    res.status(404).json({ error: 'المجتمع غير موجود.' });
    return;
  }

  const members = db
    .prepare(
      `SELECT u.id, u.username, p.display_name, p.avatar, cm.role, cm.joined_at
       FROM community_members cm
       JOIN users u ON u.id = cm.user_id
       JOIN profiles p ON p.user_id = u.id
       WHERE cm.community_id = ? AND u.status = 'active'
       ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, cm.joined_at ASC`
    )
    .all(communityId) as Array<Record<string, unknown>>;

  const myMember = currentUserId
    ? members.find((m) => Number(m.id) === currentUserId)
    : undefined;

  const canSeePosts = comm.privacy === 'public' || Boolean(myMember);
  let posts: unknown[] = [];
  if (canSeePosts) {
    const rawPosts = db
      .prepare(`${POST_BASE_SELECT} WHERE p.community_id = ? AND p.is_hidden = 0 ORDER BY p.id DESC LIMIT 60`)
      .all(communityId) as unknown as PostRow[];
    posts = rawPosts
      .filter((r) => canViewPost(r, currentUserId))
      .map((r) => serializePost(r, currentUserId));
  }

  res.json({
    community: {
      id: comm.id,
      name: comm.name,
      slug: comm.slug,
      description: comm.description,
      category: comm.category,
      avatarUrl: comm.avatar_url,
      coverUrl: comm.cover_url,
      rules: comm.rules,
      privacy: comm.privacy,
      whoCanPost: comm.who_can_post,
      membersCount: members.length,
      isMember: Boolean(myMember),
      myRole: myMember?.role ?? null,
      moderators: members.filter((m) => m.role === 'owner' || m.role === 'moderator'),
      members,
      posts,
    },
  });
});

communityRouter.post('/communities/:id/join', requireActiveAccount, (req, res) => {
  const communityId = Number(req.params.id);
  const userId = req.user!.id;

  const comm = db
    .prepare('SELECT id FROM communities WHERE id = ? AND is_hidden = 0')
    .get(communityId);
  if (!comm) {
    res.status(404).json({ error: 'المجتمع غير موجود.' });
    return;
  }

  const existing = db
    .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
    .get(communityId, userId) as { role: string } | undefined;

  if (existing) {
    if (existing.role === 'owner') {
      res.status(400).json({ error: 'منشئ المجتمع لا يمكنه المغادرة مباشرة.' });
      return;
    }
    db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(
      communityId,
      userId
    );
    res.json({ joined: false });
  } else {
    db.prepare(
      `INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, 'member')`
    ).run(communityId, userId);
    awardUserPoints(userId, 'community_join', communityId);
    res.json({ joined: true });
  }
});

// Daily Question + Archive + Answers
communityRouter.get('/daily-question', (req, res) => {
  const currentUserId = req.user?.id ?? null;
  const active = db
    .prepare('SELECT * FROM daily_questions WHERE is_active = 1 ORDER BY id DESC LIMIT 1')
    .get() as Record<string, unknown> | undefined;

  const archive = db
    .prepare('SELECT * FROM daily_questions ORDER BY id DESC LIMIT 20')
    .all() as Array<Record<string, unknown>>;

  const targetDailyId = req.query.id ? Number(req.query.id) : Number(active?.id ?? 0);
  let answers: unknown[] = [];
  if (targetDailyId) {
    const rows = db
      .prepare(
        `${POST_BASE_SELECT} WHERE p.daily_question_id = ? AND p.is_hidden = 0 ORDER BY p.id DESC LIMIT 60`
      )
      .all(targetDailyId) as unknown as PostRow[];
    answers = rows
      .filter((r) => canViewPost(r, currentUserId))
      .map((r) => serializePost(r, currentUserId));
  }

  res.json({
    activeQuestion: active
      ? {
          id: active.id,
          questionText: active.question_text,
          dateKey: active.date_key,
          createdAt: active.created_at,
        }
      : null,
    archive: archive.map((q) => ({
      id: q.id,
      questionText: q.question_text,
      dateKey: q.date_key,
      isActive: Number(q.is_active) === 1,
    })),
    answers,
  });
});

communityRouter.post(
  '/daily-question/:id/answer',
  requireActiveAccount,
  rateLimit('daily_ans', 10, 60000),
  (req, res) => {
    const dailyId = Number(req.params.id);
    const userId = req.user!.id;
    const { content, isAnonymous = false } = req.body ?? {};

    const dq = db.prepare('SELECT id FROM daily_questions WHERE id = ?').get(dailyId);
    if (!dq) {
      res.status(404).json({ error: 'السؤال اليومي غير موجود.' });
      return;
    }

    const clean = String(content || '').trim();
    const safety = checkContentSafety(clean);
    if (!safety.safe) {
      res.status(400).json({ error: safety.reason });
      return;
    }

    const insert = db
      .prepare(
        `INSERT INTO posts (author_id, type, category, content, is_anonymous, daily_question_id)
         VALUES (?, 'post', 'سؤال اليوم', ?, ?, ?)`
      )
      .run(userId, clean.slice(0, 1500), isAnonymous ? 1 : 0, dailyId);

    const postId = Number(insert.lastInsertRowid);
    awardUserPoints(userId, 'daily_question', postId, clean);

    const createdRow = db
      .prepare(`${POST_BASE_SELECT} WHERE p.id = ?`)
      .get(postId) as unknown as PostRow;
    res.status(201).json({ post: serializePost(createdRow, userId) });
  }
);

// Challenges
communityRouter.get('/challenges', (req, res) => {
  const currentUserId = req.user?.id ?? null;
  const rows = db
    .prepare(
      `SELECT ch.*, (SELECT COUNT(*) FROM challenge_entries ce WHERE ce.challenge_id = ch.id) AS entries_count
       FROM challenges ch ORDER BY CASE ch.status WHEN 'active' THEN 0 ELSE 1 END, ch.created_at DESC`
    )
    .all() as Array<Record<string, unknown>>;

  const items = rows.map((ch) => {
    const entriesRows = db
      .prepare(
        `${POST_BASE_SELECT}
         JOIN challenge_entries ce ON ce.post_id = p.id
         WHERE ce.challenge_id = ? AND p.is_hidden = 0
         ORDER BY p.id DESC LIMIT 20`
      )
      .all(Number(ch.id)) as unknown as PostRow[];

    const userParticipated = currentUserId
      ? Boolean(
          db
            .prepare('SELECT 1 FROM challenge_entries WHERE challenge_id = ? AND user_id = ?')
            .get(Number(ch.id), currentUserId)
        )
      : false;

    return {
      id: ch.id,
      title: ch.title,
      description: ch.description,
      category: ch.category,
      pointsReward: Number(ch.points_reward),
      badgeSlug: ch.badge_slug,
      startsAt: ch.starts_at,
      endsAt: ch.ends_at,
      status: ch.status,
      entriesCount: Number(ch.entries_count ?? 0),
      userParticipated,
      entries: entriesRows
        .filter((r) => canViewPost(r, currentUserId))
        .map((r) => serializePost(r, currentUserId)),
    };
  });

  res.json({ challenges: items });
});

communityRouter.post(
  '/challenges/:id/enter',
  requireActiveAccount,
  rateLimit('challenge_enter', 8, 60000),
  (req, res) => {
    const challengeId = Number(req.params.id);
    const userId = req.user!.id;
    const { content, mediaUrl, isAnonymous = false } = req.body ?? {};

    const ch = db
      .prepare('SELECT id, status FROM challenges WHERE id = ?')
      .get(challengeId) as { id: number; status: string } | undefined;
    if (!ch || ch.status !== 'active') {
      res.status(400).json({ error: 'التحدي غير متاح حاليًا.' });
      return;
    }

    const clean = String(content || '').trim();
    const safety = checkContentSafety(clean);
    if (!safety.safe) {
      res.status(400).json({ error: safety.reason });
      return;
    }
    const safeMedia = sanitizeMediaUrl(mediaUrl);

    const insertPost = db
      .prepare(
        `INSERT INTO posts (author_id, type, category, content, media_url, is_anonymous, challenge_id)
         VALUES (?, 'challenge_entry', 'التحديات', ?, ?, ?, ?)`
      )
      .run(userId, clean.slice(0, 1500), safeMedia, isAnonymous ? 1 : 0, challengeId);

    const postId = Number(insertPost.lastInsertRowid);
    db.prepare(
      'INSERT INTO challenge_entries (challenge_id, post_id, user_id) VALUES (?, ?, ?)'
    ).run(challengeId, postId, userId);

    awardUserPoints(userId, 'challenge_entry', postId, clean);
    res.status(201).json({ ok: true, postId });
  }
);

// Explore & Global Search & Trending
communityRouter.get('/explore', (req, res) => {
  const currentUserId = req.user?.id ?? null;
  const q = String(req.query.q || '').trim();
  const filter = String(req.query.filter || 'all');

  const categories = getSetting<string[]>('categories', []);

  // Posts & Confessions & Questions & Polls
  const rawPosts = db
    .prepare(`${POST_BASE_SELECT} WHERE p.is_hidden = 0 ORDER BY p.id DESC LIMIT 120`)
    .all() as unknown as PostRow[];
  const visiblePosts = rawPosts
    .filter((r) => canViewPost(r, currentUserId))
    .map((r) => serializePost(r, currentUserId));

  const trendingPosts = [...visiblePosts].sort((a, b) => b.trendingScore - a.trendingScore);

  const rawCommunities = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id) AS members_count,
              (SELECT COUNT(*) FROM posts p WHERE p.community_id = c.id AND p.is_hidden = 0) AS posts_count
       FROM communities c WHERE c.is_hidden = 0 ORDER BY members_count DESC LIMIT 12`
    )
    .all() as Array<Record<string, unknown>>;

  const activeCommunities = rawCommunities.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    category: r.category,
    avatarUrl: r.avatar_url,
    coverUrl: r.cover_url,
    rules: r.rules,
    privacy: r.privacy,
    whoCanPost: r.who_can_post,
    membersCount: Number(r.members_count ?? 0),
    postsCount: Number(r.posts_count ?? 0),
    createdAt: r.created_at,
  }));

  const suggestedUsers = db
    .prepare(
      `SELECT u.id, u.username, p.display_name, p.avatar, p.bio
       FROM users u JOIN profiles p ON p.user_id = u.id
       WHERE u.status = 'active' AND p.privacy_level = 'public'
       ${currentUserId ? 'AND u.id != ?' : ''}
       ORDER BY u.last_active_at DESC LIMIT 12`
    )
    .all(...(currentUserId ? [currentUserId] : []));

  // Trending topics computed strictly from real posts
  const topicMap = new Map<string, number>();
  for (const p of visiblePosts) {
    topicMap.set(p.category, (topicMap.get(p.category) || 0) + 1);
  }
  const trendingTopics = Array.from(topicMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  if (!q) {
    res.json({
      categories,
      trendingTopics,
      trendingPosts: trendingPosts.slice(0, 10),
      worthyConfessions: trendingPosts.filter((p) => p.type === 'confession').slice(0, 6),
      popularQuestions: trendingPosts.filter((p) => p.type === 'question').slice(0, 6),
      activeCommunities,
      suggestedUsers,
    });
    return;
  }

  const lowerQ = q.toLowerCase();
  const matchedUsers =
    filter === 'all' || filter === 'users'
      ? (db
          .prepare(
            `SELECT u.id, u.username, p.display_name, p.avatar, p.bio
             FROM users u JOIN profiles p ON p.user_id = u.id
             WHERE u.status = 'active' AND p.privacy_level != 'limited'
               AND (LOWER(u.username) LIKE ? OR LOWER(p.display_name) LIKE ?)
             LIMIT 25`
          )
          .all(`%${lowerQ}%`, `%${lowerQ}%`) as Array<Record<string, unknown>>)
      : [];

  const matchedPosts =
    filter === 'all' || filter === 'posts' || filter === 'categories'
      ? visiblePosts.filter(
          (p) =>
            p.content.toLowerCase().includes(lowerQ) ||
            p.category.toLowerCase().includes(lowerQ) ||
            (p.moodType && p.moodType.toLowerCase().includes(lowerQ))
        )
      : [];

  const matchedCommunities =
    filter === 'all' || filter === 'communities'
      ? (activeCommunities as Array<Record<string, unknown>>).filter(
          (c) =>
            String(c.name).toLowerCase().includes(lowerQ) ||
            String(c.description).toLowerCase().includes(lowerQ) ||
            String(c.category).toLowerCase().includes(lowerQ)
        )
      : [];

  const matchedCategories = categories.filter((c) => c.toLowerCase().includes(lowerQ));

  res.json({
    query: q,
    users: matchedUsers,
    posts: matchedPosts,
    communities: matchedCommunities,
    categories: matchedCategories,
  });
});

communityRouter.get('/trending', (req, res) => {
  const currentUserId = req.user?.id ?? null;
  const rawPosts = db
    .prepare(`${POST_BASE_SELECT} WHERE p.is_hidden = 0 ORDER BY p.id DESC LIMIT 150`)
    .all() as unknown as PostRow[];

  const ranked = rawPosts
    .filter((r) => canViewPost(r, currentUserId))
    .map((r) => serializePost(r, currentUserId))
    .sort((a, b) => b.trendingScore - a.trendingScore);

  const rawTrendingComms = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id) AS members_count,
              (SELECT COUNT(*) FROM posts p WHERE p.community_id = c.id AND p.is_hidden = 0) AS posts_count
       FROM communities c WHERE c.is_hidden = 0
       ORDER BY (posts_count * 2 + members_count) DESC LIMIT 10`
    )
    .all() as Array<Record<string, unknown>>;

  const communities = rawTrendingComms.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    category: r.category,
    avatarUrl: r.avatar_url,
    coverUrl: r.cover_url,
    rules: r.rules,
    privacy: r.privacy,
    whoCanPost: r.who_can_post,
    membersCount: Number(r.members_count ?? 0),
    postsCount: Number(r.posts_count ?? 0),
    createdAt: r.created_at,
  }));

  const topicMap = new Map<string, number>();
  for (const p of ranked) {
    topicMap.set(p.category, (topicMap.get(p.category) || 0) + 1);
  }
  const topics = Array.from(topicMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  res.json({
    posts: ranked.filter((p) => p.type === 'post' || p.type === 'confession').slice(0, 20),
    questions: ranked.filter((p) => p.type === 'question').slice(0, 15),
    polls: ranked.filter((p) => p.type === 'poll').slice(0, 15),
    communities,
    topics,
  });
});

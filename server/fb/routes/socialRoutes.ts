import { Router } from 'express';
import { rtdb } from '../admin.ts';
import { bump, get, getKeyed, insert, lastN, nowIso, pairKey, patch, putKeyed, remove, where } from '../store.ts';
import { awardUserPoints, getUserPointsTotal } from '../core.ts';
import { rateLimit, rateLimitMemory, requireActiveAccount, requireAuth } from '../middleware.ts';
import { broadcastPostEvent, pushNotification, sendToUser } from '../realtime.ts';
import { buildCtx, canViewPost, commOf, isBlocked, serializePost, userOf, type Ctx } from '../posts.ts';
import { checkContentSafety, sanitizeMediaUrl } from '../../../src/lib/validation.ts';
import { getLevelInfo } from '../../../src/lib/gamification.ts';
import { purgePost } from '../cascade.ts';

export const socialRouter = Router();

const num = (v: unknown) => Number(v);
const NOT_FOUND_POST = { error: 'المنشور غير موجود.' };

async function loadVisiblePost(ctx: Ctx, id: number) {
  if (!Number.isFinite(id)) return null;
  const post = await get<any>('posts', id);
  if (!post || !(await canViewPost(ctx, post)) || (ctx.uid && isBlocked(ctx, post.author_id))) return null;
  return post;
}

// ---------- Feed ----------
socialRouter.get('/posts', rateLimitMemory('read', 180, 60000), async (req, res) => {
  const ctx = await buildCtx(req.user?.id ?? null);
  const filter = String(req.query.filter || 'latest');
  const category = String(req.query.category || '');
  const type = String(req.query.type || '');
  const moodType = String(req.query.moodType || '');
  const communityId = req.query.communityId ? Number(req.query.communityId) : null;
  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  const limit = Number.isFinite(rawLimit) ? Math.min(30, Math.max(1, Math.trunc(rawLimit))) : 15;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;
  const allowedTypes = new Set(['post', 'confession', 'question', 'poll', 'challenge_entry']);

  // Only load as much history as this page can actually show, instead of a fixed
  // 400 posts per request for every visitor.
  const windowSize = Math.min(200, Math.max(60, offset + limit * 4));
  const recent = await lastN<any>('posts', windowSize);
  const rows = recent
    .filter((p) => p.is_hidden !== 1)
    .filter((p) => !(type && allowedTypes.has(type)) || p.type === type)
    .filter((p) => !category || category === 'الكل' || p.category === category)
    .filter((p) => !moodType || moodType === 'الكل' || p.mood_type === moodType)
    .filter((p) => !communityId || p.community_id === communityId)
    .filter((p) => !ctx.uid || !isBlocked(ctx, p.author_id))
    .slice(0, 120);

  const visibleRows: any[] = [];
  for (const r of rows) if (await canViewPost(ctx, r)) visibleRows.push(r);
  let visible = await Promise.all(visibleRows.map((r) => serializePost(ctx, r)));

  if (filter === 'friends' && ctx.uid) {
    visible = visible.filter((p) => p.isOwner || (!p.isAnonymous && p.author?.id !== undefined && ctx.friends.has(p.author.id)));
  }
  if (filter === 'interests' && ctx.uid) {
    const me = await userOf(ctx, ctx.uid);
    const interests: string[] = Array.isArray(me?.interests) ? me.interests : [];
    if (interests.length > 0) {
      const set = new Set(interests);
      const matched = visible.filter((p) => set.has(p.category));
      if (matched.length > 0) visible = matched;
    }
  }
  if (filter === 'top' || filter === 'trending') visible.sort((a, b) => b.trendingScore - a.trendingScore);

  const total = visible.length;
  res.json({ items: visible.slice(offset, offset + limit), total, hasMore: offset + limit < total });
});

socialRouter.get('/posts/:id', rateLimitMemory('read', 180, 60000), async (req, res) => {
  const ctx = await buildCtx(req.user?.id ?? null);
  const post = await loadVisiblePost(ctx, num(req.params.id));
  if (!post) return void res.status(404).json({ error: 'المنشور غير موجود أو غير متاح للعرض.' });
  res.json({ post: await serializePost(ctx, post) });
});

// ---------- Create / edit / delete ----------
socialRouter.post('/posts', requireActiveAccount, rateLimit('create_post', 12, 60000), async (req, res) => {
  const userId = req.user!.id;
  const {
    type = 'post', category = 'فضفضة', moodType = 'فضفضة عامة', content, mediaUrl, isAnonymous = false,
    allowComments = true, audience = 'public', communityId = null, questionType = 'عام', allowVoting = true,
    pollOptions = [], pollShowResults = 'always', pollDurationHours = null,
  } = req.body ?? {};
  if (!new Set(['post', 'confession', 'question', 'poll']).has(type)) return void res.status(400).json({ error: 'نوع المنشور غير صالح.' });
  const cleanContent = typeof content === 'string' ? content.trim() : '';
  const safety = checkContentSafety(cleanContent);
  if (!safety.safe) return void res.status(400).json({ error: safety.reason });
  if (cleanContent.length > 3000) return void res.status(400).json({ error: 'النص يتجاوز الحد الأقصى (3000 حرف).' });
  const safeMedia = sanitizeMediaUrl(mediaUrl);
  const cleanAudience = audience === 'friends' || audience === 'community' ? audience : 'public';

  if (communityId) {
    const comm = await get<any>('communities', Number(communityId));
    if (!comm || comm.is_hidden === 1) return void res.status(404).json({ error: 'المجتمع غير موجود.' });
    const member = await getKeyed<any>('community_members', `${comm.id}_${userId}`);
    if (!member) return void res.status(403).json({ error: 'يجب الانضمام للمجتمع أولًا قبل النشر فيه.' });
    if (comm.who_can_post === 'moderators' && member.role === 'member') return void res.status(403).json({ error: 'النشر في هذا المجتمع متاح للمشرفين فقط.' });
  }
  let pollDoc: any = undefined;
  if (type === 'poll') {
    const opts = Array.isArray(pollOptions) ? pollOptions.map((o: unknown) => String(o).trim()).filter(Boolean) : [];
    if (opts.length < 2 || opts.length > 8) return void res.status(400).json({ error: 'التصويت يجب أن يحتوي على خيارين إلى 8 خيارات.' });
    pollDoc = {
      ends_at: pollDurationHours && Number(pollDurationHours) > 0 ? new Date(Date.now() + Number(pollDurationHours) * 3600 * 1000).toISOString() : null,
      show_results_mode: pollShowResults === 'after_vote' ? 'after_vote' : 'always',
      options: opts.map((label: string, i: number) => ({ id: i + 1, label: label.slice(0, 100), votes: 0 })),
    };
  }
  const anon = isAnonymous || moodType === 'فضفضة بدون اسم' ? 1 : 0;
  const now = nowIso();
  const post = await insert('posts', {
    author_id: userId, type, category: String(category || 'فضفضة').slice(0, 60), content: cleanContent,
    media_url: safeMedia, is_anonymous: anon, allow_comments: allowComments ? 1 : 0,
    audience: communityId ? 'community' : cleanAudience, community_id: communityId ? Number(communityId) : null,
    daily_question_id: null, challenge_id: null, shares_count: 0, is_hidden: 0, created_at: now, updated_at: now,
    likes_count: 0, supports_count: 0, comments_count: 0, saves_count: 0, reports_count: 0,
    mood_type: type === 'confession' ? String(moodType || 'فضفضة عامة').slice(0, 60) : null,
    question_type: type === 'question' ? String(questionType || 'عام') : null,
    allow_voting: type === 'question' ? (allowVoting ? 1 : 0) : null,
    answers_count: 0, poll: pollDoc,
  });
  if (communityId) await bump('communities', Number(communityId), 'posts_count', 1);
  await awardUserPoints(userId, 'create_post', post.id, cleanContent);
  const ctx = await buildCtx(userId);
  await broadcastPostEvent(post.id, { type: 'feed:new_post', postId: post.id });
  res.status(201).json({ post: await serializePost(ctx, post) });
});

socialRouter.patch('/posts/:id', requireActiveAccount, async (req, res) => {
  const postId = num(req.params.id);
  const post = await get<any>('posts', postId);
  if (!post || post.is_hidden === 1) return void res.status(404).json(NOT_FOUND_POST);
  if (post.author_id !== req.user!.id) return void res.status(403).json({ error: 'لا يمكنك تعديل منشور لا تملكه.' });
  const clean = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  const safety = checkContentSafety(clean);
  if (!safety.safe) return void res.status(400).json({ error: safety.reason });
  if (clean.length > 3000) return void res.status(400).json({ error: 'النص يتجاوز الحد الأقصى (3000 حرف).' });
  await patch('posts', postId, { content: clean, updated_at: nowIso() });
  const ctx = await buildCtx(req.user!.id);
  await broadcastPostEvent(postId, { type: 'post:updated' });
  res.json({ post: await serializePost(ctx, { ...post, content: clean }) });
});

socialRouter.delete('/posts/:id', requireAuth, async (req, res) => {
  const postId = num(req.params.id);
  const post = await get<any>('posts', postId);
  if (!post) return void res.status(404).json(NOT_FOUND_POST);
  if (post.author_id !== req.user!.id && req.user!.role !== 'admin') return void res.status(403).json({ error: 'لا يمكنك حذف منشور لا تملكه.' });
  await broadcastPostEvent(postId, { type: 'post:deleted' });
  await purgePost(postId);
  res.json({ ok: true });
});

// ---------- Reactions / share / follow / save ----------
socialRouter.post('/posts/:id/react', requireActiveAccount, rateLimit('react', 40, 60000), async (req, res) => {
  const postId = num(req.params.id);
  const userId = req.user!.id;
  const reactionType = req.body?.reactionType === 'support' ? 'support' : 'like';
  const ctx = await buildCtx(userId);
  const post = await loadVisiblePost(ctx, postId);
  if (!post) return void res.status(404).json(NOT_FOUND_POST);
  const key = `post_${postId}_${userId}_${reactionType}`;
  const field = reactionType === 'support' ? 'supports_count' : 'likes_count';
  // atomic toggle
  const tx = await rtdb.ref(`t/reactions/${key}`).transaction((v) =>
    v ? null : { id: key, target_type: 'post', target_id: postId, user_id: userId, reaction_type: reactionType, created_at: nowIso() }
  );
  const active = Boolean(tx.snapshot.val());
  await bump('posts', postId, field, active ? 1 : -1);
  if (active) {
    if (reactionType === 'support') await awardUserPoints(userId, 'give_support', postId);
    await pushNotification({
      userId: post.author_id, type: 'reaction',
      title: reactionType === 'support' ? 'وصلتك رسالة دعم' : 'إعجاب جديد',
      body: reactionType === 'support' ? `${req.user!.displayName} قدّم دعمًا لمنشورك.` : `${req.user!.displayName} أعجب بمنشورك.`,
      targetType: 'post', targetId: postId, actorId: userId,
    });
  }
  const fresh = await get<any>('posts', postId);
  const likesCount = Number(fresh?.likes_count || 0);
  const supportsCount = Number(fresh?.supports_count || 0);
  await broadcastPostEvent(postId, { type: 'post:reaction', likesCount, supportsCount });
  res.json({ active, reactionType, likesCount, supportsCount });
});

socialRouter.post('/posts/:id/share', requireAuth, rateLimit('share', 20, 60000), async (req, res) => {
  const postId = num(req.params.id);
  const ctx = await buildCtx(req.user!.id);
  if (!(await loadVisiblePost(ctx, postId))) return void res.status(404).json(NOT_FOUND_POST);
  res.json({ sharesCount: await bump('posts', postId, 'shares_count', 1) });
});

socialRouter.post('/posts/:id/follow', requireAuth, async (req, res) => {
  const postId = num(req.params.id);
  const userId = req.user!.id;
  const ctx = await buildCtx(userId);
  if (!(await loadVisiblePost(ctx, postId))) return void res.status(404).json(NOT_FOUND_POST);
  const key = `${userId}_${postId}`;
  const tx = await rtdb.ref(`t/post_follows/${key}`).transaction((v) => (v ? null : { id: key, user_id: userId, post_id: postId, created_at: nowIso() }));
  res.json({ following: Boolean(tx.snapshot.val()) });
});

socialRouter.post('/posts/:id/save', requireAuth, async (req, res) => {
  const postId = num(req.params.id);
  const userId = req.user!.id;
  const tag = typeof req.body?.tag === 'string' && req.body.tag.trim() ? req.body.tag.trim().slice(0, 60) : 'عام';
  const ctx = await buildCtx(userId);
  if (!(await loadVisiblePost(ctx, postId))) return void res.status(404).json(NOT_FOUND_POST);
  const key = `${userId}_${postId}`;
  const tx = await rtdb.ref(`t/saved_posts/${key}`).transaction((v) => (v ? null : { id: key, user_id: userId, post_id: postId, collection_tag: tag, created_at: nowIso() }));
  const saved = Boolean(tx.snapshot.val());
  await bump('posts', postId, 'saves_count', saved ? 1 : -1);
  res.json({ saved });
});

socialRouter.get('/saved', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const q = String(req.query.q || '').trim().toLowerCase();
  const type = String(req.query.type || '');
  const ctx = await buildCtx(userId);
  const saves = (await where<any>('saved_posts', 'user_id', userId)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  let items: any[] = [];
  for (const s of saves) {
    const p = await get<any>('posts', s.post_id);
    if (!p || p.is_hidden === 1 || !(await canViewPost(ctx, p))) continue;
    items.push({ ...(await serializePost(ctx, p)), collectionTag: s.collection_tag, savedAt: s.created_at });
  }
  if (type && type !== 'all') items = items.filter((i) => (type === 'community' ? i.communityId !== null : i.type === type));
  if (q) items = items.filter((i) => i.content.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
  res.json({ items });
});

// ---------- Comments ----------
const authorView = (u: any) => ({ id: u.id, username: u.username, displayName: u.display_name, avatar: u.avatar });

socialRouter.get('/posts/:id/comments', rateLimitMemory('read', 180, 60000), async (req, res) => {
  const postId = num(req.params.id);
  const ctx = await buildCtx(req.user?.id ?? null);
  if (!(await loadVisiblePost(ctx, postId))) return void res.status(404).json(NOT_FOUND_POST);
  const comments = (await where<any>('comments', 'post_id', postId)).filter((c) => c.is_hidden !== 1).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const out = [];
  for (const c of comments) {
    const cu = await userOf(ctx, c.author_id);
    const replies = (await where<any>('comment_replies', 'comment_id', c.id)).filter((r) => r.is_hidden !== 1).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const rv = [];
    for (const r of replies) {
      const ru = await userOf(ctx, r.author_id);
      rv.push({
        id: r.id, commentId: r.comment_id, content: r.content, isAnonymous: r.is_anonymous === 1,
        isOwner: ctx.uid === r.author_id, author: r.is_anonymous === 1 || !ru ? null : authorView(ru), createdAt: r.created_at,
      });
    }
    out.push({
      id: c.id, postId: c.post_id, content: c.content, isAnonymous: c.is_anonymous === 1, isOwner: ctx.uid === c.author_id,
      author: c.is_anonymous === 1 || !cu ? null : authorView(cu), createdAt: c.created_at, replies: rv,
    });
  }
  res.json({ comments: out });
});

socialRouter.post('/posts/:id/comments', requireActiveAccount, rateLimit('comment', 25, 60000), async (req, res) => {
  const postId = num(req.params.id);
  const userId = req.user!.id;
  const ctx = await buildCtx(userId);
  const post = await loadVisiblePost(ctx, postId);
  if (!post) return void res.status(404).json(NOT_FOUND_POST);
  if (post.allow_comments === 0) return void res.status(403).json({ error: 'التعليقات مغلقة على هذا المنشور.' });
  const author = await userOf(ctx, post.author_id);
  if (post.author_id !== userId) {
    if (author.allow_comments_from === 'none') return void res.status(403).json({ error: 'صاحب المنشور أوقف التعليقات حاليًا.' });
    if (author.allow_comments_from === 'friends' && !ctx.friends.has(post.author_id)) return void res.status(403).json({ error: 'التعليقات متاحة للأصدقاء فقط.' });
  }
  const clean = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  const safety = checkContentSafety(clean);
  if (!safety.safe) return void res.status(400).json({ error: safety.reason });
  const anon = req.body?.isAnonymous ? 1 : 0;
  const createdAt = nowIso();
  const c = await insert('comments', { post_id: postId, author_id: userId, content: clean.slice(0, 1200), is_anonymous: anon, is_hidden: 0, created_at: createdAt });
  const commentsCount = await bump('posts', postId, 'comments_count', 1);
  await awardUserPoints(userId, 'create_comment', c.id, clean);
  await pushNotification({
    userId: post.author_id, type: 'comment', title: 'تعليق جديد',
    body: anon ? 'أضاف شخص مجهول تعليقًا على منشورك.' : `${req.user!.displayName} علّق على منشورك.`,
    targetType: 'post', targetId: postId, actorId: userId, isAnonymousActor: Boolean(anon),
  });
  const followers = (await where<any>('post_follows', 'post_id', postId)).filter((f) => f.user_id !== userId && f.user_id !== post.author_id);
  for (const f of followers) {
    await pushNotification({
      userId: f.user_id, type: 'comment', title: 'تحديث على منشور تتابعه', body: 'تمت إضافة تعليق جديد على منشور تتابعه.',
      targetType: 'post', targetId: postId, actorId: userId, isAnonymousActor: Boolean(anon),
    });
  }
  await broadcastPostEvent(postId, { type: 'post:comment_new', commentsCount });
  res.status(201).json({
    comment: {
      id: c.id, postId, content: clean.slice(0, 1200), isAnonymous: Boolean(anon), isOwner: true,
      author: anon ? null : authorView({ id: userId, username: req.user!.username, display_name: req.user!.displayName, avatar: req.user!.avatar }),
      createdAt, replies: [],
    },
  });
});

socialRouter.post('/comments/:commentId/replies', requireActiveAccount, rateLimit('reply', 25, 60000), async (req, res) => {
  const commentId = num(req.params.commentId);
  const userId = req.user!.id;
  const ctx = await buildCtx(userId);
  const comment = await get<any>('comments', commentId);
  if (!comment || comment.is_hidden === 1) return void res.status(404).json({ error: 'التعليق غير موجود.' });
  const post = await loadVisiblePost(ctx, comment.post_id);
  if (!post) return void res.status(404).json({ error: 'التعليق غير موجود.' });
  if (isBlocked(ctx, comment.author_id) || isBlocked(ctx, post.author_id)) return void res.status(403).json({ error: 'غير مصرح بالرد على هذا التعليق.' });
  const clean = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  const safety = checkContentSafety(clean);
  if (!safety.safe) return void res.status(400).json({ error: safety.reason });
  const anon = req.body?.isAnonymous ? 1 : 0;
  const createdAt = nowIso();
  const r = await insert('comment_replies', { comment_id: commentId, author_id: userId, content: clean.slice(0, 1000), is_anonymous: anon, is_hidden: 0, created_at: createdAt });
  await pushNotification({
    userId: comment.author_id, type: 'reply', title: 'رد على تعليقك',
    body: anon ? 'رد شخص مجهول على تعليقك.' : `${req.user!.displayName} رد على تعليقك.`,
    targetType: 'post', targetId: comment.post_id, actorId: userId, isAnonymousActor: Boolean(anon),
  });
  await broadcastPostEvent(comment.post_id, { type: 'post:reply_new', commentId });
  res.status(201).json({
    reply: {
      id: r.id, commentId, content: clean.slice(0, 1000), isAnonymous: Boolean(anon), isOwner: true,
      author: anon ? null : authorView({ id: userId, username: req.user!.username, display_name: req.user!.displayName, avatar: req.user!.avatar }),
      createdAt,
    },
  });
});

// ---------- Profiles ----------
async function usernameToId(username: string): Promise<number | null> {
  const { lookupUnique } = await import('../store.ts');
  const id = await lookupUnique('username', username);
  return id != null && id !== 'pending' ? Number(id) : null;
}

socialRouter.get('/users/:username', rateLimitMemory('read', 120, 60000), async (req, res) => {
  const handle = String(req.params.username).trim().toLowerCase().replace(/^@+/, '');
  const ctx = await buildCtx(req.user?.id ?? null);
  const targetId = await usernameToId(handle);
  const row = targetId ? await get<any>('users', targetId) : null;
  if (!row || row.status === 'banned') return void res.status(404).json({ error: 'المستخدم غير موجود.' });
  if (ctx.uid && isBlocked(ctx, targetId!)) return void res.status(404).json({ error: 'المستخدم غير متاح.' });
  const isSelf = ctx.uid === targetId;
  const isFriend = ctx.friends.has(targetId!);
  let friendStatus: 'none' | 'pending_sent' | 'pending_received' | 'friends' = 'none';
  let isFollowing = false;
  if (ctx.uid && !isSelf) {
    const f = await getKeyed<any>('friendships', pairKey(ctx.uid, targetId!));
    if (f?.status === 'accepted') friendStatus = 'friends';
    else if (f?.status === 'pending') friendStatus = f.requester_id === ctx.uid ? 'pending_sent' : 'pending_received';
    isFollowing = Boolean(await getKeyed('follows', `${ctx.uid}_${targetId}`));
  }
  const [fa, fb, followers, theirPosts, points, ub] = await Promise.all([
    where<any>('friendships', 'requester_id', targetId!), where<any>('friendships', 'addressee_id', targetId!),
    where<any>('follows', 'following_id', targetId!), where<any>('posts', 'author_id', targetId!),
    getUserPointsTotal(targetId!), where<any>('user_badges', 'user_id', targetId!),
  ]);
  const friendsCount = [...fa, ...fb].filter((f) => f.status === 'accepted').length;
  const visibleOwn = theirPosts.filter((p) => p.is_hidden !== 1 && (isSelf || p.is_anonymous !== 1)).sort((a, b) => b.id - a.id);
  const badges = [];
  for (const x of ub) { const b = await get<any>('badges', x.badge_slug); if (b) badges.push({ slug: b.slug, title: b.title, description: b.description, icon_name: b.icon_name }); }
  const privacyLevel = String(row.privacy_level || 'public');
  const canSee = isSelf || privacyLevel === 'public' || (privacyLevel === 'friends' && isFriend);
  const posts: unknown[] = [];
  if (canSee) {
    for (const p of visibleOwn.slice(0, 30)) if (await canViewPost(ctx, p)) posts.push(await serializePost(ctx, p));
  }
  res.json({
    profile: {
      id: targetId, username: row.username, displayName: row.display_name, avatar: row.avatar,
      bio: canSee ? row.bio || '' : '', interests: canSee && Array.isArray(row.interests) ? row.interests : [],
      privacyLevel, canSeeFullProfile: canSee, isSelf, friendStatus, isFollowing,
      allowMessagesFrom: row.allow_messages_from, lastActiveAt: row.show_activity && (isSelf || isFriend) ? row.last_active_at : null,
      createdAt: row.created_at, friendsCount, followersCount: followers.length,
      postsCount: theirPosts.filter((p) => p.is_anonymous !== 1 && p.is_hidden !== 1).length,
      points, level: getLevelInfo(points), badges, posts,
    },
  });
});

// ---------- Friends / follow / blocks ----------
const brief = (u: any) => ({ id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, bio: u.bio || '' });

socialRouter.get('/friends', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const ctx = await buildCtx(userId);
  const [fa, fb, flw] = await Promise.all([where<any>('friendships', 'requester_id', userId), where<any>('friendships', 'addressee_id', userId), where<any>('follows', 'follower_id', userId)]);
  const all = [...fa, ...fb];
  const active = async (id: number) => { const u = await userOf(ctx, id); return u && u.status === 'active' ? u : null; };
  const friends: any[] = [], incoming: any[] = [], outgoing: any[] = [];
  for (const f of all) {
    const otherId = f.requester_id === userId ? f.addressee_id : f.requester_id;
    const u = await active(otherId);
    if (!u) continue;
    if (f.status === 'accepted') friends.push(brief(u));
    else if (f.status === 'pending' && f.addressee_id === userId) incoming.push({ request_id: f.id, id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, created_at: f.created_at });
    else if (f.status === 'pending') outgoing.push({ request_id: f.id, id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, created_at: f.created_at });
  }
  incoming.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const related = new Set<number>(all.filter((f) => f.status === 'accepted' || f.status === 'pending').map((f) => (f.requester_id === userId ? f.addressee_id : f.requester_id)));
  // Suggestions: most recently active real users, excluding self/blocked/related.
  const { lastN: lastUsers } = await import('../store.ts');
  const recentUsers = await lastUsers<any>('users', 150);
  const cand = recentUsers
    .filter((u) => u.id !== userId && u.status === 'active' && u.privacy_level !== 'limited' && !isBlocked(ctx, u.id) && !related.has(u.id))
    .sort((a, b) => String(b.last_active_at).localeCompare(String(a.last_active_at))).slice(0, 12);
  const mine = new Set(friends.map((f) => f.id));
  const suggestions = [];
  for (const s of cand) {
    const [x, y] = await Promise.all([where<any>('friendships', 'requester_id', s.id), where<any>('friendships', 'addressee_id', s.id)]);
    const theirs = [...x, ...y].filter((f) => f.status === 'accepted').map((f) => (f.requester_id === s.id ? f.addressee_id : f.requester_id));
    suggestions.push({ ...brief(s), mutualCount: theirs.filter((id) => mine.has(id)).length });
  }
  const following = [];
  for (const f of flw) { const u = await userOf(ctx, f.following_id); if (u) following.push({ id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar }); }
  res.json({ friends, incomingRequests: incoming, outgoingRequests: outgoing, suggestions, following });
});

socialRouter.post('/friends/request', requireActiveAccount, async (req, res) => {
  const userId = req.user!.id;
  const targetId = Number(req.body?.userId);
  if (!targetId || targetId === userId) return void res.status(400).json({ error: 'طلب غير صالح.' });
  const ctx = await buildCtx(userId);
  const target = await get<any>('users', targetId);
  if (!target || target.status === 'banned') return void res.status(404).json({ error: 'المستخدم غير موجود.' });
  if (isBlocked(ctx, targetId)) return void res.status(403).json({ error: 'لا يمكن إرسال طلب صداقة لهذا المستخدم.' });
  const key = pairKey(userId, targetId);
  const existing = await getKeyed<any>('friendships', key);
  if (existing?.status === 'accepted') return void res.status(400).json({ error: 'أنتما أصدقاء بالفعل.' });
  if (existing?.status === 'pending') return void res.status(400).json({ error: 'يوجد طلب صداقة قيد الانتظار بالفعل.' });
  await putKeyed('friendships', key, { requester_id: userId, addressee_id: targetId, status: 'pending', created_at: existing?.created_at || nowIso(), updated_at: nowIso() });
  await pushNotification({ userId: targetId, type: 'friend_request', title: 'طلب صداقة جديد', body: `أرسل لك ${req.user!.displayName} طلب صداقة.`, targetType: 'friends', targetId: userId, actorId: userId });
  await sendToUser(targetId, { type: 'friend:request', userId });
  await sendToUser(userId, { type: 'friend:updated', userId: targetId });
  res.json({ ok: true, status: 'pending_sent' });
});

socialRouter.post('/friends/respond', requireActiveAccount, async (req, res) => {
  const userId = req.user!.id;
  const requesterId = Number(req.body?.userId);
  const action = req.body?.action === 'accept' ? 'accepted' : 'rejected';
  const key = pairKey(userId, requesterId);
  const row = await getKeyed<any>('friendships', key);
  if (!row || row.status !== 'pending' || row.requester_id !== requesterId || row.addressee_id !== userId) return void res.status(404).json({ error: 'طلب الصداقة غير موجود.' });
  await patch('friendships', key, { status: action, updated_at: nowIso() });
  if (action === 'accepted') {
    await pushNotification({ userId: requesterId, type: 'friend_accept', title: 'تم قبول طلب الصداقة', body: `وافق ${req.user!.displayName} على طلب صداقتك.`, targetType: 'profile', targetId: userId, actorId: userId });
    await sendToUser(requesterId, { type: 'friend:accepted', userId });
    await sendToUser(userId, { type: 'friend:accepted', userId: requesterId });
  } else {
    await sendToUser(requesterId, { type: 'friend:removed', userId });
    await sendToUser(userId, { type: 'friend:removed', userId: requesterId });
  }
  res.json({ ok: true, status: action });
});

socialRouter.delete('/friends/:targetId', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const targetId = num(req.params.targetId);
  await remove('friendships', pairKey(userId, targetId));
  await sendToUser(targetId, { type: 'friend:removed', userId });
  await sendToUser(userId, { type: 'friend:removed', userId: targetId });
  res.json({ ok: true });
});

socialRouter.post('/follow/:targetId', requireActiveAccount, async (req, res) => {
  const userId = req.user!.id;
  const targetId = num(req.params.targetId);
  const ctx = await buildCtx(userId);
  if (targetId === userId || isBlocked(ctx, targetId) || !(await get('users', targetId))) return void res.status(400).json({ error: 'عملية غير متاحة.' });
  const key = `${userId}_${targetId}`;
  const tx = await rtdb.ref(`t/follows/${key}`).transaction((v) => (v ? null : { id: key, follower_id: userId, following_id: targetId, created_at: nowIso() }));
  res.json({ following: Boolean(tx.snapshot.val()) });
});

socialRouter.get('/blocks', requireAuth, async (req, res) => {
  const ctx = await buildCtx(req.user!.id);
  const rows = (await where<any>('blocked_users', 'blocker_id', req.user!.id)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const blocked = [];
  for (const b of rows) { const u = await userOf(ctx, b.blocked_id); if (u) blocked.push({ id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, created_at: b.created_at }); }
  res.json({ blocked });
});

socialRouter.post('/blocks/:targetId', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const targetId = num(req.params.targetId);
  if (targetId === userId) return void res.status(400).json({ error: 'لا يمكنك حظر نفسك.' });
  if (!(await get('users', targetId))) return void res.status(404).json({ error: 'المستخدم غير موجود.' });
  await putKeyed('blocked_users', `${userId}_${targetId}`, { blocker_id: userId, blocked_id: targetId, created_at: nowIso() });
  await remove('friendships', pairKey(userId, targetId));
  await remove('follows', `${userId}_${targetId}`);
  await remove('follows', `${targetId}_${userId}`);
  await sendToUser(userId, { type: 'block:updated', targetId });
  res.json({ ok: true });
});

socialRouter.delete('/blocks/:targetId', requireAuth, async (req, res) => {
  await remove('blocked_users', `${req.user!.id}_${num(req.params.targetId)}`);
  res.json({ ok: true });
});

// ---------- Reports ----------
socialRouter.get('/reports/mine', requireAuth, async (req, res) => {
  const rows = (await where<any>('reports', 'reporter_id', req.user!.id)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 50);
  res.json({ reports: rows.map((r) => ({ id: r.id, target_type: r.target_type, target_id: r.target_id, reason: r.reason, details: r.details, status: r.status, resolution_note: r.resolution_note ?? '', created_at: r.created_at, resolved_at: r.resolved_at ?? null })) });
});

socialRouter.post('/reports', requireAuth, rateLimit('report', 10, 60000), async (req, res) => {
  const { targetType, targetId, reason, details = '' } = req.body ?? {};
  const tables: Record<string, string> = { post: 'posts', comment: 'comments', user: 'users', community: 'communities', message: 'messages' };
  if (!tables[targetType] || !Number(targetId) || !String(reason || '').trim()) return void res.status(400).json({ error: 'يرجى تحديد نوع وسبب البلاغ.' });
  const tid = Number(targetId);
  if (!(await get(tables[targetType], tid))) return void res.status(404).json({ error: 'العنصر المبلغ عنه غير موجود.' });
  const dup = (await where<any>('reports', 'reporter_id', req.user!.id)).find((r) => r.target_type === targetType && r.target_id === tid && r.status === 'open');
  if (dup) return void res.status(409).json({ error: 'لديك بلاغ مفتوح بالفعل على هذا العنصر، وهو قيد المراجعة.' });
  const row = await insert('reports', {
    reporter_id: req.user!.id, target_type: String(targetType), target_id: tid, reason: String(reason).trim().slice(0, 120),
    details: String(details).trim().slice(0, 600), status: 'open', resolution_note: '', created_at: nowIso(),
  });
  if (targetType === 'post') await bump('posts', tid, 'reports_count', 1);
  res.status(201).json({ id: row.id, ok: true });
});

// ---------- Notifications ----------
socialRouter.get('/notifications', requireAuth, async (req, res) => {
  const rows = (await where<any>('notifications', 'user_id', req.user!.id)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 60);
  res.json({ notifications: rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, target_type: n.target_type ?? null, target_id: n.target_id ?? null, is_read: n.is_read ? 1 : 0, created_at: n.created_at })) });
});
socialRouter.post('/notifications/:id/read', requireAuth, async (req, res) => {
  const n = await get<any>('notifications', num(req.params.id));
  if (n && n.user_id === req.user!.id) await patch('notifications', n.id, { is_read: 1 });
  res.json({ ok: true });
});
socialRouter.post('/notifications/read-all', requireAuth, async (req, res) => {
  const rows = await where<any>('notifications', 'user_id', req.user!.id);
  await Promise.all(rows.filter((n) => !n.is_read).map((n) => patch('notifications', n.id, { is_read: 1 })));
  res.json({ ok: true });
});

// ---------- Support ----------
socialRouter.post('/support', requireAuth, rateLimit('support', 6, 60000), async (req, res) => {
  const { category, subject, description, imageUrl } = req.body ?? {};
  const s = String(subject || '').trim();
  const d = String(description || '').trim();
  if (!s || !d) return void res.status(400).json({ error: 'يرجى كتابة عنوان ووصف المشكلة أو الاقتراح.' });
  const safety = checkContentSafety(d, { allowContactInfo: true });
  if (!safety.safe) return void res.status(400).json({ error: safety.reason });
  const row = await insert('support_requests', {
    user_id: req.user!.id, category: String(category || 'أخرى').slice(0, 80), subject: s.slice(0, 150), description: d.slice(0, 2000),
    image_url: sanitizeMediaUrl(imageUrl) ?? null, status: 'open', admin_reply: '', created_at: nowIso(),
  });
  res.status(201).json({ id: row.id, ok: true });
});
socialRouter.get('/support/mine', requireAuth, async (req, res) => {
  const rows = (await where<any>('support_requests', 'user_id', req.user!.id)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 30);
  res.json({ requests: rows });
});

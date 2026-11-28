import { Router } from 'express';
import { rtdb } from '../admin.ts';
import { bump, get, getKeyed, insert, lastN, nowIso, patch, putKeyed, remove, where } from '../store.ts';
import { awardUserPoints, getSetting } from '../core.ts';
import { rateLimit, rateLimitMemory, requireActiveAccount, requireAuth } from '../middleware.ts';
import { broadcastPostEvent, pushNotification } from '../realtime.ts';
import { buildCtx, canViewPost, isBlocked, serializePost, userOf } from '../posts.ts';
import { checkContentSafety, sanitizeMediaUrl } from '../../../src/lib/validation.ts';

export const communityRouter = Router();
const num = (v: unknown) => Number(v);
const byCreated = (a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at));

// Short-lived cache for the two discovery reads. Both scan the recent feed and build
// the same payload for every signed-out visitor, so serving them from memory keeps a
// loop of anonymous requests from turning into a loop of database reads.
const READ_CACHE_TTL_MS = 30_000;
const readCache = new Map<string, { at: number; value: unknown }>();
function cacheGet<T>(key: string): T | null {
  const e = readCache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > READ_CACHE_TTL_MS) {
    readCache.delete(key);
    return null;
  }
  return e.value as T;
}
function cacheSet(key: string, value: unknown): void {
  if (readCache.size > 200) readCache.clear();
  readCache.set(key, { at: Date.now(), value });
}

// ---------- Questions ----------
communityRouter.get('/questions/:postId/answers', rateLimitMemory('read', 180, 60000), async (req, res) => {
  const postId = num(req.params.postId);
  const ctx = await buildCtx(req.user?.id ?? null);
  const post = await get<any>('posts', postId);
  if (!post || post.type !== 'question' || !(await canViewPost(ctx, post))) return void res.status(404).json({ error: 'السؤال غير موجود.' });
  const answers = await where<any>('answers', 'question_post_id', postId);
  const out = [];
  for (const a of answers) {
    const votes = await where<any>('answer_votes', 'answer_id', a.id);
    const score = votes.reduce((s, v) => s + Number(v.value), 0);
    const mine = ctx.uid ? votes.find((v) => v.user_id === ctx.uid) : undefined;
    const u = await userOf(ctx, a.author_id);
    const anon = a.is_anonymous === 1;
    out.push({
      id: a.id, questionPostId: a.question_post_id, content: a.content, isAnonymous: anon,
      isOwner: ctx.uid === a.author_id, isBest: a.is_best === 1, score, userVote: mine?.value ?? 0,
      author: anon || !u ? null : { id: u.id, username: u.username, displayName: u.display_name, avatar: u.avatar },
      createdAt: a.created_at,
    });
  }
  out.sort((a, b) => Number(b.isBest) - Number(a.isBest) || b.score - a.score || String(a.createdAt).localeCompare(String(b.createdAt)));
  res.json({ answers: out });
});

communityRouter.post('/questions/:postId/answers', requireActiveAccount, rateLimit('answer', 20, 60000), async (req, res) => {
  const postId = num(req.params.postId);
  const userId = req.user!.id;
  const ctx = await buildCtx(userId);
  const post = await get<any>('posts', postId);
  if (!post || post.type !== 'question' || !(await canViewPost(ctx, post)) || isBlocked(ctx, post.author_id)) return void res.status(404).json({ error: 'السؤال غير موجود.' });
  const clean = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  const safety = checkContentSafety(clean);
  if (!safety.safe) return void res.status(400).json({ error: safety.reason });
  const anon = req.body?.isAnonymous ? 1 : 0;
  const a = await insert('answers', { question_post_id: postId, author_id: userId, content: clean.slice(0, 1500), is_anonymous: anon, is_best: 0, created_at: nowIso() });
  await bump('posts', postId, 'answers_count', 1);
  await awardUserPoints(userId, 'answer_question', a.id, clean);
  await pushNotification({
    userId: post.author_id, type: 'comment', title: 'إجابة جديدة على سؤالك',
    body: anon ? 'أجاب شخص مجهول على سؤالك.' : `${req.user!.displayName} أجاب على سؤالك.`,
    targetType: 'post', targetId: postId, actorId: userId, isAnonymousActor: Boolean(anon),
  });
  res.status(201).json({ id: a.id, ok: true });
});

communityRouter.post('/answers/:answerId/vote', requireActiveAccount, async (req, res) => {
  const answerId = num(req.params.answerId);
  const userId = req.user!.id;
  const value = req.body?.value === -1 ? -1 : 1;
  const ans = await get<any>('answers', answerId);
  const post = ans ? await get<any>('posts', ans.question_post_id) : null;
  const ctx = await buildCtx(userId);
  if (!ans || !post || !(await canViewPost(ctx, post))) return void res.status(404).json({ error: 'الإجابة غير موجودة.' });
  if (post.allow_voting === 0) return void res.status(403).json({ error: 'التصويت غير مفعل على هذا السؤال.' });
  const key = `${answerId}_${userId}`;
  await rtdb.ref(`t/answer_votes/${key}`).transaction((v) =>
    v && v.value === value ? null : { id: key, answer_id: answerId, user_id: userId, value, created_at: nowIso() }
  );
  const votes = await where<any>('answer_votes', 'answer_id', answerId);
  res.json({ score: votes.reduce((s, v) => s + Number(v.value), 0) });
});

communityRouter.post('/questions/:postId/best-answer', requireAuth, async (req, res) => {
  const postId = num(req.params.postId);
  const answerId = num(req.body?.answerId);
  const post = await get<any>('posts', postId);
  if (!post || post.author_id !== req.user!.id) return void res.status(403).json({ error: 'صاحب السؤال فقط يمكنه اختيار أفضل إجابة.' });
  const ans = await get<any>('answers', answerId);
  if (!ans || ans.question_post_id !== postId) return void res.status(404).json({ error: 'الإجابة غير موجودة.' });
  for (const a of await where<any>('answers', 'question_post_id', postId)) if (a.is_best === 1) await patch('answers', a.id, { is_best: 0 });
  await patch('answers', answerId, { is_best: 1 });
  await patch('posts', postId, { best_answer_id: answerId });
  if (ans.author_id !== req.user!.id) {
    await awardUserPoints(ans.author_id, 'best_answer', answerId);
    await pushNotification({ userId: ans.author_id, type: 'reaction', title: 'أفضل إجابة!', body: 'تم اختيار إجابتك كأفضل إجابة وحصلت على 25 نقطة.', targetType: 'post', targetId: postId, actorId: req.user!.id });
  }
  res.json({ ok: true, bestAnswerId: answerId });
});

// ---------- Polls ----------
communityRouter.post('/polls/:postId/vote', requireActiveAccount, async (req, res) => {
  const postId = num(req.params.postId);
  const optionId = num(req.body?.optionId);
  const userId = req.user!.id;
  const ctx = await buildCtx(userId);
  const post = await get<any>('posts', postId);
  if (!post || post.type !== 'poll' || !post.poll || !(await canViewPost(ctx, post)) || isBlocked(ctx, post.author_id)) return void res.status(404).json({ error: 'التصويت غير موجود.' });
  if (post.poll.ends_at && new Date(post.poll.ends_at).getTime() < Date.now()) return void res.status(400).json({ error: 'انتهت مدة هذا التصويت.' });
  const options: any[] = Object.values(post.poll.options || {});
  const idx = options.findIndex((o) => o.id === optionId);
  if (idx < 0) return void res.status(400).json({ error: 'خيار التصويت غير صالح.' });
  const key = `${postId}_${userId}`;
  const claim = await rtdb.ref(`t/poll_votes/${key}`).transaction((v) => (v == null ? { id: key, poll_post_id: postId, option_id: optionId, user_id: userId, created_at: nowIso() } : undefined));
  if (!claim.committed) return void res.status(409).json({ error: 'يمكن التصويت مرة واحدة فقط لكل حساب.' });
  await rtdb.ref(`t/posts/${postId}/poll/options/${idx}/votes`).transaction((v) => (Number(v) || 0) + 1);
  const fresh = await get<any>('posts', postId);
  const serialized = await serializePost(ctx, fresh);
  if (serialized.poll) await broadcastPostEvent(postId, { type: 'poll:voted' });
  res.json({ post: serialized });
});

// ---------- Communities ----------
const commView = (c: any) => ({
  id: c.id, name: c.name, slug: c.slug, description: c.description, category: c.category,
  avatarUrl: c.avatar_url, coverUrl: c.cover_url, rules: c.rules, privacy: c.privacy, whoCanPost: c.who_can_post,
  membersCount: Number(c.members_count || 0), postsCount: Number(c.posts_count || 0), createdAt: c.created_at,
});
async function allCommunities() {
  const { all } = await import('../store.ts');
  return (await all<any>('communities')).filter((c) => c.is_hidden !== 1);
}

communityRouter.get('/communities', rateLimitMemory('read', 180, 60000), async (req, res) => {
  const ctx = await buildCtx(req.user?.id ?? null);
  const q = String(req.query.q || '').trim().toLowerCase();
  const category = String(req.query.category || '');
  let items = (await allCommunities())
    .sort((a, b) => Number(b.members_count || 0) - Number(a.members_count || 0) || String(b.created_at).localeCompare(String(a.created_at)))
    .map((c) => { const myRole = ctx.members.get(c.id) ?? null; return { ...commView(c), isMember: myRole !== null, myRole }; });
  if (category && category !== 'الكل') items = items.filter((c) => c.category === category);
  if (q) items = items.filter((c) => [c.name, c.description, c.category].some((s) => String(s).toLowerCase().includes(q)));
  res.json({ communities: items });
});

communityRouter.post('/communities', requireActiveAccount, rateLimit('community', 5, 60000), async (req, res) => {
  const userId = req.user!.id;
  const { name, description, category = 'عام', rules = '', privacy = 'public', whoCanPost = 'members', avatarUrl, coverUrl } = req.body ?? {};
  const cleanName = String(name || '').trim();
  const cleanDesc = String(description || '').trim();
  if (cleanName.length < 3 || cleanName.length > 60) return void res.status(400).json({ error: 'اسم المجتمع يجب أن يكون بين 3 و60 حرفًا.' });
  if (cleanDesc.length < 8) return void res.status(400).json({ error: 'يرجى كتابة وصف واضح للمجتمع.' });
  const safety = checkContentSafety(`${cleanName} ${cleanDesc}`);
  if (!safety.safe) return void res.status(400).json({ error: safety.reason });
  const { claimUnique, setUnique, releaseUnique } = await import('../store.ts');
  if (!(await claimUnique('community', cleanName, 'pending'))) return void res.status(409).json({ error: 'يوجد مجتمع بهذا الاسم بالفعل.' });
  const slug = `comm-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  try {
    const c = await insert('communities', {
      name: cleanName, slug, description: cleanDesc.slice(0, 400), category: String(category),
      avatar_url: sanitizeMediaUrl(avatarUrl) || '/src/assets/images/meen_brand_emblem_1795731517188.jpg',
      cover_url: sanitizeMediaUrl(coverUrl) || '/src/assets/images/meen_community_cover_1795731518126.jpg',
      rules: String(rules || 'احترم الجميع والتزم بقواعد مين؟ الآمنة.').slice(0, 800),
      privacy: privacy === 'private' ? 'private' : 'public', who_can_post: whoCanPost === 'moderators' ? 'moderators' : 'members',
      creator_id: userId, is_hidden: 0, created_at: nowIso(), members_count: 1, posts_count: 0,
    });
    await setUnique('community', cleanName, c.id);
    await putKeyed('community_members', `${c.id}_${userId}`, { community_id: c.id, user_id: userId, role: 'owner', joined_at: nowIso() });
    await awardUserPoints(userId, 'community_join', c.id);
    res.status(201).json({ id: c.id, slug, ok: true });
  } catch (e) {
    await releaseUnique('community', cleanName);
    throw e;
  }
});

communityRouter.get('/communities/:id', rateLimitMemory('read', 180, 60000), async (req, res) => {
  const communityId = num(req.params.id);
  const ctx = await buildCtx(req.user?.id ?? null);
  const comm = await get<any>('communities', communityId);
  if (!comm || comm.is_hidden === 1) return void res.status(404).json({ error: 'المجتمع غير موجود.' });
  const rows = await where<any>('community_members', 'community_id', communityId);
  const members: any[] = [];
  for (const m of rows) {
    const u = await userOf(ctx, m.user_id);
    if (u && u.status === 'active') members.push({ id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, role: m.role, joined_at: m.joined_at });
  }
  const order: Record<string, number> = { owner: 0, moderator: 1, member: 2 };
  members.sort((a, b) => order[a.role] - order[b.role] || String(a.joined_at).localeCompare(String(b.joined_at)));
  const mine = ctx.uid ? members.find((m) => m.id === ctx.uid) : undefined;
  const canSee = comm.privacy === 'public' || Boolean(mine);
  const posts: unknown[] = [];
  if (canSee) {
    const mineP = (await where<any>('posts', 'community_id', communityId)).filter((p) => p.is_hidden !== 1).sort((a, b) => b.id - a.id).slice(0, 60);
    for (const p of mineP) if (await canViewPost(ctx, p)) posts.push(await serializePost(ctx, p));
  }
  // Who is inside a private community is itself private: show the roster only to
  // members, and to everyone for public communities.
  const visibleMembers = canSee ? members : [];
  res.json({
    community: {
      ...commView({ ...comm, members_count: members.length }), isMember: Boolean(mine), myRole: mine?.role ?? null,
      moderators: visibleMembers.filter((m) => m.role === 'owner' || m.role === 'moderator'), members: visibleMembers, posts,
    },
  });
});

communityRouter.post('/communities/:id/join', requireActiveAccount, async (req, res) => {
  const communityId = num(req.params.id);
  const userId = req.user!.id;
  const comm = await get<any>('communities', communityId);
  if (!comm || comm.is_hidden === 1) return void res.status(404).json({ error: 'المجتمع غير موجود.' });
  const key = `${communityId}_${userId}`;
  const existing = await getKeyed<any>('community_members', key);
  if (existing) {
    if (existing.role === 'owner') return void res.status(400).json({ error: 'منشئ المجتمع لا يمكنه المغادرة مباشرة.' });
    await remove('community_members', key);
    await bump('communities', communityId, 'members_count', -1);
    return void res.json({ joined: false });
  }
  if (comm.privacy === 'private') return void res.status(403).json({ error: 'هذا المجتمع خاص، والانضمام إليه بدعوة من مالك المجتمع أو أحد مشرفيه.' });
  await putKeyed('community_members', key, { community_id: communityId, user_id: userId, role: 'member', joined_at: nowIso() });
  await bump('communities', communityId, 'members_count', 1);
  await awardUserPoints(userId, 'community_join', communityId);
  await pushNotification({ userId, type: 'community_invite', title: 'انضممت إلى مجتمع', body: 'أصبحت عضوًا في المجتمع. شارك باحترام والتزم بالقواعد.', targetType: 'community', targetId: communityId, actorId: null });
  res.json({ joined: true });
});

communityRouter.post('/communities/:id/members', requireActiveAccount, async (req, res) => {
  const communityId = num(req.params.id);
  const actorId = req.user!.id;
  const targetUserId = num(req.body?.userId);
  if (!targetUserId) return void res.status(400).json({ error: 'مستخدم غير صالح.' });
  const comm = await get<any>('communities', communityId);
  if (!comm || comm.is_hidden === 1) return void res.status(404).json({ error: 'المجتمع غير موجود.' });
  const actor = await getKeyed<any>('community_members', `${communityId}_${actorId}`);
  if (!actor || (actor.role !== 'owner' && actor.role !== 'moderator')) return void res.status(403).json({ error: 'إضافة الأعضاء متاحة لمالك المجتمع ومشرفيه فقط.' });
  const target = await get<any>('users', targetUserId);
  if (!target || target.status !== 'active') return void res.status(404).json({ error: 'المستخدم غير موجود أو غير نشط.' });
  const key = `${communityId}_${targetUserId}`;
  const tx = await rtdb.ref(`t/community_members/${key}`).transaction((v) => (v == null ? { id: key, community_id: communityId, user_id: targetUserId, role: 'member', joined_at: nowIso() } : undefined));
  if (!tx.committed) return void res.status(409).json({ error: 'هذا المستخدم عضو بالفعل في المجتمع.' });
  await bump('communities', communityId, 'members_count', 1);
  await pushNotification({ userId: targetUserId, type: 'community_invite', title: 'دعوة إلى مجتمع', body: `أضافك ${req.user!.displayName} إلى مجتمع «${comm.name}».`, targetType: 'community', targetId: communityId, actorId });
  res.status(201).json({ ok: true });
});

communityRouter.delete('/communities/:id/members/:userId', requireAuth, async (req, res) => {
  const communityId = num(req.params.id);
  const actorId = req.user!.id;
  const targetUserId = num(req.params.userId);
  const actor = await getKeyed<any>('community_members', `${communityId}_${actorId}`);
  if (!actor) return void res.status(403).json({ error: 'أنت لست عضوًا في هذا المجتمع.' });
  const isSelf = targetUserId === actorId;
  const canManage = actor.role === 'owner' || actor.role === 'moderator';
  if (!isSelf && !canManage) return void res.status(403).json({ error: 'إزالة الأعضاء متاحة لمالك المجتمع ومشرفيه فقط.' });
  const target = await getKeyed<any>('community_members', `${communityId}_${targetUserId}`);
  if (!target) return void res.status(404).json({ error: 'هذا المستخدم ليس عضوًا.' });
  if (target.role === 'owner') return void res.status(400).json({ error: 'لا يمكن إزالة مالك المجتمع.' });
  if (!isSelf && target.role === 'moderator' && actor.role !== 'owner') return void res.status(403).json({ error: 'إزالة المشرفين متاحة لمالك المجتمع فقط.' });
  await remove('community_members', `${communityId}_${targetUserId}`);
  await bump('communities', communityId, 'members_count', -1);
  res.json({ ok: true });
});

// ---------- Daily question ----------
communityRouter.get('/daily-question', rateLimitMemory('read', 180, 60000), async (req, res) => {
  const ctx = await buildCtx(req.user?.id ?? null);
  const { all } = await import('../store.ts');
  const qs = (await all<any>('daily_questions')).sort((a, b) => b.id - a.id);
  const active = qs.find((q) => q.is_active === 1) ?? null;
  const targetId = req.query.id ? num(req.query.id) : active?.id ?? 0;
  const answers: unknown[] = [];
  if (targetId) {
    const rows = (await where<any>('posts', 'daily_question_id', targetId)).filter((p) => p.is_hidden !== 1).sort((a, b) => b.id - a.id).slice(0, 60);
    for (const p of rows) if (await canViewPost(ctx, p)) answers.push(await serializePost(ctx, p));
  }
  res.json({
    activeQuestion: active ? { id: active.id, questionText: active.question_text, dateKey: active.date_key, createdAt: active.created_at } : null,
    archive: qs.slice(0, 20).map((q) => ({ id: q.id, questionText: q.question_text, dateKey: q.date_key, isActive: q.is_active === 1 })),
    answers,
  });
});

communityRouter.post('/daily-question/:id/answer', requireActiveAccount, rateLimit('daily_ans', 10, 60000), async (req, res) => {
  const dailyId = num(req.params.id);
  const userId = req.user!.id;
  if (!(await get('daily_questions', dailyId))) return void res.status(404).json({ error: 'السؤال اليومي غير موجود.' });
  const clean = String(req.body?.content || '').trim();
  const safety = checkContentSafety(clean);
  if (!safety.safe) return void res.status(400).json({ error: safety.reason });
  const now = nowIso();
  const post = await insert('posts', {
    author_id: userId, type: 'post', category: 'سؤال اليوم', content: clean.slice(0, 1500), media_url: null,
    is_anonymous: req.body?.isAnonymous ? 1 : 0, allow_comments: 1, audience: 'public', community_id: null,
    daily_question_id: dailyId, challenge_id: null, shares_count: 0, is_hidden: 0, created_at: now, updated_at: now,
    likes_count: 0, supports_count: 0, comments_count: 0, saves_count: 0, reports_count: 0,
  });
  await awardUserPoints(userId, 'daily_question', post.id, clean);
  res.status(201).json({ post: await serializePost(await buildCtx(userId), post) });
});

// ---------- Challenges ----------
communityRouter.get('/challenges', rateLimitMemory('read', 180, 60000), async (req, res) => {
  const ctx = await buildCtx(req.user?.id ?? null);
  const { all } = await import('../store.ts');
  const chs = (await all<any>('challenges')).sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || String(b.created_at).localeCompare(String(a.created_at)));
  const items = [];
  for (const ch of chs) {
    const entries = await where<any>('challenge_entries', 'challenge_id', ch.id);
    const posts: any[] = [];
    for (const e of entries.sort((a, b) => b.post_id - a.post_id).slice(0, 20)) {
      const p = await get<any>('posts', e.post_id);
      if (p && p.is_hidden !== 1 && (await canViewPost(ctx, p))) posts.push(await serializePost(ctx, p));
    }
    items.push({
      id: ch.id, title: ch.title, description: ch.description, category: ch.category, pointsReward: Number(ch.points_reward),
      badgeSlug: ch.badge_slug, startsAt: ch.starts_at, endsAt: ch.ends_at, status: ch.status, entriesCount: entries.length,
      userParticipated: ctx.uid ? entries.some((e) => e.user_id === ctx.uid) : false, entries: posts,
    });
  }
  res.json({ challenges: items });
});

communityRouter.post('/challenges/:id/enter', requireActiveAccount, rateLimit('challenge_enter', 8, 60000), async (req, res) => {
  const challengeId = num(req.params.id);
  const userId = req.user!.id;
  const ch = await get<any>('challenges', challengeId);
  if (!ch || ch.status !== 'active') return void res.status(400).json({ error: 'التحدي غير متاح حاليًا.' });
  const clean = String(req.body?.content || '').trim();
  const safety = checkContentSafety(clean);
  if (!safety.safe) return void res.status(400).json({ error: safety.reason });
  const now = nowIso();
  const post = await insert('posts', {
    author_id: userId, type: 'challenge_entry', category: 'التحديات', content: clean.slice(0, 1500),
    media_url: sanitizeMediaUrl(req.body?.mediaUrl) ?? null, is_anonymous: req.body?.isAnonymous ? 1 : 0, allow_comments: 1,
    audience: 'public', community_id: null, daily_question_id: null, challenge_id: challengeId, shares_count: 0, is_hidden: 0,
    created_at: now, updated_at: now, likes_count: 0, supports_count: 0, comments_count: 0, saves_count: 0, reports_count: 0,
  });
  await putKeyed('challenge_entries', `${challengeId}_${post.id}`, { challenge_id: challengeId, post_id: post.id, user_id: userId, created_at: now });
  await awardUserPoints(userId, 'challenge_entry', post.id, clean);
  res.status(201).json({ ok: true, postId: post.id });
});

// ---------- Explore / trending ----------
async function visibleRecent(ctx: Awaited<ReturnType<typeof buildCtx>>, n: number) {
  const rows = (await lastN<any>('posts', n)).filter((p) => p.is_hidden !== 1 && (!ctx.uid || !isBlocked(ctx, p.author_id)));
  const out = [];
  for (const p of rows) if (await canViewPost(ctx, p)) out.push(await serializePost(ctx, p));
  return out;
}
const topicsOf = (posts: Array<{ category: string }>) => {
  const m = new Map<string, number>();
  for (const p of posts) m.set(p.category, (m.get(p.category) || 0) + 1);
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
};
const userBrief = (u: any) => ({ id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, bio: u.bio || '' });

communityRouter.get('/explore', rateLimitMemory('read', 120, 60000), async (req, res) => {
  const ctx = await buildCtx(req.user?.id ?? null);
  const q = String(req.query.q || '').trim();
  const filter = String(req.query.filter || 'all');
  // Signed-out visitors get posts, communities and categories only. The member
  // directory needs an account, so it cannot be scraped anonymously.
  const cacheKey = ctx.uid ? null : `explore:${q}:${filter}`;
  if (cacheKey) {
    const hit = cacheGet<Record<string, unknown>>(cacheKey);
    if (hit) return void res.json(hit);
  }
  const categories = await getSetting<string[]>('categories', []);
  const visiblePosts = await visibleRecent(ctx, 120);
  const trendingPosts = [...visiblePosts].sort((a, b) => b.trendingScore - a.trendingScore);
  const comms = (await allCommunities()).sort((a, b) => Number(b.members_count || 0) - Number(a.members_count || 0)).slice(0, 12).map(commView);
  let users: any[] = [];
  if (ctx.uid) {
    const { lastN: lastUsers } = await import('../store.ts');
    users = (await lastUsers<any>('users', 200)).filter((u) => u.status === 'active');
  }
  const suggestedUsers = users.filter((u) => u.privacy_level === 'public' && u.id !== ctx.uid).sort((a, b) => String(b.last_active_at).localeCompare(String(a.last_active_at))).slice(0, 12).map(userBrief);
  if (!q) {
    const payload = {
      categories, trendingTopics: topicsOf(visiblePosts), trendingPosts: trendingPosts.slice(0, 10),
      worthyConfessions: trendingPosts.filter((p) => p.type === 'confession').slice(0, 6),
      popularQuestions: trendingPosts.filter((p) => p.type === 'question').slice(0, 6),
      activeCommunities: comms, suggestedUsers,
    };
    if (cacheKey) cacheSet(cacheKey, payload);
    return void res.json(payload);
  }
  const lq = q.toLowerCase();
  const matchedUsers = ctx.uid && (filter === 'all' || filter === 'users')
    ? users.filter((u) => u.privacy_level !== 'limited' && (String(u.username).toLowerCase().includes(lq) || String(u.display_name).toLowerCase().includes(lq))).slice(0, 25).map(userBrief) : [];
  const matchedPosts = filter === 'all' || filter === 'posts' || filter === 'categories'
    ? visiblePosts.filter((p) => p.content.toLowerCase().includes(lq) || p.category.toLowerCase().includes(lq) || (p.moodType && p.moodType.toLowerCase().includes(lq))) : [];
  const matchedComms = filter === 'all' || filter === 'communities'
    ? comms.filter((c) => [c.name, c.description, c.category].some((s) => String(s).toLowerCase().includes(lq))) : [];
  const payload = { query: q, users: matchedUsers, posts: matchedPosts, communities: matchedComms, categories: categories.filter((c) => c.toLowerCase().includes(lq)) };
  if (cacheKey) cacheSet(cacheKey, payload);
  res.json(payload);
});

communityRouter.get('/trending', rateLimitMemory('read', 180, 60000), async (req, res) => {
  const ctx = await buildCtx(req.user?.id ?? null);
  const cacheKey = ctx.uid ? null : 'trending:anon';
  if (cacheKey) {
    const hit = cacheGet<Record<string, unknown>>(cacheKey);
    if (hit) return void res.json(hit);
  }
  const ranked = (await visibleRecent(ctx, 150)).sort((a, b) => b.trendingScore - a.trendingScore);
  const communities = (await allCommunities()).sort((a, b) => Number(b.posts_count || 0) * 2 + Number(b.members_count || 0) - (Number(a.posts_count || 0) * 2 + Number(a.members_count || 0))).slice(0, 10).map(commView);
  const payload = {
    posts: ranked.filter((p) => p.type === 'post' || p.type === 'confession').slice(0, 20),
    questions: ranked.filter((p) => p.type === 'question').slice(0, 15),
    polls: ranked.filter((p) => p.type === 'poll').slice(0, 15),
    communities, topics: topicsOf(ranked),
  };
  if (cacheKey) cacheSet(cacheKey, payload);
  res.json(payload);
});

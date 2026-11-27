import { computeTrendingScore } from '../../src/lib/trending.ts';
import type { PollData } from '../../src/types.ts';
import { get, getKeyed, where } from './store.ts';

// Per-request lookup context: loads the viewer's relationships once so feeds do not
// need a query per post.
export interface Ctx {
  uid: number | null;
  blocked: Set<number>;      // users I blocked
  blockedBy: Set<number>;    // users who blocked me
  friends: Set<number>;
  liked: Set<number>;
  supported: Set<number>;
  saved: Set<number>;
  following: Set<number>;    // posts I follow
  members: Map<number, string>; // community id -> role
  users: Map<number, any>;
  comms: Map<number, any>;
}

export async function buildCtx(uid: number | null): Promise<Ctx> {
  const ctx: Ctx = {
    uid, blocked: new Set(), blockedBy: new Set(), friends: new Set(), liked: new Set(), supported: new Set(),
    saved: new Set(), following: new Set(), members: new Map(), users: new Map(), comms: new Map(),
  };
  if (!uid) return ctx;
  const [b1, b2, f1, f2, rx, sv, pf, mem] = await Promise.all([
    where<any>('blocked_users', 'blocker_id', uid),
    where<any>('blocked_users', 'blocked_id', uid),
    where<any>('friendships', 'requester_id', uid),
    where<any>('friendships', 'addressee_id', uid),
    where<any>('reactions', 'user_id', uid),
    where<any>('saved_posts', 'user_id', uid),
    where<any>('post_follows', 'user_id', uid),
    where<any>('community_members', 'user_id', uid),
  ]);
  b1.forEach((r) => ctx.blocked.add(r.blocked_id));
  b2.forEach((r) => ctx.blockedBy.add(r.blocker_id));
  f1.filter((r) => r.status === 'accepted').forEach((r) => ctx.friends.add(r.addressee_id));
  f2.filter((r) => r.status === 'accepted').forEach((r) => ctx.friends.add(r.requester_id));
  rx.filter((r) => r.target_type === 'post').forEach((r) => (r.reaction_type === 'like' ? ctx.liked : ctx.supported).add(r.target_id));
  sv.forEach((r) => ctx.saved.add(r.post_id));
  pf.forEach((r) => ctx.following.add(r.post_id));
  mem.forEach((r) => ctx.members.set(r.community_id, r.role));
  return ctx;
}

export const isBlocked = (ctx: Ctx, other: number) => ctx.blocked.has(other) || ctx.blockedBy.has(other);

export async function userOf(ctx: Ctx, id: number) {
  if (!ctx.users.has(id)) ctx.users.set(id, await get<any>('users', id));
  return ctx.users.get(id);
}
export async function commOf(ctx: Ctx, id: number) {
  if (!ctx.comms.has(id)) ctx.comms.set(id, await get<any>('communities', id));
  return ctx.comms.get(id);
}

// Mirrors the old visibility rules exactly.
export async function canViewPost(ctx: Ctx, post: any): Promise<boolean> {
  if (!post || post.is_hidden === 1) return false;
  if (ctx.uid && post.author_id === ctx.uid) return true;
  const author = await userOf(ctx, post.author_id);
  if (!author || author.status === 'banned') return false;
  if (post.audience === 'friends') {
    if (!ctx.uid || !ctx.friends.has(post.author_id)) return false;
  }
  if (post.is_anonymous === 0 && !post.community_id) {
    if (author.show_posts_to === 'only_me') return false;
    if (author.show_posts_to === 'friends' && (!ctx.uid || !ctx.friends.has(post.author_id))) return false;
  }
  if (post.community_id) {
    const comm = await commOf(ctx, post.community_id);
    if (!comm || comm.is_hidden === 1) return false;
    if (comm.privacy === 'private' && (!ctx.uid || !ctx.members.has(post.community_id))) return false;
  }
  return true;
}

export async function serializePost(ctx: Ctx, post: any) {
  const currentUserId = ctx.uid;
  const isOwner = currentUserId !== null && post.author_id === currentUserId;
  const isAnonymous = post.is_anonymous === 1;
  const author = isAnonymous ? null : await userOf(ctx, post.author_id);
  const comm = post.community_id ? await commOf(ctx, post.community_id) : null;

  let poll: PollData | null = null;
  if (post.type === 'poll' && post.poll) {
    const options: Array<{ id: number; label: string; votes: number }> = Object.values(post.poll.options || {}) as any;
    const userVote = currentUserId ? await getKeyed<any>('poll_votes', `${post.id}_${currentUserId}`) : null;
    const total = options.reduce((s, o) => s + Number(o.votes || 0), 0);
    const showResults = post.poll.show_results_mode === 'always' || Boolean(userVote) || isOwner;
    poll = {
      endsAt: post.poll.ends_at ?? null,
      showResultsMode: post.poll.show_results_mode ?? 'always',
      userVotedOptionId: userVote?.option_id ?? null,
      totalVotes: total,
      showResults,
      options: options.map((o) => ({
        id: o.id, label: o.label,
        votesCount: showResults ? Number(o.votes || 0) : null,
        percent: showResults && total > 0 ? Math.round((Number(o.votes || 0) / total) * 100) : null,
      })),
    };
  }
  const question = post.type === 'question'
    ? {
        questionType: post.question_type ?? 'عام',
        allowVoting: post.allow_voting !== 0,
        bestAnswerId: post.best_answer_id ?? null,
        answersCount: Number(post.answers_count || 0),
      }
    : null;

  const createdMs = new Date(post.created_at).getTime();
  const ageHours = Number.isNaN(createdMs) ? 0 : Math.max(0, (Date.now() - createdMs) / 3600000);
  const likesCount = Number(post.likes_count || 0);
  const supportsCount = Number(post.supports_count || 0);
  const commentsCount = Number(post.comments_count || 0);
  const savesCount = Number(post.saves_count || 0);
  const trendingScore = computeTrendingScore({
    likesCount, supportsCount, commentsCount,
    sharesOrSavesCount: Number(post.shares_count || 0) + savesCount,
    contentLength: String(post.content).length,
    reportsCount: Number(post.reports_count || 0),
    ageHours,
  });
  return {
    id: post.id, type: post.type, category: post.category, moodType: post.mood_type ?? null,
    content: post.content, mediaUrl: post.media_url ?? null, isAnonymous, isOwner,
    allowComments: post.allow_comments === 1, audience: post.audience,
    communityId: post.community_id ?? null, communityName: comm?.name ?? null, communitySlug: comm?.slug ?? null,
    dailyQuestionId: post.daily_question_id ?? null, challengeId: post.challenge_id ?? null,
    author: author ? { id: author.id, username: author.username, displayName: author.display_name, avatar: author.avatar } : null,
    likesCount, supportsCount, commentsCount, savesCount, sharesCount: Number(post.shares_count || 0),
    trendingScore,
    userLiked: ctx.liked.has(post.id), userSupported: ctx.supported.has(post.id),
    userSaved: ctx.saved.has(post.id), userFollowingPost: ctx.following.has(post.id),
    poll, question, createdAt: post.created_at,
  };
}

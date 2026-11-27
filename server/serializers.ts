import { db, areFriends } from './db.ts';
import { computeTrendingScore } from '../src/lib/trending.ts';
import type { PollData } from '../src/types.ts';

export interface PostRow {
  id: number;
  author_id: number;
  type: 'post' | 'confession' | 'question' | 'poll' | 'challenge_entry';
  category: string;
  content: string;
  media_url: string | null;
  is_anonymous: number;
  allow_comments: number;
  audience: string;
  community_id: number | null;
  daily_question_id: number | null;
  challenge_id: number | null;
  shares_count: number;
  is_hidden: number;
  created_at: string;
  username: string;
  display_name: string;
  avatar: string;
  show_posts_to: string;
  mood_type?: string | null;
  community_name?: string | null;
  community_slug?: string | null;
}

export function serializePost(row: PostRow, currentUserId: number | null) {
  const isOwner = currentUserId !== null && row.author_id === currentUserId;
  const isAnonymous = row.is_anonymous === 1;

  // Strict Anonymous Shield: NEVER leak author_id, username, displayName, or real avatar on anonymous content
  const author = isAnonymous
    ? null
    : {
        id: row.author_id,
        username: row.username,
        displayName: row.display_name,
        avatar: row.avatar,
      };

  const likesRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM reactions WHERE target_type = 'post' AND target_id = ? AND reaction_type = 'like'`
    )
    .get(row.id) as { cnt: number };
  const supportsRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM reactions WHERE target_type = 'post' AND target_id = ? AND reaction_type = 'support'`
    )
    .get(row.id) as { cnt: number };
  const commentsRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM comments WHERE post_id = ? AND is_hidden = 0`
    )
    .get(row.id) as { cnt: number };
  const savesRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM saved_posts WHERE post_id = ?`)
    .get(row.id) as { cnt: number };
  const reportsRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM reports WHERE target_type = 'post' AND target_id = ?`)
    .get(row.id) as { cnt: number };

  let userLiked = false;
  let userSupported = false;
  let userSaved = false;
  let userFollowingPost = false;

  if (currentUserId) {
    const rRows = db
      .prepare(
        `SELECT reaction_type FROM reactions WHERE target_type = 'post' AND target_id = ? AND user_id = ?`
      )
      .all(row.id, currentUserId) as Array<{ reaction_type: string }>;
    userLiked = rRows.some((r) => r.reaction_type === 'like');
    userSupported = rRows.some((r) => r.reaction_type === 'support');

    userSaved = Boolean(
      db
        .prepare('SELECT 1 FROM saved_posts WHERE user_id = ? AND post_id = ? LIMIT 1')
        .get(currentUserId, row.id)
    );
    userFollowingPost = Boolean(
      db
        .prepare('SELECT 1 FROM post_follows WHERE user_id = ? AND post_id = ? LIMIT 1')
        .get(currentUserId, row.id)
    );
  }

  let poll: PollData | null = null;
  if (row.type === 'poll') {
    const pollMeta = db
      .prepare('SELECT ends_at, show_results_mode FROM polls WHERE post_id = ?')
      .get(row.id) as { ends_at: string | null; show_results_mode: 'always' | 'after_vote' } | undefined;
    const options = db
      .prepare(
        `SELECT po.id, po.label, COUNT(pv.id) AS votes_count
         FROM poll_options po
         LEFT JOIN poll_votes pv ON pv.option_id = po.id
         WHERE po.poll_post_id = ?
         GROUP BY po.id
         ORDER BY po.sort_order ASC`
      )
      .all(row.id) as Array<{ id: number; label: string; votes_count: number }>;

    const userVote = currentUserId
      ? (db
          .prepare('SELECT option_id FROM poll_votes WHERE poll_post_id = ? AND user_id = ?')
          .get(row.id, currentUserId) as { option_id: number } | undefined)
      : undefined;

    const totalVotes = options.reduce((sum, o) => sum + Number(o.votes_count), 0);
    const showResults =
      pollMeta?.show_results_mode === 'always' || Boolean(userVote) || isOwner;

    poll = {
      endsAt: pollMeta?.ends_at ?? null,
      showResultsMode: pollMeta?.show_results_mode ?? 'always',
      userVotedOptionId: userVote?.option_id ?? null,
      totalVotes,
      showResults,
      options: options.map((o) => ({
        id: o.id,
        label: o.label,
        votesCount: showResults ? Number(o.votes_count) : null,
        percent:
          showResults && totalVotes > 0
            ? Math.round((Number(o.votes_count) / totalVotes) * 100)
            : null,
      })),
    };
  }

  let question: unknown = null;
  if (row.type === 'question') {
    const qMeta = db
      .prepare('SELECT question_type, allow_voting, best_answer_id FROM questions WHERE post_id = ?')
      .get(row.id) as { question_type: string; allow_voting: number; best_answer_id: number | null } | undefined;
    const answersCountRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM answers WHERE question_post_id = ?')
      .get(row.id) as { cnt: number };
    question = {
      questionType: qMeta?.question_type ?? 'عام',
      allowVoting: qMeta ? qMeta.allow_voting === 1 : true,
      bestAnswerId: qMeta?.best_answer_id ?? null,
      answersCount: Number(answersCountRow?.cnt ?? 0),
    };
  }

  const createdMs = new Date(row.created_at + (row.created_at.endsWith('Z') ? '' : 'Z')).getTime();
  const ageHours = Number.isNaN(createdMs) ? 0 : Math.max(0, (Date.now() - createdMs) / 3600000);

  const likesCount = Number(likesRow?.cnt ?? 0);
  const supportsCount = Number(supportsRow?.cnt ?? 0);
  const commentsCount = Number(commentsRow?.cnt ?? 0);
  const savesCount = Number(savesRow?.cnt ?? 0);

  const trendingScore = computeTrendingScore({
    likesCount,
    supportsCount,
    commentsCount,
    sharesOrSavesCount: Number(row.shares_count) + savesCount,
    contentLength: row.content.length,
    reportsCount: Number(reportsRow?.cnt ?? 0),
    ageHours,
  });

  return {
    id: row.id,
    type: row.type,
    category: row.category,
    moodType: row.mood_type ?? null,
    content: row.content,
    mediaUrl: row.media_url,
    isAnonymous,
    isOwner,
    allowComments: row.allow_comments === 1,
    audience: row.audience,
    communityId: row.community_id,
    communityName: row.community_name ?? null,
    communitySlug: row.community_slug ?? null,
    dailyQuestionId: row.daily_question_id,
    challengeId: row.challenge_id,
    author,
    likesCount,
    supportsCount,
    commentsCount,
    savesCount,
    sharesCount: Number(row.shares_count),
    trendingScore,
    userLiked,
    userSupported,
    userSaved,
    userFollowingPost,
    poll,
    question,
    createdAt: row.created_at,
  };
}

export function canViewPost(row: PostRow, currentUserId: number | null): boolean {
  if (row.is_hidden === 1) return false;
  if (currentUserId && row.author_id === currentUserId) return true;

  // Audience check
  if (row.audience === 'friends') {
    if (!currentUserId || !areFriends(currentUserId, row.author_id)) return false;
  }

  // Profile show_posts_to check (unless anonymous confession/post or inside public community)
  if (row.is_anonymous === 0 && !row.community_id) {
    if (row.show_posts_to === 'only_me') return false;
    if (row.show_posts_to === 'friends') {
      if (!currentUserId || !areFriends(currentUserId, row.author_id)) return false;
    }
  }

  // Community privacy check
  if (row.community_id) {
    const comm = db
      .prepare('SELECT privacy, is_hidden FROM communities WHERE id = ?')
      .get(row.community_id) as { privacy: string; is_hidden: number } | undefined;
    if (!comm || comm.is_hidden === 1) return false;
    if (comm.privacy === 'private') {
      if (!currentUserId) return false;
      const member = db
        .prepare('SELECT 1 FROM community_members WHERE community_id = ? AND user_id = ?')
        .get(row.community_id, currentUserId);
      if (!member) return false;
    }
  }

  return true;
}

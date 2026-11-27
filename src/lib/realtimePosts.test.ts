import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRealtimePostEvent } from './realtimePosts';
import type { Post } from '../types';

const SAMPLE_POST: Post = {
  id: 10,
  type: 'poll',
  category: 'أسئلة',
  moodType: null,
  content: 'تصويت تجريبي',
  mediaUrl: null,
  isAnonymous: false,
  isOwner: false,
  allowComments: true,
  audience: 'public',
  communityId: null,
  communityName: null,
  communitySlug: null,
  dailyQuestionId: null,
  challengeId: null,
  author: null,
  likesCount: 2,
  supportsCount: 1,
  commentsCount: 3,
  savesCount: 0,
  sharesCount: 0,
  trendingScore: 5,
  userLiked: false,
  userSupported: false,
  userSaved: false,
  userFollowingPost: false,
  poll: {
    endsAt: null,
    showResultsMode: 'always',
    userVotedOptionId: null,
    totalVotes: 4,
    showResults: true,
    options: [
      { id: 1, label: 'نعم', votesCount: 3, percent: 75 },
      { id: 2, label: 'لا', votesCount: 1, percent: 25 },
    ],
  },
  question: null,
  createdAt: '2026-11-26T00:00:00Z',
};

test('applyRealtimePostEvent updates reactions, comments, polls, and deletions cleanly', () => {
  const afterReaction = applyRealtimePostEvent([SAMPLE_POST], {
    type: 'post:reaction',
    postId: 10,
    likesCount: 5,
    supportsCount: 4,
  });
  assert.equal(afterReaction[0].likesCount, 5);
  assert.equal(afterReaction[0].supportsCount, 4);

  const afterComment = applyRealtimePostEvent(afterReaction, {
    type: 'post:comment_new',
    postId: 10,
    commentsCount: 4,
  });
  assert.equal(afterComment[0].commentsCount, 4);

  const afterPoll = applyRealtimePostEvent(afterComment, {
    type: 'poll:voted',
    postId: 10,
    totalVotes: 5,
    options: [
      { id: 1, label: 'نعم', votesCount: 4, percent: 80 },
      { id: 2, label: 'لا', votesCount: 1, percent: 20 },
    ],
  });
  assert.equal(afterPoll[0].poll?.totalVotes, 5);
  assert.equal(afterPoll[0].poll?.options[0].percent, 80);

  const afterEdit = applyRealtimePostEvent(afterPoll, {
    type: 'post:updated',
    postId: 10,
    content: 'تصويت محدث',
  });
  assert.equal(afterEdit[0].content, 'تصويت محدث');

  const afterDelete = applyRealtimePostEvent(afterEdit, {
    type: 'post:deleted',
    postId: 10,
  });
  assert.equal(afterDelete.length, 0);
});

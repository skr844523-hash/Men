import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTrendingScore } from './trending';

test('computeTrendingScore weighs comments, support, freshness, quality, and penalizes reports', () => {
  const highDiscussionPost = computeTrendingScore({
    likesCount: 5,
    supportsCount: 4,
    commentsCount: 8,
    sharesOrSavesCount: 3,
    contentLength: 160,
    reportsCount: 0,
    ageHours: 2,
  });

  const likesOnlyOldPost = computeTrendingScore({
    likesCount: 25,
    supportsCount: 0,
    commentsCount: 0,
    sharesOrSavesCount: 0,
    contentLength: 15,
    reportsCount: 0,
    ageHours: 24,
  });

  const reportedPost = computeTrendingScore({
    likesCount: 15,
    supportsCount: 5,
    commentsCount: 6,
    sharesOrSavesCount: 2,
    contentLength: 120,
    reportsCount: 4,
    ageHours: 1,
  });

  assert.ok(highDiscussionPost > likesOnlyOldPost, 'Discussion + freshness beats likes-only older post');
  assert.ok(highDiscussionPost > reportedPost, 'Reported posts are penalized');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAwardablePoints, getLevelInfo } from './gamification';

test('getLevelInfo computes Arabic levels and progress percentages accurately', () => {
  assert.equal(getLevelInfo(0).name, 'مبتدئ');
  assert.equal(getLevelInfo(25).progressPercent, 50);
  assert.equal(getLevelInfo(50).name, 'عضو نشط');
  assert.equal(getLevelInfo(200).name, 'عضو مميز');
  assert.equal(getLevelInfo(500).name, 'نجم المجتمع');
  const legend = getLevelInfo(1250);
  assert.equal(legend.name, 'أسطورة مين');
  assert.equal(legend.progressPercent, 100);
  assert.equal(legend.nextLevelPoints, null);
});

test('calculateAwardablePoints prevents spam, duplicates, and daily cap abuse', () => {
  assert.equal(
    calculateAwardablePoints({
      action: 'create_post',
      content: 'تجربة جميلة أشاركها معكم اليوم',
      recentSameContents: [],
      actionsTodayCount: 0,
    }).awarded,
    10
  );

  // Too short -> 0 points
  assert.equal(
    calculateAwardablePoints({
      action: 'create_comment',
      content: 'ههه',
    }).awarded,
    0
  );

  // Duplicate content -> 0 points
  assert.equal(
    calculateAwardablePoints({
      action: 'create_post',
      content: 'نفس الكلام المكرر هنا',
      recentSameContents: ['نفس الكلام المكرر هنا'],
    }).awarded,
    0
  );

  // Daily cap exceeded -> 0 points
  assert.equal(
    calculateAwardablePoints({
      action: 'give_support',
      actionsTodayCount: 40,
      dailyCap: 40,
    }).awarded,
    0
  );
});

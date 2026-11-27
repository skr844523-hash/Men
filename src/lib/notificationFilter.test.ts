import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRealtimeNotification } from './notificationFilter';

test('evaluateRealtimeNotification allows all instant alerts by default', () => {
  const decision = evaluateRealtimeNotification(
    {
      id: 1,
      type: 'reaction',
      title: 'إعجاب جديد',
      body: 'أعجب بمنشورك',
      isFriendActor: false,
    },
    { notifyPrefs: { instantAlerts: true, friendsOnlyInstantAlerts: false } },
    'home'
  );

  assert.equal(decision.shouldIncrementUnread, true);
  assert.equal(decision.shouldShowInstantAlert, true);
  assert.equal(decision.suppressedByFriendsOnly, false);
});

test('evaluateRealtimeNotification suppresses non-friend post interactions and replies when friendsOnlyInstantAlerts is enabled', () => {
  for (const type of ['reaction', 'comment', 'reply']) {
    const nonFriendDecision = evaluateRealtimeNotification(
      {
        id: 2,
        type,
        title: 'تفاعل',
        body: 'نص',
        isFriendActor: false,
      },
      { notifyPrefs: { instantAlerts: true, friendsOnlyInstantAlerts: true } },
      'home'
    );
    assert.equal(nonFriendDecision.shouldIncrementUnread, false);
    assert.equal(nonFriendDecision.shouldShowInstantAlert, false);
    assert.equal(nonFriendDecision.suppressedByFriendsOnly, true);
  }
});

test('evaluateRealtimeNotification suppresses anonymous interactions from friend-only instant alerts to preserve anonymity', () => {
  const anonDecision = evaluateRealtimeNotification(
    {
      id: 3,
      type: 'comment',
      title: 'تعليق جديد',
      body: 'أضاف شخص مجهول تعليقًا',
      isFriendActor: true,
      isAnonymousActor: true,
    },
    { notifyPrefs: { instantAlerts: true, friendsOnlyInstantAlerts: true } },
    'home'
  );
  assert.equal(anonDecision.shouldShowInstantAlert, false);
  assert.equal(anonDecision.suppressedByFriendsOnly, true);
});

test('evaluateRealtimeNotification triggers instant alert for added friends when friendsOnlyInstantAlerts is enabled', () => {
  const friendDecision = evaluateRealtimeNotification(
    {
      id: 4,
      type: 'reply',
      title: 'رد على تعليقك',
      body: 'صديقك رد عليك',
      isFriendActor: true,
      isAnonymousActor: false,
    },
    { notifyPrefs: { instantAlerts: true, friendsOnlyInstantAlerts: true } },
    'home'
  );
  assert.equal(friendDecision.shouldIncrementUnread, true);
  assert.equal(friendDecision.shouldShowInstantAlert, true);
  assert.equal(friendDecision.suppressedByFriendsOnly, false);
});

test('evaluateRealtimeNotification still allows friend requests and admin broadcasts when friendsOnlyInstantAlerts is enabled', () => {
  const friendReq = evaluateRealtimeNotification(
    {
      id: 5,
      type: 'friend_request',
      title: 'طلب صداقة',
      body: 'أرسل طلب صداقة',
      isFriendActor: false,
    },
    { notifyPrefs: { instantAlerts: true, friendsOnlyInstantAlerts: true } },
    'notifications'
  );
  assert.equal(friendReq.shouldIncrementUnread, false); // Already viewing notifications
  assert.equal(friendReq.shouldShowInstantAlert, true);
  assert.equal(friendReq.suppressedByFriendsOnly, false);
});

test('evaluateRealtimeNotification suppresses all instant alerts when platform instantAlertsEnabled is false', () => {
  const decision = evaluateRealtimeNotification(
    {
      id: 6,
      type: 'comment',
      title: 'تعليق جديد',
      body: 'صديقك علّق على منشورك',
      isFriendActor: true,
      isAnonymousActor: false,
    },
    { notifyPrefs: { instantAlerts: true, friendsOnlyInstantAlerts: true } },
    'home',
    { instantAlertsEnabled: false }
  );
  assert.equal(decision.shouldIncrementUnread, true);
  assert.equal(decision.shouldShowInstantAlert, false);
  assert.equal(decision.suppressedByPlatformPolicy, true);

  const broadcastBlocked = evaluateRealtimeNotification(
    {
      id: 7,
      type: 'admin_announcement',
      title: 'إعلان إداري',
      body: 'تنبيه عام',
    },
    { notifyPrefs: { instantAlerts: true } },
    'home',
    { instantAlertsEnabled: false }
  );
  assert.equal(broadcastBlocked.shouldShowInstantAlert, false);
  assert.equal(broadcastBlocked.suppressedByPlatformPolicy, true);
});

test('evaluateRealtimeNotification suppresses regular instant alerts in platform quietModeEnabled while allowing admin broadcasts if enabled', () => {
  const regularDecision = evaluateRealtimeNotification(
    {
      id: 8,
      type: 'reaction',
      title: 'إعجاب',
      body: 'تفاعل',
      isFriendActor: true,
    },
    { notifyPrefs: { instantAlerts: true } },
    'home',
    { instantAlertsEnabled: true, quietModeEnabled: true, allowBroadcastBanner: true }
  );
  assert.equal(regularDecision.shouldShowInstantAlert, false);
  assert.equal(regularDecision.suppressedByPlatformPolicy, true);

  const adminDecision = evaluateRealtimeNotification(
    {
      id: 9,
      type: 'admin_announcement',
      title: 'تنبيه هام',
      body: 'تحديث المنصة',
    },
    { notifyPrefs: { instantAlerts: true } },
    'home',
    { instantAlertsEnabled: true, quietModeEnabled: true, allowBroadcastBanner: true }
  );
  assert.equal(adminDecision.shouldShowInstantAlert, true);
  assert.equal(adminDecision.suppressedByPlatformPolicy, false);
});

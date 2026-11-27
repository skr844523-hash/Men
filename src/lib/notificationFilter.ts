import type { GlobalNotificationSettings, User } from '../types';

export interface RealtimeNotificationPayload {
  id: number;
  type: string;
  title: string;
  body: string;
  targetType?: string | null;
  targetId?: number | null;
  isFriendActor?: boolean;
  isAnonymousActor?: boolean;
  isRead?: boolean;
  createdAt?: string;
}

export interface NotificationAlertDecision {
  shouldIncrementUnread: boolean;
  shouldShowInstantAlert: boolean;
  suppressedByFriendsOnly: boolean;
  suppressedByPlatformPolicy: boolean;
}

const POST_INTERACTION_TYPES = new Set(['reaction', 'comment', 'reply']);

export function evaluateRealtimeNotification(
  notification: RealtimeNotificationPayload,
  user: Pick<User, 'notifyPrefs'> | null,
  currentSection?: string,
  globalSettings?: Partial<GlobalNotificationSettings>
): NotificationAlertDecision {
  const prefs = user?.notifyPrefs ?? {};
  const userInstantEnabled = prefs.instantAlerts !== false;
  const friendsOnlyInstant = prefs.friendsOnlyInstantAlerts === true;

  const platformInstantEnabled = globalSettings?.instantAlertsEnabled !== false;
  const platformQuietMode = globalSettings?.quietModeEnabled === true;
  const isAdminBroadcast = notification.type === 'admin_announcement';

  // Admin broadcasts are controlled by platform instant alerts + allowBroadcastBanner
  if (isAdminBroadcast) {
    const broadcastAllowed =
      platformInstantEnabled && globalSettings?.allowBroadcastBanner !== false;
    return {
      shouldIncrementUnread: currentSection !== 'notifications',
      shouldShowInstantAlert: broadcastAllowed && userInstantEnabled,
      suppressedByFriendsOnly: false,
      suppressedByPlatformPolicy: !broadcastAllowed,
    };
  }

  // Platform-wide instant alert disable or quiet mode
  if (!platformInstantEnabled || platformQuietMode) {
    return {
      shouldIncrementUnread: currentSection !== 'notifications',
      shouldShowInstantAlert: false,
      suppressedByFriendsOnly: false,
      suppressedByPlatformPolicy: true,
    };
  }

  if (friendsOnlyInstant && POST_INTERACTION_TYPES.has(notification.type)) {
    const isVerifiedFriend =
      notification.isFriendActor === true && notification.isAnonymousActor !== true;
    if (!isVerifiedFriend) {
      return {
        shouldIncrementUnread: false,
        shouldShowInstantAlert: false,
        suppressedByFriendsOnly: true,
        suppressedByPlatformPolicy: false,
      };
    }
  }

  return {
    shouldIncrementUnread: currentSection !== 'notifications',
    shouldShowInstantAlert: userInstantEnabled,
    suppressedByFriendsOnly: false,
    suppressedByPlatformPolicy: false,
  };
}

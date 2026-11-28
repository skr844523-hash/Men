import { BADGE_CATALOG, calculateAwardablePoints, PointAction } from '../../src/lib/gamification.ts';
import { getLevelInfo } from '../../src/lib/gamification.ts';
import { all, get, getKV, insert, nowIso, patch, setKV, where, put } from './store.ts';
import { rtdb } from './admin.ts';

export const DEFAULT_NOTIFICATION_SETTINGS = {
  instantAlertsEnabled: true,
  browserPushEnabled: true,
  quietModeEnabled: false,
  allowReactionNotifs: true,
  allowCommentNotifs: true,
  allowFriendNotifs: true,
  allowMessageNotifs: true,
  allowBroadcastBanner: true,
};

export const DEFAULT_AVATAR = '/src/assets/images/meen_avatar_1_1795731517922.jpg';

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  categories: ['فضفضة', 'مشاعر', 'مواقف', 'أسئلة', 'قصص', 'نصائح', 'علاقات', 'الحياة اليومية'],
  announcement: '',
  terms_text:
    'أهلًا بك في مين؟ MEEN. باستخدامك المنصة فإنك توافق على احترام الآخرين، عدم التحرش أو التهديد أو الابتزاز، عدم كشف البيانات الشخصية أو بيانات القاصرين، والالتزام بأن عمرك 13 عامًا فأكثر.',
  privacy_text:
    'نحمي هويتك بالكامل عند النشر أو الفضفضة كمجهول؛ لا يتم تضمين معرفك أو بياناتك الشخصية في أي استجابة عامة. يمكنك تعديل خصوصية ملفك وحسابك أو حذفه في أي وقت.',
  monetization: { adsEnabled: false, premiumEnabled: false, supporterBadgesEnabled: false, announcementSlot: '' },
  notification_settings: DEFAULT_NOTIFICATION_SETTINGS,
};

export async function getSetting<T>(key: string, fallback?: T): Promise<T> {
  const v = await getKV<T | null>(`settings/${key}`, null);
  if (v !== null) return v;
  return (key in DEFAULT_SETTINGS ? DEFAULT_SETTINGS[key] : fallback) as T;
}
export async function setSetting(key: string, value: unknown) {
  await setKV(`settings/${key}`, value);
}

let seeded = false;
// Idempotent: creates the badge catalog (system data, not demo content) once.
export async function ensureCatalog(): Promise<void> {
  if (seeded) return;
  const existing = await getKV<boolean>('meta/catalogSeeded', false);
  if (!existing) {
    for (const b of BADGE_CATALOG) {
      await put('badges', b.slug, {
        slug: b.slug, title: b.title, description: b.description,
        icon_name: b.iconName, points_required: b.pointsRequired,
      });
    }
    await setKV('meta/catalogSeeded', true);
  }
  seeded = true;
}

export async function getUserPointsTotal(userId: number): Promise<number> {
  const rows = await where<{ points: number }>('user_points', 'user_id', userId);
  return rows.reduce((s, r) => s + Number(r.points || 0), 0);
}

export async function grantBadgeIfEligible(userId: number, slug: string): Promise<boolean> {
  const key = `${userId}_${slug}`;
  const r = await rtdb.ref(`t/user_badges/${key}`).transaction((v) =>
    v == null ? { user_id: userId, badge_slug: slug, awarded_at: nowIso() } : undefined
  );
  return r.committed;
}

export async function awardUserPoints(userId: number, action: PointAction, refId?: number, content?: string): Promise<number> {
  const posts = (await where<any>('posts', 'author_id', userId)).sort((a, b) => b.id - a.id).slice(0, 5);
  const pts = await where<any>('user_points', 'user_id', userId);
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = pts.filter((p) => String(p.created_at).slice(0, 10) === today).length;
  const res = calculateAwardablePoints({
    action, content,
    recentSameContents: posts.map((r) => r.content),
    actionsTodayCount: todayCount,
  });
  if (res.awarded > 0) {
    await insert('user_points', { user_id: userId, action_type: action, points: res.awarded, ref_id: refId ?? null, created_at: nowIso() });
  }
  if (action === 'signup') await grantBadgeIfEligible(userId, 'new_member');
  if (action === 'create_post') await grantBadgeIfEligible(userId, 'first_post');
  if (action === 'create_comment') await grantBadgeIfEligible(userId, 'first_comment');
  if (action === 'best_answer') await grantBadgeIfEligible(userId, 'best_answerer');
  if (action === 'challenge_entry') await grantBadgeIfEligible(userId, 'challenge_participant');
  if (action === 'community_join') await grantBadgeIfEligible(userId, 'active_community');
  if (action === 'give_support') {
    const rx = await where<any>('reactions', 'user_id', userId);
    if (rx.filter((r) => r.reaction_type === 'support').length >= 5) await grantBadgeIfEligible(userId, 'supporter');
  }
  return res.awarded;
}

export async function isBlockedBetween(a: number, b: number): Promise<boolean> {
  const x = await where<any>('blocked_users', 'blocker_id', a);
  if (x.some((r) => r.blocked_id === b)) return true;
  const y = await where<any>('blocked_users', 'blocker_id', b);
  return y.some((r) => r.blocked_id === a);
}

export async function areFriends(a: number, b: number): Promise<boolean> {
  const x = await where<any>('friendships', 'requester_id', a);
  if (x.some((r) => r.addressee_id === b && r.status === 'accepted')) return true;
  const y = await where<any>('friendships', 'requester_id', b);
  return y.some((r) => r.addressee_id === a && r.status === 'accepted');
}

export async function buildUserPayload(userId: number) {
  const u = await get<any>('users', userId);
  if (!u) return null;
  const points = await getUserPointsTotal(userId);
  const level = getLevelInfo(points);
  const ub = (await where<any>('user_badges', 'user_id', userId)).sort((a, b) => String(b.awarded_at).localeCompare(String(a.awarded_at)));
  const badges: any[] = [];
  for (const x of ub) {
    const b = await get<any>('badges', x.badge_slug);
    if (b) badges.push({ slug: b.slug, title: b.title, description: b.description, icon_name: b.icon_name, awarded_at: x.awarded_at });
  }
  const notifs = await where<any>('notifications', 'user_id', userId);
  const unreadNotifications = notifs.filter((n) => !n.is_read).length;
  const convs = [
    ...(await where<any>('conversations', 'user1_id', userId)),
    ...(await where<any>('conversations', 'user2_id', userId)),
  ].filter((c) => c.status === 'active');
  let unreadMessages = 0;
  for (const c of convs) {
    const msgs = await where<any>('messages', 'conversation_id', c.id);
    unreadMessages += msgs.filter((m) => m.sender_id !== userId && m.status !== 'read' && !m.deleted_by_sender).length;
  }
  const notifyPrefs = {
    messages: true, comments: true, reactions: true, friends: true, communities: true, challenges: true, daily: true,
    instantAlerts: true, friendsOnlyInstantAlerts: false,
    ...Object.fromEntries(Object.entries(u.notify_prefs || {}).filter(([, v]) => typeof v === 'boolean')),
  };
  return {
    id: u.id, uid: u.uid as string, username: u.username, email: u.email ?? null, phone: u.phone ?? null,
    role: u.role, status: u.status, createdAt: u.created_at,
    displayName: u.display_name, avatar: u.avatar, bio: u.bio || '',
    interests: Array.isArray(u.interests) ? u.interests : [],
    privacyLevel: u.privacy_level, showActivity: Boolean(u.show_activity),
    allowMessagesFrom: u.allow_messages_from, allowCommentsFrom: u.allow_comments_from,
    showPostsTo: u.show_posts_to, allowAnonMentions: Boolean(u.allow_anon_mentions),
    notifyPrefs, isPremium: Boolean(u.is_premium),
    emailVerified: Boolean(u.email_verified),
    points, level, badges, unreadNotifications, unreadMessages,
  };
}

export async function adminCount(): Promise<number> {
  return (await where<any>('users', 'role', 'admin')).length;
}
export { all, patch };

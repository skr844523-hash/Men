import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { BADGE_CATALOG, calculateAwardablePoints, PointAction } from '../src/lib/gamification.ts';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(dataDir, 'meen.sqlite');

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT UNIQUE COLLATE NOCASE,
      phone TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      recovery_code_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'moderator', 'admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'banned')),
      birth_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '/src/assets/images/meen_avatar_1_1795731517922.jpg',
      bio TEXT NOT NULL DEFAULT '',
      interests_json TEXT NOT NULL DEFAULT '[]',
      privacy_level TEXT NOT NULL DEFAULT 'public' CHECK(privacy_level IN ('public', 'friends', 'limited')),
      show_activity INTEGER NOT NULL DEFAULT 1,
      allow_messages_from TEXT NOT NULL DEFAULT 'everyone' CHECK(allow_messages_from IN ('everyone', 'friends', 'none')),
      allow_comments_from TEXT NOT NULL DEFAULT 'everyone' CHECK(allow_comments_from IN ('everyone', 'friends', 'none')),
      show_posts_to TEXT NOT NULL DEFAULT 'everyone' CHECK(show_posts_to IN ('everyone', 'friends', 'only_me')),
      allow_anon_mentions INTEGER NOT NULL DEFAULT 1,
      notify_prefs_json TEXT NOT NULL DEFAULT '{"messages":true,"comments":true,"reactions":true,"friends":true,"communities":true,"challenges":true,"daily":true}',
      is_premium INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS communities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      avatar_url TEXT NOT NULL DEFAULT '/src/assets/images/meen_brand_emblem_1795731517188.jpg',
      cover_url TEXT NOT NULL DEFAULT '/src/assets/images/meen_community_cover_1795731518126.jpg',
      rules TEXT NOT NULL DEFAULT 'احترم الجميع، لا تنشر معلومات شخصية، ولا تستخدم ألفاظًا مسيئة.',
      privacy TEXT NOT NULL DEFAULT 'public' CHECK(privacy IN ('public', 'private')),
      who_can_post TEXT NOT NULL DEFAULT 'members' CHECK(who_can_post IN ('members', 'moderators')),
      creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS community_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'moderator', 'owner')),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(community_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS daily_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_text TEXT NOT NULL,
      date_key TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      points_reward INTEGER NOT NULL DEFAULT 20,
      badge_slug TEXT DEFAULT 'challenge_participant',
      starts_at TEXT NOT NULL DEFAULT (datetime('now')),
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'post' CHECK(type IN ('post', 'confession', 'question', 'poll', 'challenge_entry')),
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      media_url TEXT,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      allow_comments INTEGER NOT NULL DEFAULT 1,
      audience TEXT NOT NULL DEFAULT 'public' CHECK(audience IN ('public', 'friends', 'community')),
      community_id INTEGER REFERENCES communities(id) ON DELETE CASCADE,
      daily_question_id INTEGER REFERENCES daily_questions(id) ON DELETE SET NULL,
      challenge_id INTEGER REFERENCES challenges(id) ON DELETE SET NULL,
      shares_count INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS confessions (
      post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
      mood_type TEXT NOT NULL DEFAULT 'فضفضة عامة',
      is_nameless INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS community_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(community_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS questions (
      post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
      question_type TEXT NOT NULL DEFAULT 'عام',
      allow_voting INTEGER NOT NULL DEFAULT 1,
      best_answer_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      is_best INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS answer_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      answer_id INTEGER NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      value INTEGER NOT NULL DEFAULT 1 CHECK(value IN (-1, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(answer_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS polls (
      post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
      ends_at TEXT,
      show_results_mode TEXT NOT NULL DEFAULT 'always' CHECK(show_results_mode IN ('always', 'after_vote'))
    );

    CREATE TABLE IF NOT EXISTS poll_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS poll_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(poll_post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS challenge_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(challenge_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comment_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment', 'answer')),
      target_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction_type TEXT NOT NULL CHECK(reaction_type IN ('like', 'support')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(target_type, target_id, user_id, reaction_type)
    );

    CREATE TABLE IF NOT EXISTS post_follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS saved_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      collection_tag TEXT NOT NULL DEFAULT 'عام',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(requester_id, addressee_id)
    );

    CREATE TABLE IF NOT EXISTS follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(follower_id, following_id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'request', 'declined')),
      last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user1_id, user2_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      media_url TEXT,
      message_type TEXT NOT NULL DEFAULT 'text' CHECK(message_type IN ('text', 'image', 'audio')),
      reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent', 'delivered', 'read')),
      deleted_by_sender INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_anonymous_actor INTEGER NOT NULL DEFAULT 0,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment', 'user', 'community', 'message')),
      target_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'accepted', 'rejected')),
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      resolution_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS blocked_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(blocker_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS badges (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      icon_name TEXT NOT NULL,
      points_required INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_badges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_slug TEXT NOT NULL REFERENCES badges(slug) ON DELETE CASCADE,
      awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, badge_slug)
    );

    CREATE TABLE IF NOT EXISTS user_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      points INTEGER NOT NULL,
      ref_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS moderation_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      moderator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS support_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_review', 'resolved')),
      admin_reply TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_type_cat ON posts(type, category);
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
  `);

  seedSystemCatalogOnly();
}

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

function seedSystemCatalogOnly(): void {
  // Seed badge definitions
  const insertBadge = db.prepare(`
    INSERT OR IGNORE INTO badges (slug, title, description, icon_name, points_required)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const b of BADGE_CATALOG) {
    insertBadge.run(b.slug, b.title, b.description, b.iconName, b.pointsRequired);
  }

  // Seed default app settings (categories, announcements, safety rules, monetization flags)
  const defaultSettings: Record<string, unknown> = {
    categories: [
      'فضفضة',
      'مشاعر',
      'مواقف',
      'أسئلة',
      'قصص',
      'نصائح',
      'علاقات',
      'الحياة اليومية',
    ],
    announcement: '',
    terms_text:
      'أهلًا بك في مين؟ MEEN. باستخدامك المنصة فإنك توافق على احترام الآخرين، عدم التحرش أو التهديد أو الابتزاز، عدم كشف البيانات الشخصية أو بيانات القاصرين، والالتزام بأن عمرك 13 عامًا فأكثر.',
    privacy_text:
      'نحمي هويتك بالكامل عند النشر أو الفضفضة كمجهول؛ لا يتم تضمين معرفك أو بياناتك الشخصية في أي استجابة عامة. يمكنك تعديل خصوصية ملفك وحسابك أو حذفه في أي وقت.',
    monetization: {
      adsEnabled: false,
      premiumEnabled: false,
      supporterBadgesEnabled: false,
      announcementSlot: '',
    },
    notification_settings: DEFAULT_NOTIFICATION_SETTINGS,
  };

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO app_settings (key, value_json) VALUES (?, ?)
  `);
  for (const [k, v] of Object.entries(defaultSettings)) {
    insertSetting.run(k, JSON.stringify(v));
  }

  // Seed initial Daily Question prompt ONLY if none exists (zero fake answers)
  const existingDaily = db.prepare('SELECT id FROM daily_questions LIMIT 1').get();
  if (!existingDaily) {
    const todayKey = new Date().toISOString().slice(0, 10);
    db.prepare(
      `INSERT INTO daily_questions (question_text, date_key, is_active) VALUES (?, ?, 1)`
    ).run('إيه أكتر حاجة نفسك تحققها الفترة الجاية ومستني اللحظة المناسبة تبدأها؟', todayKey);
  }

  // Seed initial safe positive Challenge prompts ONLY if none exists (zero fake entries)
  const existingChallenge = db.prepare('SELECT id FROM challenges LIMIT 1').get();
  if (!existingChallenge) {
    const nextWeek = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    const insertChallenge = db.prepare(`
      INSERT INTO challenges (title, description, category, points_reward, badge_slug, ends_at, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `);
    insertChallenge.run(
      'اكتب حاجة إيجابية عن نفسك',
      'تحدي خفيف لتقدير الذات: شارك صفة حلوة فيك أو خطوة فخور إنك عملتها الفترة دي.',
      'تقدير الذات',
      20,
      'challenge_participant',
      nextWeek
    );
    insertChallenge.run(
      'شارك موقف مضحك من يومك',
      'احكي موقف طريف حصلك مؤخرًا ورسم ابتسامة على وشك.',
      'ضحك ومواقف',
      15,
      'challenge_participant',
      nextWeek
    );
    insertChallenge.run(
      'تحدي صورة من يومك',
      'شارك لحظة هادئة أو كوب قهوة أو منظر عجبك النهاردة بدون أي بيانات شخصية.',
      'الحياة اليومية',
      25,
      'challenge_participant',
      nextWeek
    );
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key) as
    | { value_json: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`
  ).run(key, JSON.stringify(value));
}

export function getUserPointsTotal(userId: number): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(points), 0) AS total FROM user_points WHERE user_id = ?')
    .get(userId) as { total: number };
  return Number(row?.total ?? 0);
}

export function grantBadgeIfEligible(userId: number, slug: string): boolean {
  const res = db
    .prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_slug) VALUES (?, ?)')
    .run(userId, slug);
  return Number(res.changes) > 0;
}

export function awardUserPoints(
  userId: number,
  action: PointAction,
  refId?: number,
  content?: string
): number {
  const recentRows = db
    .prepare(
      `SELECT content FROM posts WHERE author_id = ? ORDER BY id DESC LIMIT 5`
    )
    .all(userId) as Array<{ content: string }>;

  const todayCountRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM user_points WHERE user_id = ? AND date(created_at) = date('now')`
    )
    .get(userId) as { cnt: number };

  const res = calculateAwardablePoints({
    action,
    content,
    recentSameContents: recentRows.map((r) => r.content),
    actionsTodayCount: Number(todayCountRow?.cnt ?? 0),
  });

  if (res.awarded > 0) {
    db.prepare(
      'INSERT INTO user_points (user_id, action_type, points, ref_id) VALUES (?, ?, ?, ?)'
    ).run(userId, action, res.awarded, refId ?? null);
  }

  // Automatic badge grants based on real milestones
  if (action === 'signup') grantBadgeIfEligible(userId, 'new_member');
  if (action === 'create_post') grantBadgeIfEligible(userId, 'first_post');
  if (action === 'create_comment') grantBadgeIfEligible(userId, 'first_comment');
  if (action === 'best_answer') grantBadgeIfEligible(userId, 'best_answerer');
  if (action === 'challenge_entry') grantBadgeIfEligible(userId, 'challenge_participant');
  if (action === 'community_join') grantBadgeIfEligible(userId, 'active_community');
  if (action === 'give_support') {
    const supportCount = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM reactions WHERE user_id = ? AND reaction_type = 'support'`
      )
      .get(userId) as { cnt: number };
    if (Number(supportCount?.cnt ?? 0) >= 5) {
      grantBadgeIfEligible(userId, 'supporter');
    }
  }

  return res.awarded;
}

export function isBlockedBetween(userA: number, userB: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM blocked_users
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
       LIMIT 1`
    )
    .get(userA, userB, userB, userA);
  return Boolean(row);
}

export function areFriends(userA: number, userB: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM friendships
       WHERE ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
         AND status = 'accepted'
       LIMIT 1`
    )
    .get(userA, userB, userB, userA);
  return Boolean(row);
}

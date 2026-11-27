import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, awardUserPoints, DEFAULT_NOTIFICATION_SETTINGS, getUserPointsTotal, getSetting } from '../db.ts';
import {
  clearSessionCookie,
  createSession,
  hashPassword,
  rateLimit,
  requireAuth,
  revokeSession,
  setSessionCookie,
  verifyPassword,
} from '../auth.ts';
import {
  checkContentSafety,
  checkMinimumAge,
  sanitizeMediaUrl,
  validateEmail,
  validatePassword,
  validatePhone,
  validateUsername,
} from '../../src/lib/validation.ts';
import { getLevelInfo } from '../../src/lib/gamification.ts';

export const authRouter = Router();

const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

function buildUserPayload(userId: number) {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.phone, u.role, u.status, u.birth_date, u.created_at,
              p.display_name, p.avatar, p.bio, p.interests_json, p.privacy_level,
              p.show_activity, p.allow_messages_from, p.allow_comments_from, p.show_posts_to,
              p.allow_anon_mentions, p.notify_prefs_json, p.is_premium
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       WHERE u.id = ?`
    )
    .get(userId) as Record<string, unknown> | undefined;

  if (!row) return null;

  const points = getUserPointsTotal(userId);
  const level = getLevelInfo(points);
  const badges = db
    .prepare(
      `SELECT b.slug, b.title, b.description, b.icon_name, ub.awarded_at
       FROM user_badges ub
       JOIN badges b ON b.slug = ub.badge_slug
       WHERE ub.user_id = ?
       ORDER BY ub.awarded_at DESC`
    )
    .all(userId);

  const unreadNotifs = db
    .prepare('SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(userId) as { cnt: number };

  const unreadMsgs = db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE (c.user1_id = ? OR c.user2_id = ?)
         AND m.sender_id != ?
         AND m.status != 'read'
         AND m.deleted_by_sender = 0
         AND c.status = 'active'`
    )
    .get(userId, userId, userId) as { cnt: number };

  let interests: string[] = [];
  let notifyPrefs: Record<string, boolean> = {
    messages: true,
    comments: true,
    reactions: true,
    friends: true,
    communities: true,
    challenges: true,
    daily: true,
    instantAlerts: true,
    friendsOnlyInstantAlerts: false,
  };
  try {
    interests = JSON.parse(String(row.interests_json || '[]'));
  } catch {
    interests = [];
  }
  try {
    const parsed = JSON.parse(String(row.notify_prefs_json || '{}')) as Record<string, unknown>;
    notifyPrefs = {
      ...notifyPrefs,
      ...Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === 'boolean') as Array<[string, boolean]>
      ),
    };
  } catch {
    // Keep defaults
  }

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    displayName: row.display_name,
    avatar: row.avatar,
    bio: row.bio,
    interests,
    privacyLevel: row.privacy_level,
    showActivity: Boolean(row.show_activity),
    allowMessagesFrom: row.allow_messages_from,
    allowCommentsFrom: row.allow_comments_from,
    showPostsTo: row.show_posts_to,
    allowAnonMentions: Boolean(row.allow_anon_mentions),
    notifyPrefs,
    isPremium: Boolean(row.is_premium),
    points,
    level,
    badges,
    unreadNotifications: Number(unreadNotifs?.cnt ?? 0),
    unreadMessages: Number(unreadMsgs?.cnt ?? 0),
  };
}

authRouter.get('/auth/me', (req, res) => {
  const adminCountRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'`)
    .get() as { cnt: number };

  const monetization = getSetting('monetization', {
    adsEnabled: false,
    premiumEnabled: false,
    supporterBadgesEnabled: false,
    announcementSlot: '',
  });
  const announcement = getSetting('announcement', '');
  const categories = getSetting<string[]>('categories', []);
  const termsText = getSetting('terms_text', '');
  const privacyText = getSetting('privacy_text', '');
  const notificationSettings = getSetting('notification_settings', DEFAULT_NOTIFICATION_SETTINGS);

  if (!req.user) {
    res.json({
      user: null,
      hasAdmin: Number(adminCountRow?.cnt ?? 0) > 0,
      appConfig: { categories, announcement, termsText, privacyText, monetization, notificationSettings },
    });
    return;
  }

  const userPayload = buildUserPayload(req.user.id);
  res.json({
    user: userPayload,
    hasAdmin: Number(adminCountRow?.cnt ?? 0) > 0,
    appConfig: { categories, announcement, termsText, privacyText, monetization, notificationSettings },
  });
});

authRouter.post('/auth/register', rateLimit('register', 10, 60000), (req, res) => {
  const {
    displayName,
    username,
    email,
    phone,
    password,
    confirmPassword,
    birthDate,
    avatar,
    interests,
    termsAccepted,
    rememberMe = true,
  } = req.body ?? {};

  if (!termsAccepted) {
    res.status(400).json({ error: 'يجب الموافقة على الشروط وسياسة الخصوصية أولًا.' });
    return;
  }

  const cleanDisplay = typeof displayName === 'string' ? displayName.trim() : '';
  if (cleanDisplay.length < 2 || cleanDisplay.length > 40) {
    res.status(400).json({ error: 'الاسم المستعار يجب أن يكون بين حرفين و40 حرفًا.' });
    return;
  }

  const userCheck = validateUsername(String(username || ''));
  if (!userCheck.valid) {
    res.status(400).json({ error: userCheck.error });
    return;
  }

  const cleanEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
  const cleanPhone =
    typeof phone === 'string' && phone.trim() ? phone.replace(/[\s\-()]/g, '') : null;

  if (!cleanEmail || !validateEmail(cleanEmail)) {
    res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح.' });
    return;
  }
  if (cleanPhone && !validatePhone(cleanPhone)) {
    res.status(400).json({ error: 'رقم الهاتف غير صالح.' });
    return;
  }

  const passCheck = validatePassword(String(password || ''));
  if (!passCheck.valid) {
    res.status(400).json({ error: passCheck.error });
    return;
  }
  if (password !== confirmPassword) {
    res.status(400).json({ error: 'كلمتا المرور غير متطابقتين.' });
    return;
  }

  const ageCheck = checkMinimumAge(String(birthDate || ''), 13);
  if (!ageCheck.valid) {
    res.status(400).json({ error: ageCheck.error });
    return;
  }

  // Uniqueness checks
  const dupUser = db.prepare('SELECT id FROM users WHERE username = ?').get(userCheck.value);
  if (dupUser) {
    res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل، اختر اسمًا آخر.' });
    return;
  }
  const dupEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (dupEmail) {
    res.status(409).json({ error: 'البريد الإلكتروني مسجل مسبقًا.' });
    return;
  }
  if (cleanPhone) {
    const dupPhone = db.prepare('SELECT id FROM users WHERE phone = ?').get(cleanPhone);
    if (dupPhone) {
      res.status(409).json({ error: 'رقم الهاتف مسجل مسبقًا.' });
      return;
    }
  }

  const passwordHash = hashPassword(String(password));
  const recoveryCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  const recoveryCodeHash = hashPassword(recoveryCode);

  const safeAvatar =
    sanitizeMediaUrl(avatar) || '/src/assets/images/meen_avatar_1_1795731517922.jpg';
  const cleanInterests = Array.isArray(interests)
    ? interests.filter((x): x is string => typeof x === 'string').slice(0, 12)
    : [];

  const insertUser = db
    .prepare(
      `INSERT INTO users (username, email, phone, password_hash, recovery_code_hash, role, status, birth_date)
       VALUES (?, ?, ?, ?, ?, 'user', 'active', ?)`
    )
    .run(userCheck.value, cleanEmail, cleanPhone, passwordHash, recoveryCodeHash, String(birthDate));

  const userId = Number(insertUser.lastInsertRowid);

  db.prepare(
    `INSERT INTO profiles (user_id, display_name, avatar, interests_json)
     VALUES (?, ?, ?, ?)`
  ).run(userId, cleanDisplay, safeAvatar, JSON.stringify(cleanInterests));

  awardUserPoints(userId, 'signup', userId);

  const persistSession = Boolean(rememberMe);
  const session = createSession(userId, persistSession, req.headers['user-agent'] || '');
  setSessionCookie(res, req, session.token, session.expiresAt, persistSession);

  res.status(201).json({
    token: session.token,
    recoveryCode,
    user: buildUserPayload(userId),
  });
});

authRouter.post('/auth/login', rateLimit('login', 15, 60000), (req, res) => {
  const { identifier, password, rememberMe = true } = req.body ?? {};
  const cleanId = typeof identifier === 'string' ? identifier.trim().toLowerCase() : '';
  if (!cleanId || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'يرجى إدخال اسم المستخدم أو البريد وكلمة المرور.' });
    return;
  }

  const normalizedHandle = cleanId.replace(/^@+/, '');
  const userRow = db
    .prepare(
      `SELECT id, password_hash, status
       FROM users
       WHERE username = ? OR email = ? OR phone = ?
       LIMIT 1`
    )
    .get(normalizedHandle, cleanId, cleanId.replace(/[\s\-()]/g, '')) as
    | { id: number; password_hash: string; status: string }
    | undefined;

  if (!userRow || !verifyPassword(password, userRow.password_hash)) {
    res.status(401).json({ error: 'بيانات تسجيل الدخول غير صحيحة.' });
    return;
  }

  if (userRow.status === 'banned') {
    res.status(403).json({ error: 'تم حظر هذا الحساب لمخالفة قواعد المنصة.' });
    return;
  }

  db.prepare(`UPDATE users SET last_active_at = datetime('now') WHERE id = ?`).run(userRow.id);
  const persistSession = Boolean(rememberMe);
  const session = createSession(userRow.id, persistSession, req.headers['user-agent'] || '');
  setSessionCookie(res, req, session.token, session.expiresAt, persistSession);

  res.json({
    token: session.token,
    user: buildUserPayload(userRow.id),
  });
});

authRouter.post('/auth/logout', (req, res) => {
  if (req.sessionToken) {
    revokeSession(req.sessionToken);
  }
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

authRouter.post('/auth/recover', rateLimit('recover', 8, 60000), (req, res) => {
  const { identifier, recoveryCode, newPassword, confirmPassword } = req.body ?? {};
  const cleanId = typeof identifier === 'string' ? identifier.trim().toLowerCase() : '';
  const cleanCode = typeof recoveryCode === 'string' ? recoveryCode.trim().toUpperCase() : '';

  if (!cleanId || !cleanCode) {
    res.status(400).json({ error: 'يرجى إدخال الحساب ورمز الاستعادة.' });
    return;
  }

  const passCheck = validatePassword(String(newPassword || ''));
  if (!passCheck.valid) {
    res.status(400).json({ error: passCheck.error });
    return;
  }
  if (newPassword !== confirmPassword) {
    res.status(400).json({ error: 'كلمتا المرور غير متطابقتين.' });
    return;
  }

  const userRow = db
    .prepare(
      `SELECT id, recovery_code_hash FROM users WHERE username = ? OR email = ? OR phone = ? LIMIT 1`
    )
    .get(cleanId.replace(/^@+/, ''), cleanId, cleanId.replace(/[\s\-()]/g, '')) as
    | { id: number; recovery_code_hash: string }
    | undefined;

  if (!userRow || !verifyPassword(cleanCode, userRow.recovery_code_hash)) {
    res.status(401).json({ error: 'بيانات الحساب أو رمز الاستعادة غير صحيح.' });
    return;
  }

  const newHash = hashPassword(String(newPassword));
  const nextRecovery = crypto.randomBytes(4).toString('hex').toUpperCase();
  const nextRecoveryHash = hashPassword(nextRecovery);

  db.prepare(
    `UPDATE users SET password_hash = ?, recovery_code_hash = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(newHash, nextRecoveryHash, userRow.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userRow.id);

  res.json({
    ok: true,
    newRecoveryCode: nextRecovery,
    message: 'تمت استعادة الحساب وتحديث كلمة المرور بنجاح. احتفظ برمز الاستعادة الجديد.',
  });
});

authRouter.patch('/account/profile', requireAuth, (req, res) => {
  const userId = req.user!.id;
  const { displayName, username, bio, avatar, interests, email, phone } = req.body ?? {};

  if (displayName !== undefined) {
    const clean = String(displayName).trim();
    if (clean.length < 2 || clean.length > 40) {
      res.status(400).json({ error: 'الاسم المستعار يجب أن يكون بين حرفين و40 حرفًا.' });
      return;
    }
    db.prepare(`UPDATE profiles SET display_name = ?, updated_at = datetime('now') WHERE user_id = ?`).run(
      clean,
      userId
    );
  }

  if (username !== undefined) {
    const check = validateUsername(String(username));
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }
    const existing = db
      .prepare('SELECT id FROM users WHERE username = ? AND id != ?')
      .get(check.value, userId);
    if (existing) {
      res.status(409).json({ error: 'اسم المستخدم محجوز لحساب آخر.' });
      return;
    }
    db.prepare(`UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ?`).run(
      check.value,
      userId
    );
  }

  if (email !== undefined) {
    const cleanEmail = String(email).trim().toLowerCase() || null;
    if (cleanEmail && !validateEmail(cleanEmail)) {
      res.status(400).json({ error: 'صيغة البريد الإلكتروني غير صحيحة.' });
      return;
    }
    if (cleanEmail) {
      const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(cleanEmail, userId);
      if (dup) {
        res.status(409).json({ error: 'البريد مستخدم في حساب آخر.' });
        return;
      }
    }
    db.prepare(`UPDATE users SET email = ?, updated_at = datetime('now') WHERE id = ?`).run(
      cleanEmail,
      userId
    );
  }

  if (phone !== undefined) {
    const cleanPhone = String(phone).replace(/[\s\-()]/g, '') || null;
    if (cleanPhone && !validatePhone(cleanPhone)) {
      res.status(400).json({ error: 'رقم الهاتف غير صالح.' });
      return;
    }
    if (cleanPhone) {
      const dup = db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(cleanPhone, userId);
      if (dup) {
        res.status(409).json({ error: 'رقم الهاتف مستخدم في حساب آخر.' });
        return;
      }
    }
    db.prepare(`UPDATE users SET phone = ?, updated_at = datetime('now') WHERE id = ?`).run(
      cleanPhone,
      userId
    );
  }

  if (bio !== undefined) {
    const cleanBio = String(bio).trim().slice(0, 260);
    if (cleanBio) {
      const safety = checkContentSafety(cleanBio, { allowContactInfo: false });
      if (!safety.safe) {
        res.status(400).json({ error: safety.reason });
        return;
      }
    }
    db.prepare(`UPDATE profiles SET bio = ?, updated_at = datetime('now') WHERE user_id = ?`).run(
      cleanBio,
      userId
    );
  }

  if (avatar !== undefined) {
    const safe = sanitizeMediaUrl(String(avatar));
    if (!safe) {
      res.status(400).json({ error: 'رابط الصورة غير صالح.' });
      return;
    }
    db.prepare(`UPDATE profiles SET avatar = ?, updated_at = datetime('now') WHERE user_id = ?`).run(
      safe,
      userId
    );
  }

  if (Array.isArray(interests)) {
    const clean = interests.filter((i): i is string => typeof i === 'string').slice(0, 12);
    db.prepare(
      `UPDATE profiles SET interests_json = ?, updated_at = datetime('now') WHERE user_id = ?`
    ).run(JSON.stringify(clean), userId);
  }

  res.json({ user: buildUserPayload(userId) });
});

authRouter.patch('/account/privacy', requireAuth, (req, res) => {
  const userId = req.user!.id;
  const {
    privacyLevel,
    showActivity,
    allowMessagesFrom,
    allowCommentsFrom,
    showPostsTo,
    allowAnonMentions,
    notifyPrefs,
  } = req.body ?? {};

  const allowedPrivacy = new Set(['public', 'friends', 'limited']);
  const allowedMsg = new Set(['everyone', 'friends', 'none']);
  const allowedPosts = new Set(['everyone', 'friends', 'only_me']);

  const current = db
    .prepare(
      `SELECT privacy_level, show_activity, allow_messages_from, allow_comments_from,
              show_posts_to, allow_anon_mentions, notify_prefs_json
       FROM profiles WHERE user_id = ?`
    )
    .get(userId) as {
    privacy_level: string;
    show_activity: number;
    allow_messages_from: string;
    allow_comments_from: string;
    show_posts_to: string;
    allow_anon_mentions: number;
    notify_prefs_json: string;
  };

  const nextPrivacy = allowedPrivacy.has(privacyLevel) ? privacyLevel : current.privacy_level;
  const nextShowActivity =
    typeof showActivity === 'boolean' ? (showActivity ? 1 : 0) : current.show_activity;
  const nextAllowMsg = allowedMsg.has(allowMessagesFrom)
    ? allowMessagesFrom
    : current.allow_messages_from;
  const nextAllowComments = allowedMsg.has(allowCommentsFrom)
    ? allowCommentsFrom
    : current.allow_comments_from;
  const nextShowPosts = allowedPosts.has(showPostsTo) ? showPostsTo : current.show_posts_to;
  const nextAnonMentions =
    typeof allowAnonMentions === 'boolean'
      ? allowAnonMentions
        ? 1
        : 0
      : current.allow_anon_mentions;
  const allowedNotifyKeys = new Set([
    'messages',
    'comments',
    'reactions',
    'friends',
    'communities',
    'challenges',
    'daily',
    'instantAlerts',
    'friendsOnlyInstantAlerts',
  ]);
  let nextNotifyJson = current.notify_prefs_json;
  if (notifyPrefs && typeof notifyPrefs === 'object') {
    const cleanPrefs: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(notifyPrefs as Record<string, unknown>)) {
      if (allowedNotifyKeys.has(k) && typeof v === 'boolean') {
        cleanPrefs[k] = v;
      }
    }
    nextNotifyJson = JSON.stringify(cleanPrefs);
  }

  db.prepare(
    `UPDATE profiles
     SET privacy_level = ?, show_activity = ?, allow_messages_from = ?,
         allow_comments_from = ?, show_posts_to = ?, allow_anon_mentions = ?,
         notify_prefs_json = ?, updated_at = datetime('now')
     WHERE user_id = ?`
  ).run(
    nextPrivacy,
    nextShowActivity,
    nextAllowMsg,
    nextAllowComments,
    nextShowPosts,
    nextAnonMentions,
    nextNotifyJson,
    userId
  );

  res.json({ user: buildUserPayload(userId) });
});

authRouter.post('/account/password', requireAuth, (req, res) => {
  const userId = req.user!.id;
  const { currentPassword, newPassword, confirmPassword } = req.body ?? {};

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as {
    password_hash: string;
  };
  if (!verifyPassword(String(currentPassword || ''), row.password_hash)) {
    res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
    return;
  }

  const check = validatePassword(String(newPassword || ''));
  if (!check.valid) {
    res.status(400).json({ error: check.error });
    return;
  }
  if (newPassword !== confirmPassword) {
    res.status(400).json({ error: 'كلمتا المرور غير متطابقتين.' });
    return;
  }

  db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(
    hashPassword(String(newPassword)),
    userId
  );

  res.json({ ok: true, message: 'تم تغيير كلمة المرور بنجاح.' });
});

authRouter.post('/account/logout-all', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user!.id);
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

authRouter.delete('/account', requireAuth, (req, res) => {
  const { password } = req.body ?? {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as {
    password_hash: string;
  };
  if (!verifyPassword(String(password || ''), row.password_hash)) {
    res.status(401).json({ error: 'كلمة المرور غير صحيحة لتأكيد حذف الحساب.' });
    return;
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user!.id);
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

// Safe image & voice-note upload endpoint
authRouter.post('/upload', requireAuth, rateLimit('upload', 20, 60000), (req, res) => {
  const { dataUrl } = req.body ?? {};
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    res.status(400).json({ error: 'صيغة الملف غير مدعومة.' });
    return;
  }

  const match = dataUrl.match(
    /^data:(image\/png|image\/jpeg|image\/webp|audio\/webm|audio\/ogg|audio\/mp4);base64,([A-Za-z0-9+/=]+)$/
  );
  if (!match) {
    res.status(400).json({ error: 'يسمح برفع صور PNG/JPEG/WEBP أو مقاطع صوتية قصيرة فقط.' });
    return;
  }

  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 3.5 * 1024 * 1024) {
    res.status(400).json({ error: 'حجم الملف يتجاوز الحد المسموح (3.5 ميجابايت).' });
    return;
  }

  // Magic byte validation for images
  if (mime === 'image/png') {
    if (buffer.length < 8 || buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
      res.status(400).json({ error: 'ملف PNG تالف أو غير صحيح.' });
      return;
    }
  } else if (mime === 'image/jpeg') {
    if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      res.status(400).json({ error: 'ملف JPEG تالف أو غير صحيح.' });
      return;
    }
  } else if (mime === 'image/webp') {
    if (buffer.length < 12 || buffer.subarray(0, 4).toString() !== 'RIFF' || buffer.subarray(8, 12).toString() !== 'WEBP') {
      res.status(400).json({ error: 'ملف WEBP تالف أو غير صحيح.' });
      return;
    }
  }

  const extMap: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
  };
  const fileName = `${crypto.randomUUID()}.${extMap[mime]}`;
  const targetPath = path.resolve(uploadsDir, fileName);
  if (!targetPath.startsWith(uploadsDir + path.sep)) {
    res.status(400).json({ error: 'مسار غير صالح.' });
    return;
  }

  fs.writeFileSync(targetPath, buffer);
  res.json({ url: `/uploads/${fileName}` });
});

import { Router } from 'express';
import crypto from 'node:crypto';
import { db, DEFAULT_NOTIFICATION_SETTINGS, getSetting, setSetting } from '../db.ts';
import {
  createSession,
  hashPassword,
  requireAdmin,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from '../auth.ts';
import { broadcastToAll, getOnlineUsersCount, pushNotification } from '../realtime.ts';
import { checkContentSafety, checkMinimumAge, validateEmail, validatePassword, validateUsername } from '../../src/lib/validation.ts';

export const adminRouter = Router();

const DESIGNATED_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '')
  .trim()
  .toLowerCase();

// Admin status & first-run bootstrap eligibility
adminRouter.get('/admin/status', (req, res) => {
  const envPasscodeSet = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim());
  const adminCountRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'`)
    .get() as { cnt: number };
  const hasAdmin = Number(adminCountRow?.cnt ?? 0) > 0;
  const userEmail = req.user?.email ? req.user.email.trim().toLowerCase() : null;
  const isDesignatedEmail = Boolean(userEmail && userEmail === DESIGNATED_ADMIN_EMAIL);

  const requesterIsAdmin = req.user?.role === 'admin' || req.user?.role === 'moderator';
  res.json({
    hasAdmin,
    envPasscodeConfigured: envPasscodeSet,
    adminEmailConfigured: Boolean(DESIGNATED_ADMIN_EMAIL),
    canBootstrap: !hasAdmin,
    // Only reveal the designated admin email while bootstrap is still open,
    // or to an already-authenticated admin. Otherwise keep it private.
    designatedAdminEmail: !hasAdmin || requesterIsAdmin ? DESIGNATED_ADMIN_EMAIL : undefined,
    canPromoteCurrentUser: isDesignatedEmail,
    isAdmin: requesterIsAdmin,
    isPrimaryAdmin: req.user?.role === 'admin',
    isDesignatedAdmin: req.user?.role === 'admin' && isDesignatedEmail,
  });
});

// First-run Admin Setup / Claim (locked strictly to designated admin email & locked once claimed)
adminRouter.post('/admin/bootstrap', (req, res) => {
  const adminCountRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'`)
    .get() as { cnt: number };
  if (Number(adminCountRow?.cnt ?? 0) > 0) {
    res.status(403).json({ error: 'تم إعداد حساب الإدارة بالفعل.' });
    return;
  }

  if (!DESIGNATED_ADMIN_EMAIL) {
    res.status(503).json({
      error:
        'لم يتم ضبط البريد الإداري (ADMIN_EMAIL) في إعدادات الخادم. أضفه إلى ملف .env ثم أعد تشغيل الخادم.',
    });
    return;
  }

  // If caller is logged in, ONLY allow designated admin email after verifying their account password
  if (req.user) {
    const callerEmail = req.user.email?.trim().toLowerCase();
    if (!callerEmail || callerEmail !== DESIGNATED_ADMIN_EMAIL) {
      res.status(403).json({
        error: `صلاحية الإدارة الأولى مخصصة للبريد الإداري المعتمد (${DESIGNATED_ADMIN_EMAIL}) فقط.`,
      });
      return;
    }
    const suppliedPassword = String(req.body?.password || '');
    const userRow = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id) as
      | { password_hash: string }
      | undefined;
    if (!userRow || !suppliedPassword || !verifyPassword(suppliedPassword, userRow.password_hash)) {
      res.status(401).json({ error: 'يرجى إدخال كلمة المرور الصحيحة لحسابك لتفعيل صلاحيات الإدارة.' });
      return;
    }
    db.prepare(`UPDATE users SET role = 'admin', updated_at = datetime('now') WHERE id = ?`).run(
      req.user.id
    );
    res.json({ ok: true, promoted: true });
    return;
  }

  // Otherwise create the first admin account (email must match DESIGNATED_ADMIN_EMAIL)
  const { displayName, username, email, password, confirmPassword, birthDate } = req.body ?? {};
  const cleanEmail = String(email || DESIGNATED_ADMIN_EMAIL).trim().toLowerCase();
  if (!validateEmail(cleanEmail) || cleanEmail !== DESIGNATED_ADMIN_EMAIL) {
    res.status(403).json({
      error: `البريد الإلكتروني للإدارة يجب أن يكون ${DESIGNATED_ADMIN_EMAIL}.`,
    });
    return;
  }

  const existingByEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail) as
    | { id: number }
    | undefined;
  if (existingByEmail) {
    res.status(409).json({
      error: 'هذا البريد مسجل بالفعل. سجّل الدخول أولًا ثم فعّل صلاحيات الإدارة من بوابة الإدارة.',
    });
    return;
  }

  const userCheck = validateUsername(String(username || ''));
  if (!userCheck.valid) {
    res.status(400).json({ error: userCheck.error });
    return;
  }
  const dupUser = db.prepare('SELECT id FROM users WHERE username = ?').get(userCheck.value);
  if (dupUser) {
    res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل، اختر اسمًا آخر.' });
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
  const ageCheck = checkMinimumAge(String(birthDate || '2000-01-01'), 18);
  if (!ageCheck.valid) {
    res.status(400).json({ error: 'حساب الإدارة يتطلب عمر 18 سنة على الأقل.' });
    return;
  }

  const recoveryCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  const insert = db
    .prepare(
      `INSERT INTO users (username, email, password_hash, recovery_code_hash, role, status, birth_date)
       VALUES (?, ?, ?, ?, 'admin', 'active', ?)`
    )
    .run(
      userCheck.value,
      cleanEmail,
      hashPassword(String(password)),
      hashPassword(recoveryCode),
      String(birthDate || '2000-01-01')
    );

  const userId = Number(insert.lastInsertRowid);
  db.prepare(
    `INSERT INTO profiles (user_id, display_name, bio) VALUES (?, ?, 'إدارة منصة مين؟ MEEN')`
  ).run(userId, String(displayName || 'مدير مين؟').trim());

  const session = createSession(userId, true, req.headers['user-agent'] || '');
  setSessionCookie(res, req, session.token, session.expiresAt, true);

  res.status(201).json({ ok: true, token: session.token, recoveryCode });
});

// Verify ADMIN_PASSCODE from environment if configured (strictly restricted to DESIGNATED_ADMIN_EMAIL)
adminRouter.post('/admin/verify-passcode', requireAuth, (req, res) => {
  const callerEmail = req.user?.email ? req.user.email.trim().toLowerCase() : '';
  if (callerEmail !== DESIGNATED_ADMIN_EMAIL) {
    res.status(403).json({
      error: `صلاحية الإدارة حصرية للبريد المعتمد (${DESIGNATED_ADMIN_EMAIL}).`,
    });
    return;
  }
  const envPasscode = process.env.ADMIN_PASSCODE?.trim();
  if (!envPasscode) {
    res.status(400).json({ error: 'لم يتم تعيين ADMIN_PASSCODE على السيرفر.' });
    return;
  }
  const supplied = String(req.body?.passcode || '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(envPasscode);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(403).json({ error: 'رمز الإدارة غير صحيح.' });
    return;
  }

  db.prepare(`UPDATE users SET role = 'admin', updated_at = datetime('now') WHERE id = ?`).run(
    req.user!.id
  );
  res.json({ ok: true });
});

// All endpoints below enforce server-side admin RBAC
adminRouter.get('/admin/overview', requireAdmin, (_req, res) => {
  const totalUsers = (db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number }).cnt;
  const newUsersToday = (
    db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE date(created_at) = date('now')`).get() as {
      cnt: number;
    }
  ).cnt;
  const totalPosts = (db.prepare('SELECT COUNT(*) AS cnt FROM posts').get() as { cnt: number }).cnt;
  const totalComments = (db.prepare('SELECT COUNT(*) AS cnt FROM comments').get() as { cnt: number }).cnt;
  const totalCommunities = (
    db.prepare('SELECT COUNT(*) AS cnt FROM communities').get() as { cnt: number }
  ).cnt;
  const openReports = (
    db.prepare(`SELECT COUNT(*) AS cnt FROM reports WHERE status = 'open'`).get() as { cnt: number }
  ).cnt;
  const openSupport = (
    db.prepare(`SELECT COUNT(*) AS cnt FROM support_requests WHERE status != 'resolved'`).get() as {
      cnt: number;
    }
  ).cnt;

  const recentActions = db
    .prepare(
      `SELECT ma.*, u.username AS moderator_username
       FROM moderation_actions ma JOIN users u ON u.id = ma.moderator_id
       ORDER BY ma.created_at DESC LIMIT 20`
    )
    .all();

  res.json({
    stats: {
      totalUsers,
      newUsersToday,
      onlineUsers: getOnlineUsersCount(),
      totalPosts,
      totalComments,
      totalCommunities,
      openReports,
      openSupport,
    },
    recentActions,
  });
});

adminRouter.get('/admin/users', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.phone, u.role, u.status, u.created_at, u.last_active_at,
              p.display_name, p.avatar,
              (SELECT COUNT(*) FROM posts po WHERE po.author_id = u.id) AS posts_count,
              (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'user' AND r.target_id = u.id) AS reports_count
       FROM users u JOIN profiles p ON p.user_id = u.id
       ${q ? 'WHERE LOWER(u.username) LIKE ? OR LOWER(p.display_name) LIKE ? OR LOWER(COALESCE(u.email, "")) LIKE ?' : ''}
       ORDER BY u.created_at DESC LIMIT 80`
    )
    .all(...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []));

  res.json({ users: rows });
});

adminRouter.post('/admin/users/:id/action', requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  const { action, reason = '' } = req.body ?? {};
  const adminId = req.user!.id;

  if (targetId === adminId && (action === 'ban' || action === 'delete' || action === 'suspend')) {
    res.status(400).json({ error: 'لا يمكنك إيقاف أو حذف حسابك الإداري من هنا.' });
    return;
  }

  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(targetId) as
    | { id: number; role: string }
    | undefined;
  if (!target) {
    res.status(404).json({ error: 'المستخدم غير موجود.' });
    return;
  }

  if (action === 'suspend') {
    db.prepare(`UPDATE users SET status = 'suspended', updated_at = datetime('now') WHERE id = ?`).run(
      targetId
    );
  } else if (action === 'ban') {
    db.prepare(`UPDATE users SET status = 'banned', updated_at = datetime('now') WHERE id = ?`).run(
      targetId
    );
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
  } else if (action === 'activate') {
    db.prepare(`UPDATE users SET status = 'active', updated_at = datetime('now') WHERE id = ?`).run(
      targetId
    );
  } else if (action === 'make_moderator' || action === 'make_admin' || action === 'demote') {
    if (req.user!.role !== 'admin') {
      res.status(403).json({ error: 'تعديل الأدوار متاح للمدير العام فقط.' });
      return;
    }
    if (targetId === adminId) {
      res.status(400).json({ error: 'لا يمكنك تعديل دورك الإداري من هنا.' });
      return;
    }
    const nextRole =
      action === 'make_admin' ? 'admin' : action === 'make_moderator' ? 'moderator' : 'user';
    db.prepare(`UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?`).run(
      nextRole,
      targetId
    );
    pushNotification({
      userId: targetId,
      type: 'admin_announcement',
      title: 'تحديث صلاحيات الحساب',
      body:
        nextRole === 'admin'
          ? 'تمت ترقية حسابك إلى مدير في منصة مين؟.'
          : nextRole === 'moderator'
            ? 'تمت ترقية حسابك إلى مشرف في منصة مين؟.'
            : 'تم تعديل دور حسابك إلى عضو عادي.',
      actorId: null,
    });
  } else if (action === 'warn') {
    pushNotification({
      userId: targetId,
      type: 'admin_announcement',
      title: 'تنبيه من إدارة مين؟',
      body: reason ? String(reason) : 'يرجى الالتزام بقواعد المجتمع وتجنب المخالفات.',
      actorId: null,
    });
  } else if (action === 'delete') {
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  } else {
    res.status(400).json({ error: 'إجراء غير صالح.' });
    return;
  }

  db.prepare(
    `INSERT INTO moderation_actions (moderator_id, action_type, target_type, target_id, reason)
     VALUES (?, ?, 'user', ?, ?)`
  ).run(adminId, String(action), targetId, String(reason).slice(0, 300));

  res.json({ ok: true });
});

adminRouter.get('/admin/content', requireAdmin, (_req, res) => {
  const posts = db
    .prepare(
      `SELECT p.id, p.type, p.category, p.content, p.is_anonymous, p.is_hidden, p.created_at,
              u.username, pr.display_name
       FROM posts p JOIN users u ON u.id = p.author_id JOIN profiles pr ON pr.user_id = p.author_id
       ORDER BY p.id DESC LIMIT 60`
    )
    .all();

  const comments = db
    .prepare(
      `SELECT c.id, c.post_id, c.content, c.is_anonymous, c.is_hidden, c.created_at, u.username
       FROM comments c JOIN users u ON u.id = c.author_id
       ORDER BY c.id DESC LIMIT 40`
    )
    .all();

  const communities = db
    .prepare('SELECT id, name, category, privacy, is_hidden, created_at FROM communities ORDER BY id DESC LIMIT 40')
    .all();

  res.json({ posts, comments, communities });
});

adminRouter.post('/admin/content/:type/:id/moderate', requireAdmin, (req, res) => {
  const { type, id } = req.params;
  const targetId = Number(id);
  const { action = 'hide', reason = '' } = req.body ?? {};
  const adminId = req.user!.id;

  const tableMap: Record<string, string> = {
    post: 'posts',
    comment: 'comments',
    community: 'communities',
  };
  const table = tableMap[type];
  if (!table) {
    res.status(400).json({ error: 'نوع المحتوى غير صالح.' });
    return;
  }

  if (action === 'delete') {
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(targetId);
  } else if (action === 'unhide') {
    db.prepare(`UPDATE ${table} SET is_hidden = 0 WHERE id = ?`).run(targetId);
  } else {
    db.prepare(`UPDATE ${table} SET is_hidden = 1 WHERE id = ?`).run(targetId);
  }

  db.prepare(
    `INSERT INTO moderation_actions (moderator_id, action_type, target_type, target_id, reason)
     VALUES (?, ?, ?, ?, ?)`
  ).run(adminId, String(action), type, targetId, String(reason).slice(0, 300));

  res.json({ ok: true });
});

adminRouter.get('/admin/reports', requireAdmin, (_req, res) => {
  const reports = db
    .prepare(
      `SELECT r.*, u.username AS reporter_username
       FROM reports r JOIN users u ON u.id = r.reporter_id
       ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 80`
    )
    .all();
  res.json({ reports });
});

adminRouter.post('/admin/reports/:id/resolve', requireAdmin, (req, res) => {
  const reportId = Number(req.params.id);
  const { decision = 'accepted', resolutionNote = '', hideTarget = false } = req.body ?? {};
  const adminId = req.user!.id;

  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId) as
    | { id: number; target_type: string; target_id: number }
    | undefined;
  if (!report) {
    res.status(404).json({ error: 'البلاغ غير موجود.' });
    return;
  }

  const nextStatus = decision === 'rejected' ? 'rejected' : 'accepted';
  db.prepare(
    `UPDATE reports SET status = ?, reviewed_by = ?, resolution_note = ?, resolved_at = datetime('now') WHERE id = ?`
  ).run(nextStatus, adminId, String(resolutionNote).slice(0, 400), reportId);

  if (nextStatus === 'accepted' && hideTarget) {
    if (report.target_type === 'post') {
      db.prepare('UPDATE posts SET is_hidden = 1 WHERE id = ?').run(report.target_id);
    } else if (report.target_type === 'comment') {
      db.prepare('UPDATE comments SET is_hidden = 1 WHERE id = ?').run(report.target_id);
    } else if (report.target_type === 'community') {
      db.prepare('UPDATE communities SET is_hidden = 1 WHERE id = ?').run(report.target_id);
    } else if (report.target_type === 'user') {
      db.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(report.target_id);
    }
  }

  db.prepare(
    `INSERT INTO moderation_actions (moderator_id, action_type, target_type, target_id, reason)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    adminId,
    `report_${nextStatus}`,
    report.target_type,
    report.target_id,
    String(resolutionNote).slice(0, 300)
  );

  res.json({ ok: true });
});

adminRouter.get('/admin/support', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT sr.*, u.username
       FROM support_requests sr LEFT JOIN users u ON u.id = sr.user_id
       ORDER BY CASE sr.status WHEN 'open' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END, sr.created_at DESC`
    )
    .all();
  res.json({ requests: rows });
});

adminRouter.post('/admin/support/:id/resolve', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status = 'resolved', adminReply = '' } = req.body ?? {};
  db.prepare('UPDATE support_requests SET status = ?, admin_reply = ? WHERE id = ?').run(
    status === 'in_review' ? 'in_review' : 'resolved',
    String(adminReply).slice(0, 800),
    id
  );
  res.json({ ok: true });
});

adminRouter.post('/admin/daily-question', requireAdmin, (req, res) => {
  const { questionText } = req.body ?? {};
  const clean = String(questionText || '').trim();
  if (clean.length < 5) {
    res.status(400).json({ error: 'يرجى كتابة نص سؤال اليوم.' });
    return;
  }

  db.prepare('UPDATE daily_questions SET is_active = 0').run();
  const dateKey = new Date().toISOString().slice(0, 10);
  const insert = db
    .prepare(
      `INSERT INTO daily_questions (question_text, date_key, is_active, created_by)
       VALUES (?, ?, 1, ?)`
    )
    .run(clean.slice(0, 400), dateKey, req.user!.id);

  res.status(201).json({ id: Number(insert.lastInsertRowid), ok: true });
});

adminRouter.post('/admin/challenges', requireAdmin, (req, res) => {
  const { title, description, category = 'عام', pointsReward = 20, durationDays = 7 } = req.body ?? {};
  if (!String(title || '').trim() || !String(description || '').trim()) {
    res.status(400).json({ error: 'العنوان والوصف مطلوبان للتحدي.' });
    return;
  }
  const endsAt = new Date(Date.now() + Math.max(1, Number(durationDays)) * 86400 * 1000).toISOString();
  const insert = db
    .prepare(
      `INSERT INTO challenges (title, description, category, points_reward, ends_at, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`
    )
    .run(
      String(title).trim().slice(0, 120),
      String(description).trim().slice(0, 500),
      String(category).trim(),
      Math.min(100, Math.max(5, Number(pointsReward))),
      endsAt,
      req.user!.id
    );
  res.status(201).json({ id: Number(insert.lastInsertRowid), ok: true });
});

adminRouter.patch('/admin/challenges/:id', requireAdmin, (req, res) => {
  const status = req.body?.status === 'ended' ? 'ended' : 'active';
  db.prepare('UPDATE challenges SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  res.json({ ok: true });
});

adminRouter.patch('/admin/settings', requireAdmin, (req, res) => {
  const { categories, announcement, termsText, privacyText, monetization } = req.body ?? {};
  if (Array.isArray(categories)) {
    setSetting(
      'categories',
      categories.map((c) => String(c).trim()).filter(Boolean)
    );
  }
  if (typeof announcement === 'string') {
    setSetting('announcement', announcement.trim());
  }
  if (typeof termsText === 'string') {
    setSetting('terms_text', termsText.trim());
  }
  if (typeof privacyText === 'string') {
    setSetting('privacy_text', privacyText.trim());
  }
  if (monetization && typeof monetization === 'object') {
    setSetting('monetization', monetization);
  }
  res.json({
    ok: true,
    appConfig: {
      categories: getSetting('categories', []),
      announcement: getSetting('announcement', ''),
      termsText: getSetting('terms_text', ''),
      privacyText: getSetting('privacy_text', ''),
      monetization: getSetting('monetization', {}),
      notificationSettings: getSetting('notification_settings', DEFAULT_NOTIFICATION_SETTINGS),
    },
  });
});

// Platform-wide Global Notification Settings (strictly restricted to DESIGNATED_ADMIN_EMAIL)
adminRouter.patch('/admin/notification-settings', requireAdmin, (req, res) => {
  const callerEmail = req.user?.email ? req.user.email.trim().toLowerCase() : '';
  if (req.user!.role !== 'admin' || callerEmail !== DESIGNATED_ADMIN_EMAIL) {
    res.status(403).json({
      error: `إدارة إعدادات الإشعارات العامة للمنصة مخصصة لمدير النظام المحدد (${DESIGNATED_ADMIN_EMAIL}) فقط.`,
    });
    return;
  }

  const current = getSetting('notification_settings', DEFAULT_NOTIFICATION_SETTINGS);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const allowedKeys = Object.keys(DEFAULT_NOTIFICATION_SETTINGS) as Array<
    keyof typeof DEFAULT_NOTIFICATION_SETTINGS
  >;
  const updated = { ...DEFAULT_NOTIFICATION_SETTINGS, ...current };
  for (const key of allowedKeys) {
    if (typeof body[key] === 'boolean') {
      updated[key] = body[key] as boolean;
    }
  }

  setSetting('notification_settings', updated);
  db.prepare(
    `INSERT INTO moderation_actions (moderator_id, action_type, target_type, target_id, reason)
     VALUES (?, 'update_global_notifications', 'app', 0, ?)`
  ).run(
    req.user!.id,
    `instantAlertsEnabled=${updated.instantAlertsEnabled}, quietMode=${updated.quietModeEnabled}`
  );

  // Push live policy update to all connected clients immediately
  broadcastToAll({
    type: 'app:notification_settings_updated',
    notificationSettings: updated,
  });

  res.json({ ok: true, notificationSettings: updated });
});

// Live broadcast notification from Admin to all active members
adminRouter.post('/admin/broadcast', requireAdmin, (req, res) => {
  const title = String(req.body?.title || 'تنبيه من إدارة مين؟').trim().slice(0, 80);
  const message = String(req.body?.message || '').trim();
  const safety = checkContentSafety(message);
  if (!safety.safe || message.length > 400) {
    res.status(400).json({ error: safety.safe ? 'الرسالة طويلة جدًا.' : safety.reason });
    return;
  }

  const users = db
    .prepare(`SELECT id FROM users WHERE status = 'active' AND id != ?`)
    .all(req.user!.id) as Array<{ id: number }>;

  for (const u of users) {
    pushNotification({
      userId: u.id,
      type: 'admin_announcement',
      title,
      body: message,
      targetType: 'home',
      actorId: null,
    });
  }

  db.prepare(
    `INSERT INTO moderation_actions (moderator_id, action_type, target_type, target_id, reason)
     VALUES (?, 'broadcast', 'app', 0, ?)`
  ).run(req.user!.id, `${title}: ${message}`.slice(0, 280));

  res.json({ ok: true, sentCount: users.length });
});

import { Router } from 'express';
import { auth, ADMIN_EMAIL } from '../admin.ts';
import { all, get, insert, nowIso, patch, remove, where } from '../store.ts';
import { rateLimit, requireAdminOnly, requireStaff } from '../middleware.ts';
import { DEFAULT_NOTIFICATION_SETTINGS, getSetting, setSetting } from '../core.ts';
import { broadcastToAll, pushNotification } from '../realtime.ts';
import { deleteUserData, purgePost } from '../cascade.ts';
import { releaseUnique } from '../store.ts';
import { syncClaims } from './authRoutes.ts';
import { checkContentSafety } from '../../../src/lib/validation.ts';

export const adminRouter = Router();
const num = (v: unknown) => Number(v);
const log = (moderatorId: number, action: string, targetType: string, targetId: number, reason: string) =>
  insert('moderation_actions', { moderator_id: moderatorId, action_type: action, target_type: targetType, target_id: targetId, reason: String(reason).slice(0, 300), created_at: nowIso() });

// There is no admin bootstrap, passcode or promotion by request any more:
// admin = the Google-verified ADMIN_EMAIL account, decided on the server.
adminRouter.get('/admin/status', async (req, res) => {
  const u = req.user;
  res.json({
    adminEmailConfigured: Boolean(ADMIN_EMAIL),
    isAdmin: u?.role === 'admin' || u?.role === 'moderator',
    isPrimaryAdmin: u?.role === 'admin',
    isDesignatedAdmin: u?.role === 'admin' && Boolean(u.email) && u.email!.toLowerCase() === ADMIN_EMAIL,
  });
});

adminRouter.get('/admin/overview', requireStaff, async (_req, res) => {
  const [users, posts, comments, communities, reports, support, actions] = await Promise.all([
    all<any>('users'), all<any>('posts'), all<any>('comments'), all<any>('communities'), all<any>('reports'), all<any>('support_requests'), all<any>('moderation_actions'),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const byId = new Map(users.map((u) => [u.id, u]));
  const recentActions = actions.sort((a, b) => b.id - a.id).slice(0, 20).map((a) => ({ ...a, moderator_username: byId.get(a.moderator_id)?.username ?? '' }));
  res.json({
    stats: {
      totalUsers: users.length,
      newUsersToday: users.filter((u) => String(u.created_at).slice(0, 10) === today).length,
      onlineUsers: users.filter((u) => Date.now() - new Date(u.last_active_at).getTime() < 120000).length,
      totalPosts: posts.length, totalComments: comments.length, totalCommunities: communities.length,
      openReports: reports.filter((r) => r.status === 'open').length,
      openSupport: support.filter((r) => r.status !== 'resolved').length,
    },
    recentActions,
  });
});

adminRouter.get('/admin/users', requireStaff, async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const [users, posts, reports] = await Promise.all([all<any>('users'), all<any>('posts'), all<any>('reports')]);
  const pc = new Map<number, number>(), rc = new Map<number, number>();
  posts.forEach((p) => pc.set(p.author_id, (pc.get(p.author_id) || 0) + 1));
  reports.filter((r) => r.target_type === 'user').forEach((r) => rc.set(r.target_id, (rc.get(r.target_id) || 0) + 1));
  const rows = users
    .filter((u) => !q || [u.username, u.display_name, u.email || ''].some((x) => String(x).toLowerCase().includes(q)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 80)
    .map((u) => ({ id: u.id, username: u.username, email: u.email ?? null, phone: u.phone ?? null, role: u.role, status: u.status, created_at: u.created_at, last_active_at: u.last_active_at, display_name: u.display_name, avatar: u.avatar, posts_count: pc.get(u.id) || 0, reports_count: rc.get(u.id) || 0 }));
  res.json({ users: rows });
});

adminRouter.post('/admin/users/:id/action', requireStaff, rateLimit('admin_action', 60, 60000), async (req, res) => {
  const targetId = num(req.params.id);
  const { action, reason = '' } = req.body ?? {};
  const me = req.user!;
  if (targetId === me.id && ['ban', 'delete', 'suspend', 'make_moderator', 'make_admin', 'demote'].includes(action))
    return void res.status(400).json({ error: 'لا يمكنك تعديل أو إيقاف حسابك الإداري من هنا.' });
  const target = await get<any>('users', targetId);
  if (!target) return void res.status(404).json({ error: 'المستخدم غير موجود.' });
  if (me.role !== 'admin' && (target.role === 'admin' || target.role === 'moderator'))
    return void res.status(403).json({ error: 'لا يمكن للمشرف تعديل حساب مدير أو مشرف آخر.' });
  const designated = Boolean(ADMIN_EMAIL) && String(target.email || '').toLowerCase() === ADMIN_EMAIL;
  if (designated && ['ban', 'delete', 'suspend', 'demote', 'make_moderator'].includes(action))
    return void res.status(403).json({ error: 'حساب مدير النظام الرئيسي محمي من هذا الإجراء.' });

  if (action === 'suspend') await patch('users', targetId, { status: 'suspended', updated_at: nowIso() });
  else if (action === 'ban') {
    await patch('users', targetId, { status: 'banned', updated_at: nowIso() });
    await auth.revokeRefreshTokens(target.uid).catch(() => {});
  } else if (action === 'activate') await patch('users', targetId, { status: 'active', updated_at: nowIso() });
  else if (action === 'make_moderator' || action === 'make_admin' || action === 'demote') {
    if (me.role !== 'admin') return void res.status(403).json({ error: 'تعديل الأدوار متاح للمدير العام فقط.' });
    // Only the designated, verified ADMIN_EMAIL may ever hold the admin role.
    if (action === 'make_admin') return void res.status(403).json({ error: 'دور المدير العام مخصص لحساب ADMIN_EMAIL فقط ولا يمكن منحه من هنا.' });
    const nextRole = action === 'make_moderator' ? 'moderator' : 'user';
    await patch('users', targetId, { role: nextRole, updated_at: nowIso() });
    await syncClaims(target.uid, nextRole);
    await auth.revokeRefreshTokens(target.uid).catch(() => {});
    await pushNotification({ userId: targetId, type: 'admin_announcement', title: 'تحديث صلاحيات الحساب', body: nextRole === 'moderator' ? 'تمت ترقية حسابك إلى مشرف في منصة مين؟.' : 'تم تعديل دور حسابك إلى عضو عادي.', actorId: null });
  } else if (action === 'warn') {
    await pushNotification({ userId: targetId, type: 'admin_announcement', title: 'تنبيه من إدارة مين؟', body: reason ? String(reason) : 'يرجى الالتزام بقواعد المجتمع وتجنب المخالفات.', actorId: null });
  } else if (action === 'delete') {
    await deleteUserData(targetId);
    await releaseUnique('username', target.username);
    if (target.email) await releaseUnique('email', target.email);
    if (target.phone) await releaseUnique('phone', target.phone);
    await releaseUnique('uid', target.uid);
    await remove('users', targetId);
    await auth.deleteUser(target.uid).catch(() => {});
  } else return void res.status(400).json({ error: 'إجراء غير صالح.' });
  await log(me.id, String(action), 'user', targetId, reason);
  res.json({ ok: true });
});

adminRouter.get('/admin/content', requireStaff, async (_req, res) => {
  const [posts, comments, communities, users] = await Promise.all([all<any>('posts'), all<any>('comments'), all<any>('communities'), all<any>('users')]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const desc = (a: any, b: any) => b.id - a.id;
  res.json({
    posts: posts.sort(desc).slice(0, 60).map((p) => ({ id: p.id, type: p.type, category: p.category, content: p.content, is_anonymous: p.is_anonymous, is_hidden: p.is_hidden, created_at: p.created_at, username: byId.get(p.author_id)?.username ?? '', display_name: byId.get(p.author_id)?.display_name ?? '' })),
    comments: comments.sort(desc).slice(0, 40).map((c) => ({ id: c.id, post_id: c.post_id, content: c.content, is_anonymous: c.is_anonymous, is_hidden: c.is_hidden, created_at: c.created_at, username: byId.get(c.author_id)?.username ?? '' })),
    communities: communities.sort(desc).slice(0, 40).map((c) => ({ id: c.id, name: c.name, category: c.category, privacy: c.privacy, is_hidden: c.is_hidden, created_at: c.created_at })),
  });
});

async function setHidden(type: string, id: number, hidden: 0 | 1) {
  const table = type === 'post' ? 'posts' : type === 'comment' ? 'comments' : 'communities';
  if (await get(table, id)) await patch(table, id, { is_hidden: hidden });
}

adminRouter.post('/admin/content/:type/:id/moderate', requireStaff, async (req, res) => {
  const { type } = req.params;
  const id = num(req.params.id);
  const { action = 'hide', reason = '' } = req.body ?? {};
  if (!['post', 'comment', 'community'].includes(type)) return void res.status(400).json({ error: 'نوع المحتوى غير صالح.' });
  const table = type === 'post' ? 'posts' : type === 'comment' ? 'comments' : 'communities';
  const row = await get<any>(table, id);
  if (!row) return void res.status(404).json({ error: 'المحتوى غير موجود.' });
  if (action === 'delete') {
    if (type === 'post') await purgePost(id);
    else if (type === 'comment') {
      for (const r of await where<any>('comment_replies', 'comment_id', id)) await remove('comment_replies', r.id);
      await remove('comments', id);
      const p = await get<any>('posts', row.post_id);
      if (p) await patch('posts', p.id, { comments_count: Math.max(0, (p.comments_count || 0) - 1) });
    } else {
      for (const p of await where<any>('posts', 'community_id', id)) await purgePost(p.id);
      for (const m of await where<any>('community_members', 'community_id', id)) await remove('community_members', m.key ?? m.id);
      await remove('communities', id);
    }
  } else await setHidden(type, id, action === 'unhide' ? 0 : 1);
  await log(req.user!.id, String(action), type, id, reason);
  res.json({ ok: true });
});

adminRouter.get('/admin/reports', requireStaff, async (_req, res) => {
  const [reports, users] = await Promise.all([all<any>('reports'), all<any>('users')]);
  const byId = new Map(users.map((u) => [u.id, u]));
  res.json({
    reports: reports.sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open') || String(b.created_at).localeCompare(String(a.created_at))).slice(0, 80)
      .map((r) => ({ ...r, reporter_username: byId.get(r.reporter_id)?.username ?? '' })),
  });
});

adminRouter.post('/admin/reports/:id/resolve', requireStaff, async (req, res) => {
  const id = num(req.params.id);
  const { decision = 'accepted', resolutionNote = '', hideTarget = false } = req.body ?? {};
  const report = await get<any>('reports', id);
  if (!report) return void res.status(404).json({ error: 'البلاغ غير موجود.' });
  const next = decision === 'rejected' ? 'rejected' : 'accepted';
  await patch('reports', id, { status: next, reviewed_by: req.user!.id, resolution_note: String(resolutionNote).slice(0, 400), resolved_at: nowIso() });
  if (next === 'accepted' && hideTarget) {
    if (['post', 'comment', 'community'].includes(report.target_type)) await setHidden(report.target_type, report.target_id, 1);
    else if (report.target_type === 'user') {
      const t = await get<any>('users', report.target_id);
      // Same protection as the user action route: staff cannot suspend admins/moderators this way.
      if (t && (req.user!.role === 'admin' ? t.role !== 'admin' : t.role === 'user')) await patch('users', t.id, { status: 'suspended' });
    }
  }
  await log(req.user!.id, `report_${next}`, report.target_type, report.target_id, String(resolutionNote));
  res.json({ ok: true });
});

adminRouter.get('/admin/support', requireStaff, async (_req, res) => {
  const [rows, users] = await Promise.all([all<any>('support_requests'), all<any>('users')]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const rank = (s: string) => (s === 'open' ? 0 : s === 'in_review' ? 1 : 2);
  res.json({ requests: rows.sort((a, b) => rank(a.status) - rank(b.status) || String(b.created_at).localeCompare(String(a.created_at))).map((r) => ({ ...r, username: byId.get(r.user_id)?.username ?? null })) });
});

adminRouter.post('/admin/support/:id/resolve', requireStaff, async (req, res) => {
  const id = num(req.params.id);
  if (!(await get('support_requests', id))) return void res.status(404).json({ error: 'الطلب غير موجود.' });
  const { status = 'resolved', adminReply = '' } = req.body ?? {};
  await patch('support_requests', id, { status: status === 'in_review' ? 'in_review' : 'resolved', admin_reply: String(adminReply).slice(0, 800) });
  res.json({ ok: true });
});

adminRouter.post('/admin/daily-question', requireStaff, requireAdminOnly, async (req, res) => {
  const clean = String(req.body?.questionText || '').trim();
  if (clean.length < 5) return void res.status(400).json({ error: 'يرجى كتابة نص سؤال اليوم.' });
  for (const q of await all<any>('daily_questions')) if (q.is_active) await patch('daily_questions', q.id, { is_active: 0 });
  const row = await insert('daily_questions', { question_text: clean.slice(0, 400), date_key: new Date().toISOString().slice(0, 10), is_active: 1, created_by: req.user!.id, created_at: nowIso() });
  res.status(201).json({ id: row.id, ok: true });
});

adminRouter.post('/admin/challenges', requireStaff, requireAdminOnly, async (req, res) => {
  const { title, description, category = 'عام', pointsReward = 20, durationDays = 7 } = req.body ?? {};
  if (!String(title || '').trim() || !String(description || '').trim()) return void res.status(400).json({ error: 'العنوان والوصف مطلوبان للتحدي.' });
  const days = Math.min(365, Math.max(1, Number(durationDays) || 7));
  const row = await insert('challenges', {
    title: String(title).trim().slice(0, 120), description: String(description).trim().slice(0, 500), category: String(category).trim(),
    points_reward: Math.min(100, Math.max(5, Number(pointsReward) || 20)), ends_at: new Date(Date.now() + days * 86400000).toISOString(),
    status: 'active', created_by: req.user!.id, created_at: nowIso(),
  });
  res.status(201).json({ id: row.id, ok: true });
});

adminRouter.patch('/admin/challenges/:id', requireStaff, requireAdminOnly, async (req, res) => {
  const id = num(req.params.id);
  if (!(await get('challenges', id))) return void res.status(404).json({ error: 'التحدي غير موجود.' });
  await patch('challenges', id, { status: req.body?.status === 'ended' ? 'ended' : 'active' });
  res.json({ ok: true });
});

async function appConfig() {
  return {
    categories: await getSetting('categories', []), announcement: await getSetting('announcement', ''),
    termsText: await getSetting('terms_text', ''), privacyText: await getSetting('privacy_text', ''),
    monetization: await getSetting('monetization', {}),
    notificationSettings: await getSetting('notification_settings', DEFAULT_NOTIFICATION_SETTINGS),
  };
}

adminRouter.patch('/admin/settings', requireStaff, requireAdminOnly, async (req, res) => {
  const { categories, announcement, termsText, privacyText, monetization } = req.body ?? {};
  if (Array.isArray(categories)) await setSetting('categories', categories.map((c) => String(c).trim()).filter(Boolean).slice(0, 50));
  if (typeof announcement === 'string') await setSetting('announcement', announcement.trim().slice(0, 500));
  if (typeof termsText === 'string') await setSetting('terms_text', termsText.trim().slice(0, 20000));
  if (typeof privacyText === 'string') await setSetting('privacy_text', privacyText.trim().slice(0, 20000));
  if (monetization && typeof monetization === 'object' && !Array.isArray(monetization)) await setSetting('monetization', monetization);
  res.json({ ok: true, appConfig: await appConfig() });
});

adminRouter.patch('/admin/notification-settings', requireStaff, requireAdminOnly, async (req, res) => {
  const email = String(req.user!.email || '').toLowerCase();
  if (!ADMIN_EMAIL || email !== ADMIN_EMAIL) return void res.status(403).json({ error: 'إدارة إعدادات الإشعارات العامة مخصصة لمدير النظام المحدد فقط.' });
  const current = await getSetting<any>('notification_settings', DEFAULT_NOTIFICATION_SETTINGS);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const updated: any = { ...DEFAULT_NOTIFICATION_SETTINGS, ...current };
  for (const key of Object.keys(DEFAULT_NOTIFICATION_SETTINGS)) if (typeof body[key] === 'boolean') updated[key] = body[key];
  await setSetting('notification_settings', updated);
  await log(req.user!.id, 'update_global_notifications', 'app', 0, `instantAlertsEnabled=${updated.instantAlertsEnabled}, quietMode=${updated.quietModeEnabled}`);
  await broadcastToAll({ type: 'app:notification_settings_updated', notificationSettings: updated });
  res.json({ ok: true, notificationSettings: updated });
});

adminRouter.post('/admin/broadcast', requireStaff, requireAdminOnly, rateLimit('broadcast', 5, 60000), async (req, res) => {
  const title = String(req.body?.title || 'تنبيه من إدارة مين؟').trim().slice(0, 80);
  const message = String(req.body?.message || '').trim();
  const safety = checkContentSafety(message);
  if (!message || !safety.safe || message.length > 400) return void res.status(400).json({ error: !message ? 'اكتب نص الرسالة.' : safety.safe ? 'الرسالة طويلة جدًا.' : safety.reason });
  const users = (await all<any>('users')).filter((u) => u.status === 'active' && u.id !== req.user!.id);
  await Promise.all(users.map((u) => pushNotification({ userId: u.id, type: 'admin_announcement', title, body: message, targetType: 'home', actorId: null })));
  await log(req.user!.id, 'broadcast', 'app', 0, `${title}: ${message}`);
  res.json({ ok: true, sentCount: users.length });
});

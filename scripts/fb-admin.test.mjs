import { createApi } from '../server/fb/app.ts';
import { check, results, client, idTokenFromCustom, googleLikeToken } from './fb-test-lib.mjs';
const server = createApi().listen(0);
const api = client(`http://127.0.0.1:${server.address().port}`);
async function mk(name) {
  const r = await api('POST', '/auth/register', { displayName: name, username: name, email: `${name}@example.com`, password: 'Passw0rd!x', confirmPassword: 'Passw0rd!x', birthDate: '2000-01-01', termsAccepted: true });
  return { id: r.body.user.id, tok: await idTokenFromCustom(r.body.customToken) };
}
const gTok = await googleLikeToken('ssakr9640@gmail.com', 'Salah');
let r = await api('POST', '/auth/complete-profile', { displayName: 'Salah', username: 'salah', birthDate: '2000-01-01', termsAccepted: true }, gTok);
const ADM = { id: r.body.user.id, tok: gTok };
check('admin created via verified google ADMIN_EMAIL', r.body.user.role === 'admin');
const U = await mk('usera'), V = await mk('userb'), M = await mk('modm');

// no access for anonymous/regular users
for (const [m, p] of [['GET', '/admin/overview'], ['GET', '/admin/users'], ['GET', '/admin/reports'], ['POST', '/admin/broadcast'], ['POST', '/admin/daily-question']]) {
  const b = m === 'GET' ? undefined : {};
  r = await api(m, p, b);
  check(`anon denied ${p}`, r.status === 401);
  r = await api(m, p, b, U.tok);
  check(`user denied ${p}`, r.status === 403);
}
// self-promotion attempts
r = await api('POST', `/admin/users/${U.id}/action`, { action: 'make_admin' }, U.tok);
check('user cannot self-promote via action', r.status === 403);
r = await api('PATCH', '/account/profile', { role: 'admin' }, U.tok);
r = await api('GET', '/admin/overview', undefined, U.tok);
check('profile role field ignored', r.status === 403);
r = await api('POST', '/admin/status', {});
r = await api('POST', '/admin/bootstrap', {}, U.tok);
check('no bootstrap route', r.status === 404);
r = await api('POST', `/admin/users/${U.id}/action`, { action: 'make_admin' }, ADM.tok);
check('even admin cannot mint another admin', r.status === 403);

r = await api('GET', '/admin/overview', undefined, ADM.tok);
check('admin overview', r.status === 200 && r.body.stats.totalUsers === 4);
r = await api('GET', '/admin/status', undefined, ADM.tok);
check('status designated', r.body.isDesignatedAdmin === true);
r = await api('GET', '/admin/users?q=usera', undefined, ADM.tok);
check('user search', r.body.users.length === 1 && r.body.users[0].username === 'usera');

// moderator
await new Promise((s) => setTimeout(s, 1500)); // token revocation has 1s granularity
r = await api('POST', `/admin/users/${M.id}/action`, { action: 'make_moderator' }, ADM.tok);
check('make moderator', r.status === 200);
r = await api('GET', '/admin/overview', undefined, M.tok);
check('old token revoked after role change', r.status === 401);
r = await api('POST', '/auth/login', { identifier: 'modm', password: 'Passw0rd!x' });
M.tok = await idTokenFromCustom(r.body.customToken);
r = await api('GET', '/admin/overview', undefined, M.tok);
check('moderator sees overview', r.status === 200);
r = await api('POST', `/admin/users/${ADM.id}/action`, { action: 'ban' }, M.tok);
check('moderator cannot act on admin', r.status === 403);
r = await api('POST', `/admin/users/${U.id}/action`, { action: 'make_moderator' }, M.tok);
check('moderator cannot change roles', r.status === 403);
r = await api('POST', '/admin/broadcast', { message: 'مرحبا' }, M.tok);
check('moderator cannot broadcast', r.status === 403);
r = await api('POST', '/admin/daily-question', { questionText: 'سؤال اليوم هنا' }, M.tok);
check('moderator cannot set daily question', r.status === 403);
r = await api('PATCH', '/admin/settings', { announcement: 'x' }, M.tok);
check('moderator cannot edit settings', r.status === 403);
r = await api('POST', `/admin/users/${ADM.id}/action`, { action: 'ban' }, ADM.tok);
check('admin cannot ban self', r.status === 400);

// content + reports
r = await api('POST', '/posts', { content: 'منشور للاختبار', category: 'فضفضة' }, U.tok);
const pid = r.body.post?.id ?? r.body.id;
check('post created', Boolean(pid), JSON.stringify(r.body));
r = await api('POST', `/posts/${pid}/comments`, { content: 'تعليق' }, V.tok);
const cid = r.body.comment?.id ?? r.body.id;
r = await api('POST', '/reports', { targetType: 'post', targetId: pid, reason: 'spam' }, V.tok);
check('report filed', r.status === 201 || r.status === 200);
r = await api('GET', '/admin/reports', undefined, M.tok);
const rep = r.body.reports[0];
check('mod sees report', r.body.reports.length === 1 && rep.reporter_username === 'userb');
r = await api('POST', `/admin/reports/${rep.id}/resolve`, { decision: 'accepted', hideTarget: true, resolutionNote: 'ok' }, M.tok);
check('resolve + hide', r.status === 200);
r = await api('GET', `/posts/${pid}`, undefined, V.tok);
check('hidden post not visible to others', r.status === 404 || r.body.post?.is_hidden || r.status === 403, String(r.status));
r = await api('GET', '/admin/content', undefined, M.tok);
check('admin content lists post hidden', r.body.posts.find((p) => p.id === pid).is_hidden === 1);
r = await api('POST', `/admin/content/post/${pid}/moderate`, { action: 'unhide' }, M.tok);
r = await api('GET', `/posts/${pid}`, undefined, V.tok);
check('unhidden visible again', r.status === 200);
r = await api('POST', `/admin/content/comment/${cid}/moderate`, { action: 'delete' }, M.tok);
check('delete comment', r.status === 200);
r = await api('POST', `/admin/content/post/${pid}/moderate`, { action: 'delete' }, M.tok);
check('delete post', r.status === 200);
r = await api('POST', `/admin/content/post/${pid}/moderate`, { action: 'delete' }, M.tok);
check('delete missing -> 404', r.status === 404);
r = await api('POST', '/admin/content/foo/1/moderate', {}, M.tok);
check('bad content type', r.status === 400);

// support
r = await api('POST', '/support', { category: 'مشكلة', subject: 'عنوان', description: 'وصف المشكلة هنا' }, U.tok);
r = await api('GET', '/admin/support', undefined, M.tok);
const sid = r.body.requests[0]?.id;
check('support listed', Boolean(sid));
r = await api('POST', `/admin/support/${sid}/resolve`, { adminReply: 'تم' }, M.tok);
r = await api('GET', '/support/mine', undefined, U.tok);
check('user sees admin reply', JSON.stringify(r.body).includes('تم'));

// admin-only config
r = await api('POST', '/admin/daily-question', { questionText: 'ما هو سؤال اليوم؟' }, ADM.tok);
check('daily question', r.status === 201);
r = await api('POST', '/admin/challenges', { title: 'تحدي', description: 'وصف التحدي', pointsReward: 30 }, ADM.tok);
check('challenge', r.status === 201);
const chId = r.body.id;
r = await api('PATCH', `/admin/challenges/${chId}`, { status: 'ended' }, ADM.tok);
check('end challenge', r.status === 200);
r = await api('PATCH', '/admin/settings', { announcement: 'إعلان', categories: ['فضفضة', 'عام'] }, ADM.tok);
check('settings', r.status === 200 && r.body.appConfig.announcement === 'إعلان');
r = await api('PATCH', '/admin/notification-settings', { instantAlertsEnabled: false }, ADM.tok);
check('notification settings (designated)', r.status === 200 && r.body.notificationSettings.instantAlertsEnabled === false);
r = await api('POST', '/admin/broadcast', { message: 'إعلان عام للجميع' }, ADM.tok);
check('broadcast', r.status === 200 && r.body.sentCount === 3);
r = await api('GET', '/notifications', undefined, V.tok);
check('broadcast received', JSON.stringify(r.body).includes('إعلان عام'));

// user actions
r = await api('POST', `/admin/users/${V.id}/action`, { action: 'suspend', reason: 'x' }, M.tok);
r = await api('POST', '/posts', { content: 'منشور' }, V.tok);
check('suspended cannot post', r.status === 403);
r = await api('POST', `/admin/users/${V.id}/action`, { action: 'activate' }, M.tok);
r = await api('POST', `/admin/users/${V.id}/action`, { action: 'ban' }, M.tok);
r = await api('GET', '/auth/me', undefined, V.tok);
check('banned token revoked', !r.body.user);
r = await api('POST', `/admin/users/${U.id}/action`, { action: 'warn', reason: 'تحذير' }, M.tok);
r = await api('GET', '/notifications', undefined, U.tok);
check('warn delivered', JSON.stringify(r.body).includes('تحذير'));
r = await api('POST', `/admin/users/${U.id}/action`, { action: 'delete' }, ADM.tok);
check('admin deletes user', r.status === 200);
r = await api('POST', '/auth/login', { identifier: 'usera', password: 'Passw0rd!x' });
check('deleted user cannot log in', r.status >= 400);
r = await api('POST', '/admin/users/999/action', { action: 'warn' }, ADM.tok);
check('unknown user 404', r.status === 404);
r = await api('GET', '/admin/overview', undefined, ADM.tok);
check('moderation actions logged', r.body.recentActions.length >= 5);

console.log(`\n${results.pass} passed, ${results.fail} failed`);
server.close();
process.exit(results.fail ? 1 : 0);

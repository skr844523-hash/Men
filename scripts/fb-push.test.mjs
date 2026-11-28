import { createApi } from '../server/fb/app.ts';
import { check, client, idTokenFromCustom, markVerified } from './fb-test-lib.mjs';
const server = createApi().listen(0);
const api = client(`http://127.0.0.1:${server.address().port}`);
async function mk(name) {
  const r = await api('POST', '/auth/register', { displayName: name, username: name, email: `${name}@example.com`, password: 'Passw0rd!x', confirmPassword: 'Passw0rd!x', birthDate: '2000-01-01', termsAccepted: true });
  if (r.status !== 201) throw new Error('register ' + JSON.stringify(r.body));
  await markVerified(`${name}@example.com`);
  return { id: r.body.user.id, tok: await idTokenFromCustom(r.body.customToken) };
}
const A = await mk('pushalice'), B = await mk('pushbobby');
let r = await api('POST', '/push/register', { token: 'x'.repeat(40) });
check('push register needs auth', r.status === 401);
r = await api('POST', '/push/register', { token: 'short' }, A.tok);
check('push register rejects short token', r.status === 400);
r = await api('POST', '/push/register', { token: 'tok'.repeat(20) }, A.tok);
check('push register ok', r.status === 200 && r.body.tokens === 1);
r = await api('POST', '/push/register', { token: 'tok'.repeat(20) }, A.tok);
check('push register idempotent', r.body.tokens === 1);
r = await api('POST', '/push/unregister', { token: 'tok'.repeat(20) }, A.tok);
check('push unregister', r.status === 200);
r = await api('POST', '/presence/ping', {}, A.tok);
check('presence ping ok', r.status === 200);
r = await api('POST', '/presence/ping', {});
check('presence ping needs auth', r.status === 401);
// a like creates a notification and must not break even with a registered token (push is best-effort)
await api('POST', '/push/register', { token: 'tok'.repeat(20) }, A.tok);
r = await api('POST', '/posts', { content: 'منشور للاختبار', category: 'فضفضة' }, A.tok);
const pid = r.body.post.id;
r = await api('POST', `/posts/${pid}/react`, { reactionType: 'like' }, B.tok);
check('react still works with push token registered', r.status === 200 && r.body.active);
r = await api('GET', '/notifications', undefined, A.tok);
check('notification still created', r.body.notifications.length >= 1);
await api('POST', '/presence/ping', { active: false }, A.tok);
server.close();
console.log('done');
process.exit(process.exitCode || 0);

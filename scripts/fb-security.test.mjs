import { createApi } from '../server/fb/app.ts';
import { check, results, client, idTokenFromCustom, markVerified } from './fb-test-lib.mjs';

// Focused tests for the security fixes: the email gate, the per-account login
// lockout, the closed support form, and the private rosters.

const server = createApi().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const api = client(base);
const PW = 'Meen#Test2026x';

async function register(name, verified) {
  const r = await api('POST', '/auth/register', {
    displayName: name, username: name, email: `${name}@example.com`,
    password: PW, confirmPassword: PW, birthDate: '2000-01-01', termsAccepted: true,
  });
  if (r.status !== 201) throw new Error('register ' + name + ' ' + JSON.stringify(r.body));
  if (verified) await markVerified(`${name}@example.com`);
  return { id: r.body.user.id, tok: await idTokenFromCustom(r.body.customToken) };
}

// ---- Email confirmation gate ----
const unverified = await register('gateuser', false);
let r = await api('POST', '/posts', { content: 'منشور من حساب غير مؤكد' }, unverified.tok);
check('unverified account cannot post', r.status === 403 && r.body.code === 'email_not_verified', JSON.stringify(r.body));
r = await api('POST', '/posts', { content: 'تعليق' }, unverified.tok);
check('unverified account cannot post a second time', r.status === 403);

await markVerified('gateuser@example.com');
const relogin = await api('POST', '/auth/login', { identifier: 'gateuser', password: PW });
check('verified account can log in', relogin.status === 200);
const verifiedTok = await idTokenFromCustom(relogin.body.customToken);
r = await api('POST', '/posts', { content: 'منشور بعد تأكيد البريد' }, verifiedTok);
check('verified account can post', r.status === 201, JSON.stringify(r.body));
const gateMe = await api('GET', '/auth/me', undefined, verifiedTok);
check('me reports emailVerified', gateMe.body.user?.emailVerified === true, JSON.stringify(gateMe.body.user?.emailVerified));

// ---- Per-account login lockout ----
const victim = await register('lockme', true);
for (let i = 0; i < 8; i++) {
  const bad = await api('POST', '/auth/login', { identifier: 'lockme', password: 'WrongPass#' + i });
  if (bad.status !== 401) check(`wrong password attempt ${i + 1} is 401`, false, JSON.stringify(bad.body));
}
r = await api('POST', '/auth/login', { identifier: 'lockme', password: PW });
check('account locks after 8 failures even with the right password', r.status === 429, JSON.stringify(r.body));
const viaEmail = await api('POST', '/auth/login', { identifier: 'lockme@example.com', password: PW });
check('lockout cannot be dodged by switching to the email', viaEmail.status === 429, JSON.stringify(viaEmail.body));
const otherLogin = await api('POST', '/auth/login', { identifier: 'gateuser', password: PW });
check('lockout is per account, other accounts still log in', otherLogin.status === 200);
void victim;

// ---- Password policy ----
r = await api('POST', '/auth/register', {
  displayName: 'weak', username: 'weakpass', email: 'weakpass@example.com',
  password: 'password123', confirmPassword: 'password123', birthDate: '2000-01-01', termsAccepted: true,
});
check('common password rejected at signup', r.status === 400, JSON.stringify(r.body));
r = await api('POST', '/auth/register', {
  displayName: 'weak2', username: 'weakpass2', email: 'weakpass2@example.com',
  password: 'short1!', confirmPassword: 'short1!', birthDate: '2000-01-01', termsAccepted: true,
});
check('short password rejected at signup', r.status === 400);

// ---- Support form needs an account ----
r = await api('POST', '/support', { category: 'أخرى', subject: 'spam', description: 'spam spam spam' });
check('support form rejects anonymous posts', r.status === 401, JSON.stringify(r.body));

// ---- Guest browsing has no member directory ----
const anonExplore = await api('GET', '/explore?q=a');
check('guest explore returns no user directory', Array.isArray(anonExplore.body.users) && anonExplore.body.users.length === 0);
const anonExploreHome = await api('GET', '/explore');
check('guest explore returns no suggestions', (anonExploreHome.body.suggestedUsers || []).length === 0);
const memberExplore = await api('GET', '/explore?q=gateuser', undefined, verifiedTok);
check('signed-in search still finds people', (memberExplore.body.users || []).length > 0, JSON.stringify(memberExplore.body.users));
const anonProfile = await api('GET', '/users/gateuser');
check('profile hides last-active from guests', anonProfile.status === 200 && anonProfile.body.profile.lastActiveAt === null);

// ---- Private community roster ----
const owner = verifiedTok;
r = await api('POST', '/communities', { name: 'مجتمع سري للاختبار', description: 'وصف واضح للمجتمع السري', privacy: 'private' }, owner);
check('private community created', r.status === 201, JSON.stringify(r.body));
const privateId = r.body.id;
const outsider = await register('outsider', true);
const asOwner = await api('GET', `/communities/${privateId}`, undefined, owner);
check('owner sees the roster', (asOwner.body.community.members || []).length === 1, JSON.stringify(asOwner.body.community.members));
const asOutsider = await api('GET', `/communities/${privateId}`, undefined, outsider.tok);
check('outsider sees no roster', (asOutsider.body.community.members || []).length === 0);
check('outsider sees no moderators', (asOutsider.body.community.moderators || []).length === 0);
const asAnon = await api('GET', `/communities/${privateId}`);
check('guest sees no roster', (asAnon.body.community.members || []).length === 0);

// ---- Voice notes belong to the conversation they were sent in ----
const va = await register('voicea', true);
const vb = await register('voiceb', true);
const vc = await register('voicec', true);
const audio = 'data:audio/webm;base64,' + Buffer.from('voice note bytes').toString('base64');
let up = await api('POST', '/upload', { dataUrl: audio }, va.tok);
check('voice note uploaded', up.status === 200 && up.body.url.startsWith('/api/media/'), JSON.stringify(up.body));
const noteUrl = up.body.url;
let conv = await api('POST', '/messages/conversations', { peerId: vb.id }, va.tok);
check('conversation created', conv.status === 201 || conv.status === 200, JSON.stringify(conv.body));
const convId = conv.body.conversationId;
await api('POST', `/messages/conversations/${convId}/respond`, { action: 'accept' }, vb.tok);
const sent = await api('POST', `/messages/conversations/${convId}`, { content: 'بصت صوت', mediaUrl: noteUrl, messageType: 'audio' }, va.tok);
check('voice message sent', sent.status === 201, JSON.stringify(sent.body));
const receiverFetch = await fetch(base + noteUrl, { headers: { authorization: 'Bearer ' + vb.tok } });
check('the other side can play the voice note', receiverFetch.status === 200);
const strangerFetch = await fetch(base + noteUrl, { headers: { authorization: 'Bearer ' + vc.tok } });
check('a stranger cannot play it', strangerFetch.status === 403);
const deletedMsg = await api('DELETE', `/messages/${sent.body.message.id}`, undefined, va.tok);
check('voice message deleted', deletedMsg.status === 200);
const afterDelete = await fetch(base + noteUrl, { headers: { authorization: 'Bearer ' + va.tok } });
check('deleting the message deletes the file', afterDelete.status === 404, String(afterDelete.status));

console.log(`\n${results.pass} passed, ${results.fail} failed`);
server.close();
process.exit(results.fail ? 1 : 0);

import { createApi } from '../server/fb/app.ts';
// Never hardcode the real admin address in a public repo; run.sh passes it in.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
import { check, results, client, idTokenFromCustom, googleLikeToken } from './fb-test-lib.mjs';

const server = createApi().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const api = client(base);
const reg = (o = {}) => ({ displayName: 'سلمى', username: 'salma_1', email: 'salma@example.com', password: 'Passw0rd!x', confirmPassword: 'Passw0rd!x', birthDate: '2000-01-01', termsAccepted: true, ...o });

let r = await api('GET', '/auth/me');
check('me signed out', r.status === 200 && r.body.user === null && r.body.appConfig.categories.length > 0);

r = await api('POST', '/auth/register', reg({ termsAccepted: false }));
check('register requires terms', r.status === 400);
r = await api('POST', '/auth/register', reg({ password: 'abc', confirmPassword: 'abc' }));
check('register weak password rejected', r.status === 400, JSON.stringify(r.body));
r = await api('POST', '/auth/register', reg({ email: ADMIN_EMAIL }));
check('admin email cannot be claimed by password signup', r.status === 400);
r = await api('POST', '/auth/register', reg());
check('register ok', r.status === 201 && r.body.customToken && r.body.user.username === 'salma_1', JSON.stringify(r.body));
const userId = r.body.user?.id;
r = await api('POST', '/auth/register', reg({ email: 'other@example.com' }));
check('duplicate username 409', r.status === 409);
r = await api('POST', '/auth/register', reg({ username: 'salma_2' }));
check('duplicate email 409', r.status === 409);

r = await api('POST', '/auth/login', { identifier: 'salma_1', password: 'wrongpass1!' });
check('login wrong password 401', r.status === 401);
r = await api('POST', '/auth/login', { identifier: 'nobody', password: 'Passw0rd!x' });
check('login unknown 401 same error', r.status === 401);
r = await api('POST', '/auth/login', { identifier: 'Salma_1', password: 'Passw0rd!x' });
check('login by username', r.status === 200 && r.body.customToken);
const token = await idTokenFromCustom(r.body.customToken);
r = await api('POST', '/auth/login', { identifier: 'salma@example.com', password: 'Passw0rd!x' });
check('login by email', r.status === 200);

r = await api('GET', '/auth/me', undefined, token);
check('me with token', r.status === 200 && r.body.user?.id === userId && r.body.user.role === 'user' && r.body.user.badges.some((b) => b.slug === 'new_member'), JSON.stringify(r.body).slice(0, 300));
check('no self-promotion: role user', r.body.user.role === 'user');
r = await api('GET', '/auth/me', undefined, 'garbage');
check('bad token = signed out', r.body.user === null);

r = await api('PATCH', '/account/profile', { role: 'admin', bio: 'مرحبا', displayName: 'سلمى ٢' }, token);
check('profile patch ignores role', r.status === 200 && r.body.user.role === 'user' && r.body.user.bio === 'مرحبا');
r = await api('PATCH', '/account/privacy', { privacyLevel: 'friends', notifyPrefs: { messages: false } }, token);
check('privacy patch', r.status === 200 && r.body.user.privacyLevel === 'friends' && r.body.user.notifyPrefs.messages === false);

// Google admin
const gTok = await googleLikeToken(ADMIN_EMAIL, 'Salah');
r = await api('GET', '/auth/me', undefined, gTok);
check('google first login needs profile', r.body.user === null && r.body.needsProfile === true);
r = await api('POST', '/auth/complete-profile', { displayName: 'Salah', username: 'salah', birthDate: '2000-01-01', termsAccepted: true, role: 'admin' }, gTok);
check('complete profile', r.status === 201 && r.body.user.role === 'admin', JSON.stringify(r.body));
const adminTok2 = await googleLikeToken(ADMIN_EMAIL, 'Salah');
r = await api('GET', '/auth/me', undefined, adminTok2);
check('admin recognised', r.body.user?.role === 'admin' && r.body.hasAdmin === true);

const g2 = await googleLikeToken('rando@gmail.com', 'Rando');
r = await api('POST', '/auth/complete-profile', { displayName: 'Rando', username: 'rando', birthDate: '2000-01-01', termsAccepted: true }, g2);
check('other google user is plain user', r.status === 201 && r.body.user.role === 'user');

r = await api('POST', '/account/password', { currentPassword: 'bad', newPassword: 'NewPassw0rd!', confirmPassword: 'NewPassw0rd!' }, token);
check('password change needs current', r.status === 401);
r = await api('POST', '/account/password', { currentPassword: 'Passw0rd!x', newPassword: 'NewPassw0rd!', confirmPassword: 'NewPassw0rd!' }, token);
check('password change ok', r.status === 200);
r = await api('GET', '/auth/me', undefined, token);
check('old token revoked after password change', r.body.user === null);
r = await api('POST', '/auth/login', { identifier: 'salma_1', password: 'NewPassw0rd!' });
check('login with new password', r.status === 200);
const tok3 = await idTokenFromCustom(r.body.customToken);

r = await api('POST', '/upload', { dataUrl: 'data:image/png;base64,AAAA' }, tok3);
check('upload rejects bad png', r.status === 400);
const wav = 'data:audio/webm;base64,' + Buffer.from('hello voice').toString('base64');
r = await api('POST', '/upload', { dataUrl: wav }, tok3);
check('voice upload ok', r.status === 200 && r.body.url.startsWith('/api/media/'));
const voiceUrl = r.body.url;
const m = await fetch(base + voiceUrl, { headers: { authorization: 'Bearer ' + tok3 } });
check('voice served to its owner', m.status === 200 && (await m.text()) === 'hello voice');
const anonVoice = await fetch(base + voiceUrl);
check('voice not served anonymously', anonVoice.status === 401);
const otherReg = await api('POST', '/auth/register', reg({ username: 'voice_other', email: 'voice_other@example.com' }));
const otherTok = await idTokenFromCustom(otherReg.body.customToken);
const otherVoice = await fetch(base + voiceUrl, { headers: { authorization: 'Bearer ' + otherTok } });
check('voice not served to another account', otherVoice.status === 403);
r = await api('POST', '/upload', { dataUrl: wav });
check('upload needs auth', r.status === 401);

r = await api('POST', '/auth/recover', { identifier: 'nobody' });
check('recover same answer for unknown', r.status === 200 && r.body.ok);

r = await api('DELETE', '/account', { password: 'wrong' }, tok3);
check('delete needs password', r.status === 401);
r = await api('DELETE', '/account', { password: 'NewPassw0rd!' }, tok3);
check('delete ok', r.status === 200);
r = await api('POST', '/auth/login', { identifier: 'salma_1', password: 'NewPassw0rd!' });
check('deleted account cannot login', r.status === 401);
r = await api('POST', '/auth/register', reg());
check('username/email free again after delete', r.status === 201);

console.log(`\n${results.pass} passed, ${results.fail} failed`);
server.close();
process.exit(results.fail ? 1 : 0);

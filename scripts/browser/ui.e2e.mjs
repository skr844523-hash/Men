import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
let fail = 0; const ok = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); if (!c) fail++; };
const errs = [];
async function newUser(name, viewport = { width: 1100, height: 800 }) {
  const ctx = await b.newContext({ viewport });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(name + ': ' + e.message.slice(0, 150)));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(name + ' console: ' + m.text().slice(0, 150)); });
  await p.goto('http://localhost:3137/', { waitUntil: 'networkidle' });
  return p;
}
async function register(p, name) {
  await p.getByRole('button', { name: 'إنشاء حساب', exact: true }).first().click();
  await p.fill('#reg-display', name); await p.fill('#reg-username', name);
  await p.fill('#reg-email', `${name}@example.com`);
  await p.fill('#reg-pass', 'Passw0rd!x'); await p.fill('#reg-confirm', 'Passw0rd!x');
  await p.check('#reg-terms');
  await p.getByRole('button', { name: 'إنشاء حساب في مين؟' }).click();
  await p.getByLabel('الإشعارات').first().waitFor({ timeout: 15000 });
}
const A = await newUser('alice', { width: 400, height: 800 });
await register(A, 'alice');
ok('register via UI logs in (mobile viewport)', true);
await A.screenshot({ path: '/tmp/e1.png' });
// reload keeps session (Firebase persistence)
await A.reload({ waitUntil: 'networkidle' });
await A.getByLabel('فتح القائمة الجانبية').waitFor({ timeout: 10000 });
ok('session survives reload', true);
// post
await A.getByLabel('نشر جديد').click();
await A.fill('#composer-content', 'أول منشور حقيقي من أليس');
await A.getByRole('button', { name: 'نشر الآن' }).click();
await A.getByText('أول منشور حقيقي من أليس').first().waitFor({ timeout: 10000 });
ok('post created and shown', true);
await A.screenshot({ path: '/tmp/e2.png' });

const B = await newUser('bob');
await register(B, 'bob');
await B.getByText('أول منشور حقيقي من أليس').first().waitFor({ timeout: 10000 });
ok("bob sees alice's post", true);
// logout/login by username
await B.screenshot({ path: '/tmp/e3.png' });
// messaging between users, realtime
await B.screenshot({ path: '/tmp/e3.png' });
const resB = await B.evaluate(async () => { const { getAuth } = await import('/src/lib/firebase/config.ts'); return 1; }).catch(() => 0);
// realtime: another user messages alice through the API; alice's open page must update with no reload
const API = 'http://localhost:3137/api';
const AUTHH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x';
const j = async (path, method, body, tok) => (await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const idTok = async (ct) => (await (await fetch(AUTHH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: ct, returnSecureToken: true }) })).json()).idToken;
const al = await j('/auth/login', 'POST', { identifier: 'alice', password: 'Passw0rd!x' });
const aliceTok = await idTok(al.customToken);
const aliceId = (await j('/auth/me', 'GET', null, aliceTok)).user.id;
const cr = await j('/auth/register', 'POST', { displayName: 'carol', username: 'carol', email: 'carol@example.com', password: 'Passw0rd!x', confirmPassword: 'Passw0rd!x', birthDate: '2000-01-01', termsAccepted: true });
const carolTok = await idTok(cr.customToken);
const conv = await j('/messages/conversations', 'POST', { peerId: aliceId }, carolTok);
await j('/messages/conversations/' + conv.conversationId, 'POST', { content: 'مرحبا أليس' }, carolTok);
let badge = false;
for (let i = 0; i < 20 && !badge; i++) { await A.waitForTimeout(500); badge = /1/.test(await A.getByLabel('الإشعارات').first().innerText().catch(() => '')) || (await A.locator('[aria-label*="الإشعارات"]').first().textContent().catch(() => '')).includes('1'); }
ok('realtime: alice gets notification badge without reload', badge);
await A.screenshot({ path: '/tmp/e4.png' });
// comment realtime: carol comments on alice's post, count updates in bob's open feed
const feed = await j('/posts', 'GET', null, carolTok);
const pid = (feed.posts || feed.items || [])[0]?.id;
ok('feed API returns the post', Boolean(pid));
await j(`/posts/${pid}/comments`, 'POST', { content: 'تعليق مباشر' }, carolTok);
let upd = false;
for (let i = 0; i < 20 && !upd; i++) { await B.waitForTimeout(500); upd = (await B.locator('article').first().innerText().catch(() => '')).includes('1'); }
ok('realtime: comment count updates in bob feed', upd);
// logout + login by username through the UI
await A.goto('http://localhost:3137/', { waitUntil: 'networkidle' });
const L = await newUser('login');
await L.fill('#login-identifier', 'alice'); await L.locator('input[type=password]').first().fill('wrongpass1!');
await L.getByRole('button', { name: 'دخول إلى مين؟' }).click();
await L.getByRole('alert').or(L.getByText(/غير صحيح|خاطئ|بيانات/)).first().waitFor({ timeout: 8000 });
ok('wrong password shows Arabic error', true);
await L.locator('input[type=password]').first().fill('Passw0rd!x');
await L.getByRole('button', { name: 'دخول إلى مين؟' }).click();
await L.getByLabel('الإشعارات').first().waitFor({ timeout: 15000 });
ok('login by username works in UI', true);
await L.reload({ waitUntil: 'networkidle' });
await L.getByLabel('الإشعارات').first().waitFor({ timeout: 10000 });
ok('login persists after reload', true);
console.log('errors:', JSON.stringify(errs, null, 1));
await b.close();
process.exit(fail ? 1 : 0);

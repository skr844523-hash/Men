import assert from 'node:assert/strict';
export const results = { pass: 0, fail: 0 };
export function check(name, cond, extra = '') {
  if (cond) { results.pass++; console.log('  ok  ', name); }
  else { results.fail++; console.log('  FAIL', name, extra); }
}
export const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
export async function idTokenFromCustom(customToken) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const j = await r.json();
  assert.ok(j.idToken, 'no idToken ' + JSON.stringify(j));
  return j.idToken;
}
// Emulator-only: create a Google-like user with verified email and get its id token.
export async function googleLikeToken(email, name) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=x`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestUri: 'http://localhost',
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: 'g-' + email, email, email_verified: true, name }))}&providerId=google.com`,
      returnSecureToken: true, returnIdpCredential: true,
    }),
  });
  const j = await r.json();
  assert.ok(j.idToken, 'no google idToken ' + JSON.stringify(j));
  return j.idToken;
}
export function client(base) {
  return async (method, path, body, token) => {
    const r = await fetch(base + '/api' + path, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let j = {}; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  };
}

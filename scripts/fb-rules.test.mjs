// Client SDK (what a browser/attacker can do) against the real rules file.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';
import { getDatabase, connectDatabaseEmulator, ref, get, set, update, push, remove } from 'firebase/database';
import { rtdb, auth as adminAuth } from '../server/fb/admin.ts';
import { check, results } from './fb-test-lib.mjs';

const app = initializeApp({ apiKey: 'x', projectId: 'men2-87abd', databaseURL: 'http://127.0.0.1:9000?ns=men2-87abd-default-rtdb' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
const db = getDatabase(app);
connectDatabaseEmulator(db, '127.0.0.1', 9000);

await adminAuth.createUser({ uid: 'u1' }); await adminAuth.createUser({ uid: 'u2' });
await rtdb.ref('t/users/1').set({ id: 1, email: 'secret@example.com', uid: 'u1', role: 'user' });
await rtdb.ref('t/messages/1').set({ id: 1, content: 'private' });
await rtdb.ref('live/u1/a').set({ type: 'x' });
await rtdb.ref('live/u2/a').set({ type: 'y' });
await rtdb.ref('live/_all/a').set({ type: 'z' });
await rtdb.ref('live/_posts/a').set({ type: 'p' });
await rtdb.ref('ratelimits/x').set(1);

const denied = async (p) => { try { await p; return false; } catch (e) { return /permission.denied/i.test(String(e.message || e)); } };
const allowed = async (p) => { try { await p; return true; } catch { return false; } };

// anonymous (not signed in)
check('anon cannot read root', await denied(get(ref(db, '/'))));
check('anon cannot read t/users', await denied(get(ref(db, 't/users'))));
check('anon cannot read live/_all', await denied(get(ref(db, 'live/_all'))));

await signInWithCustomToken(auth, await adminAuth.createCustomToken('u1'));
check('user cannot read root', await denied(get(ref(db, '/'))));
check('user cannot read t/users', await denied(get(ref(db, 't/users'))));
check('user cannot read t/users/1', await denied(get(ref(db, 't/users/1'))));
check('user cannot read t/messages', await denied(get(ref(db, 't/messages'))));
check('user cannot read ratelimits', await denied(get(ref(db, 'ratelimits'))));
check('user cannot read all of live', await denied(get(ref(db, 'live'))));
check('user can read own live channel', await allowed(get(ref(db, 'live/u1'))));
check('user cannot read another live channel', await denied(get(ref(db, 'live/u2'))));
check('user can read live/_all hints', await allowed(get(ref(db, 'live/_all'))));
check('user can read live/_posts hints', await allowed(get(ref(db, 'live/_posts'))));
check('user cannot write t/users (self-promote)', await denied(update(ref(db, 't/users/1'), { role: 'admin' })));
check('user cannot create t/posts', await denied(push(ref(db, 't/posts'), { content: 'x' })));
check('user cannot delete t/messages', await denied(remove(ref(db, 't/messages/1'))));
check('user cannot write own live channel', await denied(set(ref(db, 'live/u1/b'), { x: 1 })));
check('user cannot write live/_all', await denied(set(ref(db, 'live/_all/b'), { x: 1 })));
check('user cannot write root', await denied(set(ref(db, 'zzz'), 1)));
check('user cannot write custom claim style path', await denied(set(ref(db, 'admins/u1'), true)));

const v = (await rtdb.ref('t/users/1').get()).val();
check('data untouched after attacks', v.role === 'user' && (await rtdb.ref('t/messages/1').get()).exists());
console.log(`\n${results.pass} passed, ${results.fail} failed`);
process.exit(results.fail ? 1 : 0);

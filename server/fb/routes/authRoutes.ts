import { Router } from 'express';
import crypto from 'node:crypto';
import { auth, rtdb, ADMIN_EMAIL } from '../admin.ts';
import { claimUnique, setUnique, get, insert, lookupUnique, nowIso, patch, releaseUnique, remove, where } from '../store.ts';
import {
  adminCount, awardUserPoints, buildUserPayload, DEFAULT_AVATAR, DEFAULT_NOTIFICATION_SETTINGS,
  ensureCatalog, getSetting,
} from '../core.ts';
import { rateLimit, requireAuth } from '../middleware.ts';
import {
  checkContentSafety, checkMinimumAge, sanitizeMediaUrl, validateEmail, validatePassword,
  validatePhone, validateUsername,
} from '../../../src/lib/validation.ts';
import { deleteUserData } from '../cascade.ts';
import { uploadMedia } from '../media.ts';

export const authRouter = Router();

const API_KEY = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'demo-key';
function identityToolkitUrl(method: string) {
  const emu = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = emu ? `http://${emu}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  return `${base}/v1/${method}?key=${API_KEY}`;
}

// Verifies an email+password pair with Firebase Auth. Returns uid or null.
async function verifyPasswordWithFirebase(email: string, password: string): Promise<string | null> {
  const r = await fetch(identityToolkitUrl('accounts:signInWithPassword'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: false }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { localId?: string };
  return j.localId || null;
}

const isAdminEmail = (email?: string | null) => Boolean(ADMIN_EMAIL) && String(email || '').toLowerCase() === ADMIN_EMAIL;

// Mirror DB role into custom claims so Realtime Database rules can read it.
export async function syncClaims(uid: string, role: string) {
  const user = await auth.getUser(uid);
  const claims = user.customClaims || {};
  const want = { role, admin: role === 'admin', moderator: role === 'moderator' };
  if (claims.role !== want.role || claims.admin !== want.admin || claims.moderator !== want.moderator) {
    await auth.setCustomUserClaims(uid, { ...claims, ...want });
  }
}

async function createProfile(params: {
  uid: string; username: string; email: string | null; phone: string | null;
  displayName: string; birthDate: string; avatar: string; interests: string[]; emailVerified: boolean;
}) {
  const role = isAdminEmail(params.email) && params.emailVerified ? 'admin' : 'user';
  const row = await insert('users', {
    uid: params.uid,
    username: params.username,
    email: params.email,
    phone: params.phone,
    role,
    status: 'active',
    birth_date: params.birthDate,
    created_at: nowIso(),
    updated_at: nowIso(),
    last_active_at: nowIso(),
    display_name: params.displayName,
    avatar: params.avatar,
    bio: '',
    interests: params.interests,
    privacy_level: 'public',
    show_activity: true,
    allow_messages_from: 'everyone',
    allow_comments_from: 'everyone',
    show_posts_to: 'everyone',
    allow_anon_mentions: true,
    notify_prefs: { messages: true, comments: true, reactions: true, friends: true, communities: true, challenges: true, daily: true },
    is_premium: false,
  });
  await setUnique('uid', params.uid, row.id);
  await syncClaims(params.uid, role);
  await awardUserPoints(row.id, 'signup', row.id);
  return row;
}

async function appConfig() {
  return {
    categories: await getSetting<string[]>('categories', []),
    announcement: await getSetting('announcement', ''),
    termsText: await getSetting('terms_text', ''),
    privacyText: await getSetting('privacy_text', ''),
    monetization: await getSetting('monetization', {}),
    notificationSettings: await getSetting('notification_settings', DEFAULT_NOTIFICATION_SETTINGS),
  };
}

authRouter.get('/auth/me', async (req, res) => {
  await ensureCatalog();
  const hasAdmin = (await adminCount()) > 0;
  const cfg = await appConfig();
  if (!req.user) {
    // Signed in with Firebase (e.g. Google) but no MEEN profile yet.
    const t = req.fbToken;
    res.json({
      user: null,
      hasAdmin,
      needsProfile: Boolean(t),
      suggested: t ? { email: t.email || null, displayName: (t as any).name || '', avatar: (t as any).picture || '' } : undefined,
      appConfig: cfg,
    });
    return;
  }
  // Promote the configured admin email once it is verified by Firebase.
  if (req.user.role !== 'admin' && isAdminEmail(req.fbToken?.email) && req.fbToken?.email_verified) {
    await patch('users', req.user.id, { role: 'admin', updated_at: nowIso() });
    await syncClaims(req.user.uid, 'admin');
  } else if (req.fbToken && (req.fbToken as any).role !== req.user.role) {
    await syncClaims(req.user.uid, req.user.role);
  }
  await patch('users', req.user.id, { last_active_at: nowIso() });
  res.json({ user: await buildUserPayload(req.user.id), hasAdmin, appConfig: cfg });
});

function validateProfileInput(body: any) {
  const { displayName, username, email, phone, birthDate, avatar, interests, termsAccepted } = body ?? {};
  if (!termsAccepted) return { error: 'يجب الموافقة على الشروط وسياسة الخصوصية أولًا.' };
  const cleanDisplay = typeof displayName === 'string' ? displayName.trim() : '';
  if (cleanDisplay.length < 2 || cleanDisplay.length > 40) return { error: 'الاسم المستعار يجب أن يكون بين حرفين و40 حرفًا.' };
  const userCheck = validateUsername(String(username || ''));
  if (!userCheck.valid) return { error: userCheck.error };
  const cleanEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
  const cleanPhone = typeof phone === 'string' && phone.trim() ? phone.replace(/[\s\-()]/g, '') : null;
  if (!cleanEmail || !validateEmail(cleanEmail)) return { error: 'يرجى إدخال بريد إلكتروني صحيح.' };
  if (cleanPhone && !validatePhone(cleanPhone)) return { error: 'رقم الهاتف غير صالح.' };
  const ageCheck = checkMinimumAge(String(birthDate || ''), 13);
  if (!ageCheck.valid) return { error: ageCheck.error };
  return {
    value: {
      displayName: cleanDisplay,
      username: userCheck.value as string,
      email: cleanEmail,
      phone: cleanPhone,
      birthDate: String(birthDate),
      avatar: sanitizeMediaUrl(avatar) || DEFAULT_AVATAR,
      interests: Array.isArray(interests) ? interests.filter((x: unknown): x is string => typeof x === 'string').slice(0, 12) : [],
    },
  };
}

// Email + password sign-up. The server validates everything and creates the Firebase account;
// the client then signs in with the returned custom token.
authRouter.post('/auth/register', rateLimit('register', 10, 60000), async (req, res) => {
  await ensureCatalog();
  const parsed = validateProfileInput(req.body);
  if ('error' in parsed) return void res.status(400).json({ error: parsed.error });
  const v = parsed.value;
  const { password, confirmPassword } = req.body ?? {};
  const passCheck = validatePassword(String(password || ''));
  if (!passCheck.valid) return void res.status(400).json({ error: passCheck.error });
  if (password !== confirmPassword) return void res.status(400).json({ error: 'كلمتا المرور غير متطابقتين.' });
  // The admin address can only be claimed through Google (verified email), never by password sign-up.
  if (isAdminEmail(v.email)) {
    return void res.status(400).json({ error: 'هذا البريد مخصص لحساب الإدارة، سجّل الدخول بجوجل.' });
  }

  if (!(await claimUnique('username', v.username, 'pending'))) {
    return void res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل، اختر اسمًا آخر.' });
  }
  if (!(await claimUnique('email', v.email!, 'pending'))) {
    await releaseUnique('username', v.username);
    return void res.status(409).json({ error: 'البريد الإلكتروني مسجل مسبقًا.' });
  }
  if (v.phone && !(await claimUnique('phone', v.phone, 'pending'))) {
    await releaseUnique('username', v.username);
    await releaseUnique('email', v.email!);
    return void res.status(409).json({ error: 'رقم الهاتف مسجل مسبقًا.' });
  }
  const rollback = async () => {
    await releaseUnique('username', v.username);
    await releaseUnique('email', v.email!);
    if (v.phone) await releaseUnique('phone', v.phone);
  };
  try {
    const fbUser = await auth.createUser({ email: v.email!, password: String(password), displayName: v.displayName, emailVerified: false });
    const row = await createProfile({ ...v, email: v.email, uid: fbUser.uid, emailVerified: false });
    await setUnique('username', v.username, row.id);
    await setUnique('email', v.email!, row.id);
    if (v.phone) await setUnique('phone', v.phone, row.id);
    const customToken = await auth.createCustomToken(fbUser.uid);
    res.status(201).json({ customToken, user: await buildUserPayload(row.id) });
  } catch (e: any) {
    await rollback();
    if (e?.code === 'auth/email-already-exists') return void res.status(409).json({ error: 'البريد الإلكتروني مسجل مسبقًا.' });
    console.error('register failed', e?.code || e);
    res.status(500).json({ error: 'تعذر إنشاء الحساب الآن، حاول مرة أخرى.' });
  }
});

// First sign-in with Google (or any provider): create the MEEN profile for the Firebase user.
authRouter.post('/auth/complete-profile', rateLimit('complete', 10, 60000), async (req, res) => {
  await ensureCatalog();
  if (!req.fbToken) return void res.status(401).json({ error: 'يرجى تسجيل الدخول أولًا.' });
  if (req.user) return void res.status(409).json({ error: 'الحساب مكتمل بالفعل.' });
  const email = req.fbToken.email?.toLowerCase();
  if (!email) return void res.status(400).json({ error: 'حسابك لا يحتوي على بريد إلكتروني.' });
  const parsed = validateProfileInput({ ...req.body, email });
  if ('error' in parsed) return void res.status(400).json({ error: parsed.error });
  const v = parsed.value;
  if (!(await claimUnique('username', v.username, 'pending'))) {
    return void res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل، اختر اسمًا آخر.' });
  }
  if (!(await claimUnique('email', email, 'pending'))) {
    await releaseUnique('username', v.username);
    return void res.status(409).json({ error: 'البريد الإلكتروني مسجل مسبقًا.' });
  }
  if (v.phone && !(await claimUnique('phone', v.phone, 'pending'))) {
    await releaseUnique('username', v.username);
    await releaseUnique('email', email);
    return void res.status(409).json({ error: 'رقم الهاتف مسجل مسبقًا.' });
  }
  const row = await createProfile({ ...v, email, uid: req.fbToken.uid, emailVerified: Boolean(req.fbToken.email_verified) });
  await setUnique('username', v.username, row.id);
  await setUnique('email', email, row.id);
  if (v.phone) await setUnique('phone', v.phone, row.id);
  res.status(201).json({ user: await buildUserPayload(row.id) });
});

// Login by username / email / phone + password. Returns a Firebase custom token so the
// client can sign in without the server ever revealing which email belongs to a username.
authRouter.post('/auth/login', rateLimit('login', 15, 60000), async (req, res) => {
  const { identifier, password } = req.body ?? {};
  const cleanId = typeof identifier === 'string' ? identifier.trim().toLowerCase() : '';
  if (!cleanId || typeof password !== 'string' || !password) {
    return void res.status(400).json({ error: 'يرجى إدخال اسم المستخدم أو البريد وكلمة المرور.' });
  }
  const handle = cleanId.replace(/^@+/, '');
  let id = (await lookupUnique('email', cleanId)) ?? (await lookupUnique('username', handle)) ?? (await lookupUnique('phone', cleanId.replace(/[\s\-()]/g, '')));
  let email: string | null = null;
  let user: any = null;
  if (id != null && id !== 'pending') {
    user = await get<any>('users', id as number);
    email = user?.email ?? null;
  } else if (validateEmail(cleanId)) {
    email = cleanId; // e.g. an account that exists only in Firebase Auth
  }
  const uid = email ? await verifyPasswordWithFirebase(email, password) : null;
  if (!uid) return void res.status(401).json({ error: 'بيانات تسجيل الدخول غير صحيحة.' });
  if (user && user.status === 'banned') return void res.status(403).json({ error: 'تم حظر هذا الحساب لمخالفة قواعد المنصة.' });
  const customToken = await auth.createCustomToken(uid);
  res.json({ customToken });
});

authRouter.post('/auth/logout', (_req, res) => {
  res.json({ ok: true });
});

// Password reset itself is done by Firebase (sendPasswordResetEmail) on the client.
// This endpoint only resolves a username/phone to a reset email without revealing it.
authRouter.post('/auth/recover', rateLimit('recover', 8, 60000), async (req, res) => {
  const cleanId = typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
  if (!cleanId) return void res.status(400).json({ error: 'يرجى إدخال البريد أو اسم المستخدم.' });
  const handle = cleanId.replace(/^@+/, '');
  const id = (await lookupUnique('email', cleanId)) ?? (await lookupUnique('username', handle)) ?? (await lookupUnique('phone', cleanId.replace(/[\s\-()]/g, '')));
  let email: string | null = null;
  if (id != null && id !== 'pending') email = (await get<any>('users', id as number))?.email ?? null;
  else if (validateEmail(cleanId)) email = cleanId;
  if (email) {
    try {
      await fetch(identityToolkitUrl('accounts:sendOobCode'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
      });
    } catch {
      // answer is identical either way
    }
  }
  res.json({ ok: true, message: 'إذا كان الحساب موجودًا فسيصلك بريد لإعادة تعيين كلمة المرور.' });
});

authRouter.patch('/account/profile', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const { displayName, username, bio, avatar, interests, phone } = req.body ?? {};
  const cur = await get<any>('users', userId);
  const upd: Record<string, any> = {};

  if (displayName !== undefined) {
    const clean = String(displayName).trim();
    if (clean.length < 2 || clean.length > 40) return void res.status(400).json({ error: 'الاسم المستعار يجب أن يكون بين حرفين و40 حرفًا.' });
    upd.display_name = clean;
  }
  if (username !== undefined) {
    const check = validateUsername(String(username));
    if (!check.valid) return void res.status(400).json({ error: check.error });
    if (check.value!.toLowerCase() !== String(cur.username).toLowerCase()) {
      if (!(await claimUnique('username', check.value!, userId))) return void res.status(409).json({ error: 'اسم المستخدم محجوز لحساب آخر.' });
      await releaseUnique('username', cur.username);
    }
    upd.username = check.value;
  }
  if (phone !== undefined) {
    const cleanPhone = String(phone).replace(/[\s\-()]/g, '') || null;
    if (cleanPhone && !validatePhone(cleanPhone)) return void res.status(400).json({ error: 'رقم الهاتف غير صالح.' });
    if (cleanPhone && cleanPhone !== cur.phone) {
      if (!(await claimUnique('phone', cleanPhone, userId))) return void res.status(409).json({ error: 'رقم الهاتف مستخدم في حساب آخر.' });
    }
    if (cur.phone && cur.phone !== cleanPhone) await releaseUnique('phone', cur.phone);
    upd.phone = cleanPhone;
  }
  if (bio !== undefined) {
    const cleanBio = String(bio).trim().slice(0, 260);
    if (cleanBio) {
      const safety = checkContentSafety(cleanBio, { allowContactInfo: false });
      if (!safety.safe) return void res.status(400).json({ error: safety.reason });
    }
    upd.bio = cleanBio;
  }
  if (avatar !== undefined) {
    const safe = sanitizeMediaUrl(String(avatar));
    if (!safe) return void res.status(400).json({ error: 'رابط الصورة غير صالح.' });
    upd.avatar = safe;
  }
  if (Array.isArray(interests)) upd.interests = interests.filter((i): i is string => typeof i === 'string').slice(0, 12);
  // Email is owned by Firebase Auth (verified there); it is intentionally not editable here.
  upd.updated_at = nowIso();
  await patch('users', userId, upd);
  res.json({ user: await buildUserPayload(userId) });
});

authRouter.patch('/account/privacy', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const { privacyLevel, showActivity, allowMessagesFrom, allowCommentsFrom, showPostsTo, allowAnonMentions, notifyPrefs } = req.body ?? {};
  const cur = await get<any>('users', userId);
  const okPrivacy = new Set(['public', 'friends', 'limited']);
  const okMsg = new Set(['everyone', 'friends', 'none']);
  const okPosts = new Set(['everyone', 'friends', 'only_me']);
  const allowedNotifyKeys = new Set(['messages', 'comments', 'reactions', 'friends', 'communities', 'challenges', 'daily', 'instantAlerts', 'friendsOnlyInstantAlerts']);
  const upd: Record<string, any> = {
    privacy_level: okPrivacy.has(privacyLevel) ? privacyLevel : cur.privacy_level,
    show_activity: typeof showActivity === 'boolean' ? showActivity : cur.show_activity,
    allow_messages_from: okMsg.has(allowMessagesFrom) ? allowMessagesFrom : cur.allow_messages_from,
    allow_comments_from: okMsg.has(allowCommentsFrom) ? allowCommentsFrom : cur.allow_comments_from,
    show_posts_to: okPosts.has(showPostsTo) ? showPostsTo : cur.show_posts_to,
    allow_anon_mentions: typeof allowAnonMentions === 'boolean' ? allowAnonMentions : cur.allow_anon_mentions,
    updated_at: nowIso(),
  };
  if (notifyPrefs && typeof notifyPrefs === 'object') {
    const clean: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(notifyPrefs as Record<string, unknown>)) if (allowedNotifyKeys.has(k) && typeof v === 'boolean') clean[k] = v;
    upd.notify_prefs = clean;
  }
  await patch('users', userId, upd);
  res.json({ user: await buildUserPayload(userId) });
});

authRouter.post('/account/password', requireAuth, rateLimit('change_password', 8, 60000), async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body ?? {};
  const email = req.user!.email;
  const uid = email ? await verifyPasswordWithFirebase(email, String(currentPassword || '')) : null;
  if (!uid || uid !== req.user!.uid) return void res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
  const check = validatePassword(String(newPassword || ''));
  if (!check.valid) return void res.status(400).json({ error: check.error });
  if (newPassword !== confirmPassword) return void res.status(400).json({ error: 'كلمتا المرور غير متطابقتين.' });
  await auth.updateUser(uid, { password: String(newPassword) });
  await auth.revokeRefreshTokens(uid);
  res.json({ ok: true, message: 'تم تغيير كلمة المرور بنجاح، سجّل الدخول من جديد.' });
});

authRouter.post('/account/logout-all', requireAuth, async (req, res) => {
  await auth.revokeRefreshTokens(req.user!.uid);
  res.json({ ok: true });
});

authRouter.delete('/account', requireAuth, rateLimit('delete_account', 5, 60000), async (req, res) => {
  const { password } = req.body ?? {};
  const u = req.user!;
  const fb = await auth.getUser(u.uid);
  const hasPassword = fb.providerData.some((p) => p.providerId === 'password');
  if (hasPassword) {
    const uid = u.email ? await verifyPasswordWithFirebase(u.email, String(password || '')) : null;
    if (uid !== u.uid) return void res.status(401).json({ error: 'كلمة المرور غير صحيحة لتأكيد حذف الحساب.' });
  } else if (String(password || '').trim().toLowerCase() !== u.username.toLowerCase()) {
    // Google-only account: confirm by typing the username.
    return void res.status(401).json({ error: 'اكتب اسم المستخدم لتأكيد حذف الحساب.' });
  }
  await deleteUserData(u.id);
  await releaseUnique('username', u.username);
  if (u.email) await releaseUnique('email', u.email);
  if (u.phone) await releaseUnique('phone', u.phone);
  await releaseUnique('uid', u.uid);
  await remove('users', u.id);
  await auth.deleteUser(u.uid);
  res.json({ ok: true });
});

authRouter.post('/upload', requireAuth, rateLimit('upload', 20, 60000), async (req, res) => {
  const r = await uploadMedia(req.body?.dataUrl, req.user!.id);
  if ('error' in r) return void res.status(r.status).json({ error: r.error });
  res.json({ url: r.url });
});

export { crypto };

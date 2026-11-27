import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck, Upload, UserCheck, ArrowRight, CheckCircle2 } from 'lucide-react';
import { GoogleAuthProvider, signInWithCustomToken, signInWithPopup } from 'firebase/auth';
import { apiRequest, uploadMediaFile } from '../lib/api';
import { getFirebaseAuth } from '../lib/firebase/config';
import {
  checkMinimumAge,
  validateEmail,
  validatePassword,
  validatePhone,
  validateUsername,
} from '../lib/validation';
import type { AppConfig, User } from '../types';

interface AuthScreenProps {
  appConfig: AppConfig;
  initialMode?: 'login' | 'register' | 'recover';
  onSuccess: (user: User) => void;
  onBrowseGuest?: () => void;
}

const AVATAR_PRESETS = [
  '/src/assets/images/meen_avatar_1_1795731517922.jpg',
  '/src/assets/images/meen_brand_emblem_1795731517188.jpg',
  '/icon.svg',
];

const INTEREST_OPTIONS = [
  'فضفضة',
  'مشاعر',
  'مواقف',
  'أسئلة',
  'قصص',
  'نصائح',
  'علاقات',
  'الحياة اليومية',
  'الألعاب',
  'التكنولوجيا',
  'الأفلام',
  'كرة القدم',
  'الدراسة',
];

export const AuthScreen: React.FC<AuthScreenProps> = ({
  appConfig,
  initialMode = 'login',
  onSuccess,
  onBrowseGuest,
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'recover'>(initialMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showRegPass, setShowRegPass] = useState(false);
  const [showRegConfirmPass, setShowRegConfirmPass] = useState(false);
  const [showRecPass, setShowRecPass] = useState(false);
  const [showRecConfirmPass, setShowRecConfirmPass] = useState(false);

  // Login state
  const [loginId, setLoginId] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // Register state
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [birthDate, setBirthDate] = useState('2002-01-01');
  const [avatar, setAvatar] = useState(AVATAR_PRESETS[0]);
  const [interests, setInterests] = useState<string[]>(['فضفضة', 'مشاعر']);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);

  const [googleProfile, setGoogleProfile] = useState<{ email: string; name: string } | null>(null);
  const [recId, setRecId] = useState('');
  const [recMessage, setRecMessage] = useState('');

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      // Create temporary data URL preview for registration before auth exists
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string' && reader.result.length < 300000) {
          setAvatar(AVATAR_PRESETS[0]); // Keep preset if large, or allow upload after login
        }
      };
      reader.readAsDataURL(file);
      // Note: direct file upload works once authenticated; presets work cleanly at signup
      const uploadedUrl = await uploadMediaFile(file).catch(() => null);
      if (uploadedUrl) setAvatar(uploadedUrl);
    } catch {
      setError('يمكنك اختيار صورة من الصور الجاهزة أو رفع صورتك الخاصة بعد إنشاء الحساب.');
    }
  };

  const toggleInterest = (item: string) => {
    setInterests((prev) =>
      prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item].slice(0, 10)
    );
  };

  const finishSignIn = async (customToken: string) => {
    await signInWithCustomToken(getFirebaseAuth(), customToken);
    const me = await apiRequest<{ user: User | null }>('/auth/me');
    if (!me.user) throw new Error('تعذر تحميل الحساب بعد تسجيل الدخول.');
    onSuccess(me.user);
  };

  const authErrorMessage = (err: unknown, fallback: string) => {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
    if (code === 'auth/popup-blocked') return 'المتصفح منع نافذة جوجل. اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى.';
    if (code === 'auth/unauthorized-domain') return 'هذا الدومين غير مصرح له بتسجيل الدخول بجوجل بعد. أضفه في Firebase Authentication (Authorized domains).';
    if (code === 'auth/network-request-failed') return 'تعذر الاتصال بالإنترنت. تحقق من الشبكة وحاول مرة أخرى.';
    return err instanceof Error ? err.message : fallback;
  };

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      const cred = await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
      const me = await apiRequest<{ user: User | null; needsProfile?: boolean }>('/auth/me');
      if (me.user) {
        onSuccess(me.user);
      } else {
        setGoogleProfile({ email: cred.user.email || '', name: cred.user.displayName || '' });
        setDisplayName((cred.user.displayName || '').slice(0, 40));
      }
    } catch (err) {
      const msg = authErrorMessage(err, 'تعذر تسجيل الدخول بجوجل.');
      if (msg) setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteGoogle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const userCheck = validateUsername(username);
    if (!userCheck.valid) return void setError(userCheck.error || 'اسم المستخدم غير صالح.');
    if (displayName.trim().length < 2) return void setError('الاسم المستعار يجب أن يكون حرفين على الأقل.');
    const ageCheck = checkMinimumAge(birthDate, 13);
    if (!ageCheck.valid) return void setError(ageCheck.error || 'تاريخ الميلاد غير مناسب.');
    if (!termsAccepted) return void setError('يجب الموافقة على الشروط وسياسة الخصوصية أولًا.');
    setLoading(true);
    try {
      const res = await apiRequest<{ user: User }>('/auth/complete-profile', {
        method: 'POST',
        body: { displayName: displayName.trim(), username: userCheck.value, birthDate, avatar, interests, termsAccepted },
      });
      onSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إكمال الحساب.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ customToken: string }>('/auth/login', {
        method: 'POST',
        body: { identifier: loginId, password: loginPass },
      });
      await finishSignIn(res.customToken);
    } catch (err) {
      setError(authErrorMessage(err, 'تعذر تسجيل الدخول.'));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanDisplay = displayName.trim();
    if (cleanDisplay.length < 2 || cleanDisplay.length > 40) {
      setError('الاسم المستعار يجب أن يكون بين حرفين و40 حرفًا.');
      return;
    }
    const userCheck = validateUsername(username);
    if (!userCheck.valid) {
      setError(userCheck.error || 'اسم المستخدم غير صالح.');
      return;
    }
    if (!email.trim() || !validateEmail(email)) {
      setError('يرجى إدخال بريد إلكتروني صحيح.');
      return;
    }
    if (phone.trim() && !validatePhone(phone)) {
      setError('رقم الهاتف غير صالح.');
      return;
    }
    const passCheck = validatePassword(password);
    if (!passCheck.valid) {
      setError(passCheck.error || 'كلمة المرور غير صالحة.');
      return;
    }
    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }
    const ageCheck = checkMinimumAge(birthDate, 13);
    if (!ageCheck.valid) {
      setError(ageCheck.error || 'تاريخ الميلاد غير مناسب.');
      return;
    }
    if (!termsAccepted) {
      setError('يجب الموافقة على الشروط وسياسة الخصوصية أولًا.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest<{ customToken: string; user: User }>(
        '/auth/register',
        {
          method: 'POST',
          body: {
            displayName: cleanDisplay,
            username: userCheck.value,
            email: email.trim().toLowerCase(),
            phone: phone.trim(),
            password,
            confirmPassword,
            birthDate,
            avatar,
            interests,
            termsAccepted,
            rememberMe: true,
          },
        }
      );
      await finishSignIn(res.customToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الحساب.');
    } finally {
      setLoading(false);
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setRecMessage('');
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string }>('/auth/recover', {
        method: 'POST',
        body: { identifier: recId },
      });
      setRecMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال رابط الاستعادة.');
    } finally {
      setLoading(false);
    }
  };

  if (googleProfile) {
    const input = 'w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm';
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F7FB] dark:bg-[#09090D] p-4">
        <form onSubmit={handleCompleteGoogle} className="w-full max-w-md rounded-3xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 p-6 shadow-xl space-y-3.5">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">أكمل حسابك في مين؟</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400" dir="ltr">{googleProfile.email}</p>
          {error && <div role="alert" className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-500">{error}</div>}
          <input aria-label="الاسم المستعار" placeholder="الاسم المستعار" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={input} />
          <input aria-label="اسم المستخدم" placeholder="اسم المستخدم (إنجليزي)" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} className={input} />
          <input aria-label="تاريخ الميلاد" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={input} />
          <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} className="mt-0.5" />
            <span>أوافق على الشروط وسياسة الخصوصية.</span>
          </label>
          <button type="submit" disabled={loading} className="w-full min-h-[48px] rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-semibold text-sm">
            {loading ? 'جاري الحفظ...' : 'ابدأ الآن'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F7FB] dark:bg-[#09090D] text-slate-900 dark:text-[#F4F3FA] flex items-center justify-center p-4">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 rounded-3xl overflow-hidden bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 shadow-2xl">
        {/* Brand Panel */}
        <div className="lg:col-span-5 bg-[#12121A] text-white p-6 lg:p-8 flex flex-col justify-between relative overflow-hidden border-b lg:border-b-0 lg:border-l border-white/10">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <img
                src="/src/assets/images/meen_brand_emblem_1795731517188.jpg"
                alt="شعار مين؟"
                referrerPolicy="no-referrer"
                className="w-12 h-12 rounded-2xl object-cover border border-violet-500/30"
              />
              <div>
                <h1 className="font-display text-2xl font-extrabold tracking-tight">
                  مين؟ <span className="text-violet-400 font-mono text-base">MEEN</span>
                </h1>
                <p className="text-xs text-slate-400">احكي اللي جواك.</p>
              </div>
            </div>

            <h2 className="font-display text-xl lg:text-2xl font-bold leading-snug mb-3">
              مساحتك الآمنة للفضفضة والتواصل الحقيقي
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              شارك مشاعرك وقصصك باسمك أو كمجهول تمامًا، اطرح أسئلتك، وانضم لمجتمعات تشبهك دون قلق أو تتبع لهويتك.
            </p>
          </div>

          <div className="mt-8 space-y-3 text-xs text-slate-300">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-violet-400 shrink-0" />
              <span>حماية كاملة لهوية المنشورات المجهولة في النظام</span>
            </div>
            <div className="flex items-center gap-2.5">
              <UserCheck className="w-4 h-4 text-violet-400 shrink-0" />
              <span>حظر وإبلاغ فوري وضوابط خصوصية لكل حساب</span>
            </div>
          </div>
        </div>

        {/* Auth Forms Panel */}
        <div className="lg:col-span-7 p-6 lg:p-8">
          {/* Segmented Mode Switch */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-white/5 mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`flex-1 min-h-[42px] rounded-lg text-sm font-semibold transition-colors ${
                mode === 'login'
                  ? 'bg-white dark:bg-[#1A1A26] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              تسجيل الدخول
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`flex-1 min-h-[42px] rounded-lg text-sm font-semibold transition-colors ${
                mode === 'register'
                  ? 'bg-white dark:bg-[#1A1A26] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              إنشاء حساب
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-sm text-rose-600 dark:text-rose-300"
            >
              {error}
            </div>
          )}

          {mode !== 'recover' && (
            <div className="mb-5">
              <button
                type="button"
                onClick={handleGoogle}
                disabled={loading}
                data-testid="google-signin"
                className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-white/15 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-60 text-slate-800 dark:text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <svg viewBox="0 0 48 48" className="w-5 h-5" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/>
                  <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.1z"/>
                  <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
                </svg>
                <span>المتابعة بحساب جوجل</span>
              </button>
              <div className="flex items-center gap-3 my-4 text-[11px] text-slate-400">
                <span className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
                <span>أو بالبريد وكلمة المرور</span>
                <span className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
              </div>
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="login-identifier"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  اسم المستخدم، البريد الإلكتروني، أو رقم الهاتف
                </label>
                <input
                  id="login-identifier"
                  type="text"
                  required
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="مثال: ahmed_99 أو mail@example.com أو 201012345678+"
                  className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3.5 text-sm focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  كلمة المرور
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPass ? 'text' : 'password'}
                    required
                    value={loginPass}
                    onChange={(e) => setLoginPass(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3.5 pl-11 text-sm focus:outline-none focus:border-violet-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute left-1 top-1/2 -translate-y-1/2 min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-400 hover:text-slate-200"
                    aria-label={showPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 accent-violet-600 rounded"
                  />
                  <span>تذكر تسجيل الدخول</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setMode('recover');
                    setError('');
                  }}
                  className="text-violet-600 dark:text-violet-400 hover:underline font-medium min-h-[36px]"
                >
                  نسيت كلمة المرور؟
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[48px] rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
              >
                {loading ? 'جاري الدخول...' : 'دخول إلى مين؟'}
              </button>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3.5 max-h-[68vh] overflow-y-auto pl-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="reg-display"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    الاسم المستعار
                  </label>
                  <input
                    id="reg-display"
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="مثال: سارة محمود"
                    className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="reg-username"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    اسم المستخدم (فريد)
                  </label>
                  <input
                    id="reg-username"
                    type="text"
                    required
                    dir="ltr"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="sara_24"
                    className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm font-mono text-left focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              {/* Email (required) + Optional Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="reg-email"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    البريد الإلكتروني
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    required
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm text-left focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="reg-phone"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    رقم الهاتف (اختياري)
                  </label>
                  <input
                    id="reg-phone"
                    type="tel"
                    dir="ltr"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+201012345678"
                    className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm text-left font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="reg-pass"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    كلمة المرور (8 أحرف+)
                  </label>
                  <div className="relative">
                    <input
                      id="reg-pass"
                      type={showRegPass ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 pl-10 text-sm focus:outline-none focus:border-violet-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPass((v) => !v)}
                      className="absolute left-1 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-200"
                      aria-label={showRegPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    >
                      {showRegPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="reg-confirm"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    تأكيد كلمة المرور
                  </label>
                  <div className="relative">
                    <input
                      id="reg-confirm"
                      type={showRegConfirmPass ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 pl-10 text-sm focus:outline-none focus:border-violet-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegConfirmPass((v) => !v)}
                      className="absolute left-1 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-200"
                      aria-label={showRegConfirmPass ? 'إخفاء تأكيد كلمة المرور' : 'إظهار تأكيد كلمة المرور'}
                    >
                      {showRegConfirmPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label
                  htmlFor="reg-birth"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  تاريخ الميلاد (للتحقق من العمر المناسب +13)
                </label>
                <input
                  id="reg-birth"
                  type="date"
                  required
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm focus:outline-none focus:border-violet-500"
                />
              </div>

              {/* Avatar Picker */}
              <div>
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  الصورة الرمزية (Avatar)
                </span>
                <div className="flex items-center gap-3 flex-wrap">
                  {AVATAR_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAvatar(preset)}
                      className={`w-12 h-12 rounded-2xl overflow-hidden border-2 transition-transform ${
                        avatar === preset
                          ? 'border-violet-500 scale-105'
                          : 'border-transparent opacity-70 hover:opacity-100'
                      }`}
                      aria-label="اختيار صورة رمزية"
                    >
                      <img src={preset} alt="أفاتار" className="w-full h-full object-cover" />
                    </button>
                  ))}
                  <label className="min-h-[44px] px-3 rounded-xl border border-dashed border-slate-300 dark:border-white/20 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-300 cursor-pointer hover:border-violet-500">
                    <Upload className="w-4 h-4" />
                    <span>تخصيص لاحقًا</span>
                    <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                  </label>
                </div>
              </div>

              {/* Interests */}
              <div>
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  اختر اهتماماتك ({interests.length})
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {INTEREST_OPTIONS.map((item) => {
                    const active = interests.includes(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => toggleInterest(item)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          active
                            ? 'bg-violet-600 text-white'
                            : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10'
                        }`}
                      >
                        {item}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-start gap-2 pt-1">
                <input
                  id="reg-terms"
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-violet-600 rounded"
                />
                <label htmlFor="reg-terms" className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  أوافق على{' '}
                  <button
                    type="button"
                    onClick={() => setShowPolicyModal(true)}
                    className="text-violet-600 dark:text-violet-400 underline font-semibold"
                  >
                    الشروط وسياسة الخصوصية والأمان
                  </button>
                  .
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[48px] rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
              >
                {loading ? 'جاري إنشاء الحساب...' : 'إنشاء حساب في مين؟'}
              </button>
            </form>
          )}

          {mode === 'recover' && (
            <form onSubmit={handleRecover} className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
                className="inline-flex items-center gap-1.5 text-xs text-violet-500 hover:underline"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>العودة لتسجيل الدخول</span>
              </button>

              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-white">
                <KeyRound className="w-4 h-4 text-violet-500" />
                <span>استعادة كلمة المرور عبر البريد الإلكتروني</span>
              </div>

              {recMessage && (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-600 dark:text-emerald-300">
                  {recMessage}
                </div>
              )}

              <div>
                <label
                  htmlFor="rec-id"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  اسم المستخدم أو البريد أو الهاتف
                </label>
                <input
                  id="rec-id"
                  type="text"
                  required
                  value={recId}
                  onChange={(e) => setRecId(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[48px] rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
              >
                {loading ? 'جاري الإرسال...' : 'أرسل رابط إعادة التعيين'}
              </button>
            </form>
          )}

          {onBrowseGuest && (
            <div className="mt-5 pt-4 border-t border-slate-200 dark:border-white/10 text-center">
              <button
                type="button"
                onClick={onBrowseGuest}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-violet-500 transition-colors min-h-[36px]"
              >
                تصفح المنشورات والمجتمعات العامة كزائر
              </button>
            </div>
          )}
        </div>
      </div>

      {showPolicyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 p-5 space-y-4">
            <h3 className="font-display text-lg font-bold">الشروط وسياسة الخصوصية</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {appConfig.termsText}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {appConfig.privacyText}
            </p>
            <button
              type="button"
              onClick={() => setShowPolicyModal(false)}
              className="w-full min-h-[44px] rounded-xl bg-violet-600 text-white text-sm font-semibold"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

import { signOut } from 'firebase/auth';
import { getFirebaseAuth } from '../lib/firebase/config';
import React, { useEffect, useState } from 'react';
import {
  Award,
  Bell,
  BellRing,
  Eye,
  EyeOff,
  HelpCircle,
  Image as ImageIcon,
  Lock,
  LogOut,
  Moon,
  Settings,
  Shield,
  Sun,
  Trash2,
  User as UserIcon,
  Users,
} from 'lucide-react';
import { apiRequest, uploadMediaFile } from '../lib/api';
import { BADGE_CATALOG, LEVELS } from '../lib/gamification';
import { PWAInstallButton } from '../components/PWAInstallButton';
import type { AppConfig, AppSection, User } from '../types';

interface SettingsHelpViewProps {
  initialTab: 'settings' | 'help' | 'gamification';
  currentUser: User | null;
  appConfig: AppConfig;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onUserUpdated: (user: User) => void;
  onLoggedOut: () => void;
  onNavigate: (section: AppSection) => void;
  onToast: (msg: string) => void;
}

const FAQ_ITEMS = [
  {
    q: 'هل هويتي محمية عند نشر فضفضة كمجهول؟',
    a: 'نعم بالكامل. عند اختيار «مجهول داخل التطبيق»، يقوم السيرفر بإزالة معرفك واسمك وصورتك من جميع الاستجابات العامة ولا يستطيع أي مستخدم معرفة صاحب المنشور.',
  },
  {
    q: 'كيف أغيّر من يستطيع مراسلتي أو رؤية منشوراتي؟',
    a: 'من تبويب الخصوصية داخل الإعدادات، يمكنك تحديد استقبال الرسائل من الجميع أو الأصدقاء فقط أو إيقافها، وكذلك التحكم في ظهور ملفك الشخصي.',
  },
  {
    q: 'كيف أحصل على النقاط والشارات؟',
    a: 'تكسب النقاط من المشاركات الإيجابية، دعم الآخرين، الإجابة على الأسئلة، سؤال اليوم، والتحديات. يمنع النظام منح نقاط على المحتوى المكرر أو السبام.',
  },
  {
    q: 'ماذا أفعل إذا واجهت إساءة أو تحرشًا؟',
    a: 'استخدم زر الإبلاغ فورًا أو قم بحظر المستخدم من ملفه الشخصي أو من داخل المحادثة، وسيقوم فريق الإشراف بمراجعة البلاغ.',
  },
];

const signOutFirebase = () => signOut(getFirebaseAuth()).catch(() => {});

export const SettingsHelpView: React.FC<SettingsHelpViewProps> = ({
  initialTab,
  currentUser,
  appConfig,
  darkMode,
  onToggleDarkMode,
  onUserUpdated,
  onLoggedOut,
  onNavigate,
  onToast,
}) => {
  const [tab, setTab] = useState<'account' | 'privacy' | 'notifications' | 'safety' | 'gamification' | 'help'>(
    initialTab === 'help'
      ? 'help'
      : initialTab === 'gamification'
        ? 'gamification'
        : 'account'
  );

  useEffect(() => {
    if (initialTab === 'help') setTab('help');
    else if (initialTab === 'gamification') setTab('gamification');
    else if (tab === 'help' || tab === 'gamification') setTab('account');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  // Account form state
  const [displayName, setDisplayName] = useState(currentUser?.displayName || '');
  const [username, setUsername] = useState(currentUser?.username || '');
  const [bio, setBio] = useState(currentUser?.bio || '');
  const [email, setEmail] = useState(currentUser?.email || '');
  const [phone, setPhone] = useState(currentUser?.phone || '');
  const [avatar, setAvatar] = useState(currentUser?.avatar || '');

  // Password change
  const [currPass, setCurrPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confPass, setConfPass] = useState('');
  const [showPassChange, setShowPassChange] = useState(false);

  // Delete account
  const [delPass, setDelPass] = useState('');
  const [showDelBox, setShowDelBox] = useState(false);

  // Privacy & Notification state
  const [privacyLevel, setPrivacyLevel] = useState<'public' | 'friends' | 'limited'>(
    currentUser?.privacyLevel || 'public'
  );
  const [showActivity, setShowActivity] = useState(currentUser?.showActivity ?? true);
  const [allowMessagesFrom, setAllowMessagesFrom] = useState<'everyone' | 'friends' | 'none'>(
    currentUser?.allowMessagesFrom || 'everyone'
  );
  const [allowCommentsFrom, setAllowCommentsFrom] = useState<'everyone' | 'friends' | 'none'>(
    currentUser?.allowCommentsFrom || 'everyone'
  );
  const [showPostsTo, setShowPostsTo] = useState<'everyone' | 'friends' | 'only_me'>(
    currentUser?.showPostsTo || 'everyone'
  );
  const [notifyPrefs, setNotifyPrefs] = useState<Record<string, boolean>>({
    messages: true,
    comments: true,
    reactions: true,
    friends: true,
    communities: true,
    challenges: true,
    instantAlerts: true,
    friendsOnlyInstantAlerts: false,
    ...(currentUser?.notifyPrefs || {}),
  });
  const [browserPerm, setBrowserPerm] = useState<string>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );

  useEffect(() => {
    if (currentUser?.notifyPrefs) {
      setNotifyPrefs((prev) => ({ ...prev, ...currentUser.notifyPrefs }));
    }
  }, [currentUser?.notifyPrefs]);

  // Safety: blocked users & past reports
  const [blockedUsers, setBlockedUsers] = useState<
    Array<{ id: number; username: string; display_name: string; avatar: string }>
  >([]);
  const [myReports, setMyReports] = useState<
    Array<{ id: number; target_type: string; reason: string; status: string; created_at: string }>
  >([]);

  // Help / Support form
  const [supCategory, setSupCategory] = useState('مشكلة تقنية');
  const [supSubject, setSupSubject] = useState('');
  const [supDesc, setSupDesc] = useState('');
  const [supImg, setSupImg] = useState<string | null>(null);

  useEffect(() => {
    if (tab === 'safety' && currentUser) {
      apiRequest<{ blocked: typeof blockedUsers }>('/blocks')
        .then((res) => setBlockedUsers(res.blocked))
        .catch(() => {});
      apiRequest<{ reports: typeof myReports }>('/reports/mine')
        .then((res) => setMyReports(res.reports))
        .catch(() => {});
    }
  }, [tab, currentUser]);

  const saveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ user: User }>('/account/profile', {
        method: 'PATCH',
        body: { displayName, username, bio, email, phone, avatar },
      });
      onUserUpdated(res.user);
      onToast('تم تحديث بيانات الحساب.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر التحديث.');
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ message: string }>('/account/password', {
        method: 'POST',
        body: { currentPassword: currPass, newPassword: newPass, confirmPassword: confPass },
      });
      setCurrPass('');
      setNewPass('');
      setConfPass('');
      onToast(res.message);
      await signOutFirebase();
      onLoggedOut();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تغيير كلمة المرور.');
    }
  };

  const savePrivacy = async (nextNotifyPrefs?: Record<string, boolean>) => {
    try {
      const res = await apiRequest<{ user: User }>('/account/privacy', {
        method: 'PATCH',
        body: {
          privacyLevel,
          showActivity,
          allowMessagesFrom,
          allowCommentsFrom,
          showPostsTo,
          notifyPrefs: nextNotifyPrefs || notifyPrefs,
        },
      });
      onUserUpdated(res.user);
      onToast('تم حفظ إعدادات الخصوصية والإشعارات.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر الحفظ.');
    }
  };

  const handleUnblock = async (id: number) => {
    await apiRequest(`/blocks/${id}`, { method: 'DELETE' });
    setBlockedUsers((prev) => prev.filter((u) => u.id !== id));
    onToast('تم فك الحظر.');
  };

  const handleLogout = async () => {
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => {});
    await signOutFirebase();
    onLoggedOut();
  };

  const handleLogoutAll = async () => {
    await apiRequest('/account/logout-all', { method: 'POST' }).catch(() => {});
    await signOutFirebase();
    onLoggedOut();
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/account', { method: 'DELETE', body: { password: delPass } });
      await signOutFirebase();
      onToast('تم حذف الحساب نهائيًا.');
      onLoggedOut();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر حذف الحساب.');
    }
  };

  const handleSupportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/support', {
        method: 'POST',
        body: { category: supCategory, subject: supSubject, description: supDesc, imageUrl: supImg },
      });
      setSupSubject('');
      setSupDesc('');
      setSupImg(null);
      onToast('تم إرسال رسالتك إلى فريق الدعم وسيتم الرد عليها.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر إرسال الطلب.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Navigation Tabs */}
      <div className="flex items-center flex-wrap gap-1.5 pb-1">
        {(
          [
            ...(currentUser
              ? [
                  { id: 'account' as const, label: 'الحساب', icon: UserIcon },
                  { id: 'privacy' as const, label: 'الخصوصية', icon: Lock },
                  { id: 'notifications' as const, label: 'الإشعارات', icon: Bell },
                  { id: 'safety' as const, label: 'الأمان والحظر', icon: Shield },
                ]
              : []),
            { id: 'gamification' as const, label: 'النقاط والمستويات', icon: Award },
            { id: 'help' as const, label: 'الدعم والمساعدة', icon: HelpCircle },
          ]
        ).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                tab === t.id
                  ? 'bg-violet-600 text-white'
                  : 'bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Theme & PWA Install Strip */}
      <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Settings className="w-4 h-4 text-violet-500" />
          <span>المظهر وتثبيت التطبيق</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleDarkMode}
            className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-semibold flex items-center gap-1.5"
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            <span>{darkMode ? 'الوضع الفاتح' : 'الوضع الداكن'}</span>
          </button>
          <PWAInstallButton />
        </div>
      </div>

      {tab === 'account' && currentUser && (
        <div className="space-y-4">
          <form
            onSubmit={saveAccount}
            className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3"
          >
            <h3 className="font-display text-base font-bold">بيانات الحساب</h3>

            <div className="flex items-center gap-3">
              <img src={avatar} alt={displayName} className="w-14 h-14 rounded-2xl object-cover" />
              <label className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-white/10 flex items-center gap-1.5 text-xs cursor-pointer">
                <ImageIcon className="w-4 h-4 text-violet-500" />
                <span>تغيير الصورة الرمزية</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      const url = await uploadMediaFile(f);
                      setAvatar(url);
                    }
                  }}
                  className="hidden"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">الاسم المستعار</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">اسم المستخدم</label>
                <input
                  type="text"
                  dir="ltr"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm font-mono text-left"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">البريد الإلكتروني</label>
                <input
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm text-left"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">رقم الهاتف</label>
                <input
                  type="tel"
                  dir="ltr"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm font-mono text-left"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">نبذة تعريفية</label>
              <textarea
                rows={2}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 p-3 text-sm"
              />
            </div>

            <button
              type="submit"
              className="min-h-[44px] px-5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
            >
              حفظ التعديلات
            </button>
          </form>

          <form
            onSubmit={savePassword}
            className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold">تغيير كلمة المرور</h3>
              <button
                type="button"
                onClick={() => setShowPassChange((v) => !v)}
                className="text-xs text-slate-400 hover:text-violet-400 flex items-center gap-1"
              >
                {showPassChange ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                <span>{showPassChange ? 'إخفاء' : 'إظهار'}</span>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                type={showPassChange ? 'text' : 'password'}
                required
                value={currPass}
                onChange={(e) => setCurrPass(e.target.value)}
                placeholder="كلمة المرور الحالية"
                className="min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
              />
              <input
                type={showPassChange ? 'text' : 'password'}
                required
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="كلمة المرور الجديدة"
                className="min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
              />
              <input
                type={showPassChange ? 'text' : 'password'}
                required
                value={confPass}
                onChange={(e) => setConfPass(e.target.value)}
                placeholder="تأكيد الجديدة"
                className="min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
              />
            </div>
            <button
              type="submit"
              className="min-h-[42px] px-4 rounded-xl bg-slate-800 dark:bg-white/10 text-white text-xs font-semibold"
            >
              تحديث كلمة المرور
            </button>
          </form>

          {/* Session & Delete */}
          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleLogout}
                className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold flex items-center gap-1.5"
              >
                <LogOut className="w-4 h-4" />
                <span>تسجيل الخروج</span>
              </button>
              <button
                type="button"
                onClick={handleLogoutAll}
                className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold"
              >
                تسجيل الخروج من كل الأجهزة
              </button>
              <button
                type="button"
                onClick={() => onNavigate('admin')}
                className="min-h-[42px] px-4 rounded-xl border border-violet-500/30 text-violet-500 text-xs font-semibold"
              >
                بوابة الإدارة
              </button>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-white/8">
              <button
                type="button"
                onClick={() => setShowDelBox((v) => !v)}
                className="text-xs text-rose-500 font-semibold flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف الحساب نهائيًا</span>
              </button>
              {showDelBox && (
                <form onSubmit={handleDeleteAccount} className="mt-3 flex items-center gap-2">
                  <input
                    type="password"
                    required
                    value={delPass}
                    onChange={(e) => setDelPass(e.target.value)}
                    placeholder="اكتب كلمة المرور للتأكيد"
                    className="flex-1 min-h-[40px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-rose-500/40 px-3 text-xs"
                  />
                  <button
                    type="submit"
                    className="min-h-[40px] px-4 rounded-xl bg-rose-600 text-white text-xs font-semibold"
                  >
                    تأكيد الحذف
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'privacy' && currentUser && (
        <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-4">
          <h3 className="font-display text-base font-bold">إعدادات الخصوصية</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-semibold mb-1">ظهور الملف الشخصي</label>
              <select
                value={privacyLevel}
                onChange={(e) => setPrivacyLevel(e.target.value as 'public' | 'friends' | 'limited')}
                className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3"
              >
                <option value="public">عام</option>
                <option value="friends">الأصدقاء فقط</option>
                <option value="limited">محدود</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">من يستطيع مراسلتي</label>
              <select
                value={allowMessagesFrom}
                onChange={(e) =>
                  setAllowMessagesFrom(e.target.value as 'everyone' | 'friends' | 'none')
                }
                className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3"
              >
                <option value="everyone">الجميع</option>
                <option value="friends">الأصدقاء فقط</option>
                <option value="none">عدم استقبال رسائل</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">من يستطيع التعليق</label>
              <select
                value={allowCommentsFrom}
                onChange={(e) =>
                  setAllowCommentsFrom(e.target.value as 'everyone' | 'friends' | 'none')
                }
                className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3"
              >
                <option value="everyone">الجميع</option>
                <option value="friends">الأصدقاء فقط</option>
                <option value="none">لا أحد</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">من يرى منشوراتي العامة</label>
              <select
                value={showPostsTo}
                onChange={(e) =>
                  setShowPostsTo(e.target.value as 'everyone' | 'friends' | 'only_me')
                }
                className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3"
              >
                <option value="everyone">الجميع</option>
                <option value="friends">الأصدقاء فقط</option>
                <option value="only_me">أنا فقط</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={!showActivity}
              onChange={(e) => setShowActivity(!e.target.checked)}
              className="accent-violet-600"
            />
            <span>إخفاء حالة النشاط (متصل الآن)</span>
          </label>

          <button
            type="button"
            onClick={() => savePrivacy()}
            className="min-h-[44px] px-5 rounded-xl bg-violet-600 text-white text-xs font-semibold"
          >
            حفظ الخصوصية
          </button>
        </div>
      )}

      {tab === 'notifications' && currentUser && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-violet-500/30 p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <BellRing className="w-5 h-5 text-violet-500" />
                <h3 className="font-display text-base font-bold">التنبيهات الفورية المباشرة</h3>
              </div>
              {browserPerm !== 'unsupported' && browserPerm !== 'granted' && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const perm = await Notification.requestPermission();
                      setBrowserPerm(perm);
                      if (perm === 'granted') {
                        onToast('تم تفعيل إشعارات المتصفح الفورية.');
                      }
                    } catch {
                      // Ignore permission failure
                    }
                  }}
                  className="min-h-[34px] px-3 rounded-xl bg-violet-600/15 text-violet-500 text-xs font-semibold"
                >
                  تفعيل تنبيهات المتصفح
                </button>
              )}
            </div>

            <label className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 dark:border-white/5 cursor-pointer">
              <div>
                <p className="text-sm font-semibold">تفعيل التنبيهات الفورية داخل التطبيق</p>
                <p className="text-xs text-slate-400">
                  عرض إشعار مباشر فور وصول التفاعلات والردود والرسائل الجديدة.
                </p>
              </div>
              <input
                type="checkbox"
                checked={notifyPrefs.instantAlerts !== false}
                onChange={(e) => {
                  const next = { ...notifyPrefs, instantAlerts: e.target.checked };
                  setNotifyPrefs(next);
                  savePrivacy(next);
                }}
                aria-label="تفعيل التنبيهات الفورية داخل التطبيق"
                className="w-4 h-4 accent-violet-600 shrink-0"
              />
            </label>

            <label className="flex items-center justify-between gap-3 py-2 cursor-pointer">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold flex items-center gap-1.5 text-violet-400">
                  <Users className="w-4 h-4" />
                  <span>تنبيهات فورية (الأصدقاء المضافون فقط)</span>
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  عند تفعيله، تصلك تنبيهات فورية فقط عند قيام الأصدقاء المضافين بالتفاعل مع منشوراتك أو التعليق والرد عليك.
                </p>
              </div>
              <input
                type="checkbox"
                checked={notifyPrefs.friendsOnlyInstantAlerts === true}
                onChange={(e) => {
                  const next = { ...notifyPrefs, friendsOnlyInstantAlerts: e.target.checked };
                  setNotifyPrefs(next);
                  savePrivacy(next);
                }}
                aria-label="تنبيهات فورية للأصدقاء المضافين فقط"
                className="w-4 h-4 accent-violet-600 shrink-0"
              />
            </label>
          </div>

          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3">
            <h3 className="font-display text-base font-bold">تفضيلات أنواع الإشعارات</h3>
            {[
              { key: 'messages', label: 'الرسائل المباشرة' },
              { key: 'comments', label: 'التعليقات والردود' },
              { key: 'reactions', label: 'الإعجابات والدعم' },
              { key: 'friends', label: 'طلبات وقبول الصداقة' },
              { key: 'communities', label: 'المجتمعات' },
              { key: 'challenges', label: 'التحديات وسؤال اليوم' },
            ].map((item) => (
              <label
                key={item.key}
                className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-white/5 text-sm cursor-pointer"
              >
                <span>{item.label}</span>
                <input
                  type="checkbox"
                  checked={notifyPrefs[item.key] !== false}
                  onChange={(e) => {
                    const next = { ...notifyPrefs, [item.key]: e.target.checked };
                    setNotifyPrefs(next);
                    savePrivacy(next);
                  }}
                  className="w-4 h-4 accent-violet-600"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {tab === 'safety' && currentUser && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3">
            <h3 className="font-display text-base font-bold">المستخدمون المحظورون</h3>
            {blockedUsers.length === 0 ? (
              <p className="text-xs text-slate-400">قائمة الحظر فارغة.</p>
            ) : (
              blockedUsers.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-white/5"
                >
                  <span className="text-sm font-medium">
                    {b.display_name} (@{b.username})
                  </span>
                  <button
                    type="button"
                    onClick={() => handleUnblock(b.id)}
                    className="min-h-[36px] px-3 rounded-xl bg-slate-100 dark:bg-white/5 text-xs font-semibold"
                  >
                    إلغاء الحظر
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3">
            <h3 className="font-display text-base font-bold">بلاغاتي السابقة</h3>
            {myReports.length === 0 ? (
              <p className="text-xs text-slate-400">لم تقم بإرسال أي بلاغات.</p>
            ) : (
              myReports.map((r) => (
                <div
                  key={r.id}
                  className="text-xs flex items-center justify-between py-2 border-b border-slate-100 dark:border-white/5"
                >
                  <span>
                    {r.reason} ({r.target_type})
                  </span>
                  <span className="text-violet-500 font-semibold">
                    {r.status === 'open'
                      ? 'قيد المراجعة'
                      : r.status === 'accepted'
                        ? 'تم اتخاذ إجراء'
                        : 'مرفوض'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'gamification' && (
        <div className="space-y-4">
          {currentUser && (
            <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400">مستواك الحالي</p>
                  <h3 className="font-display text-xl font-bold text-violet-500">
                    {currentUser.level.name}
                  </h3>
                </div>
                <div className="text-left">
                  <p className="font-mono text-2xl font-bold tabular-nums">
                    {currentUser.points}
                  </p>
                  <p className="text-xs text-slate-400">نقطة</p>
                </div>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-violet-600 rounded-full"
                  style={{ width: `${currentUser.level.progressPercent}%` }}
                />
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3">
            <h3 className="font-display text-base font-bold">المستويات في مين؟</h3>
            <div className="space-y-2 text-sm">
              {LEVELS.map((lvl, idx) => (
                <div
                  key={lvl.name}
                  className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-white/5"
                >
                  <span>
                    {idx + 1}. {lvl.name}
                  </span>
                  <span className="font-mono text-xs text-slate-400 tabular-nums">
                    {lvl.minPoints}+ نقطة
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3">
            <h3 className="font-display text-base font-bold">الشارات المتاحة</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {BADGE_CATALOG.map((b) => {
                const earned = currentUser?.badges.some((ub) => ub.slug === b.slug);
                return (
                  <div
                    key={b.slug}
                    className={`rounded-xl p-3.5 border ${
                      earned
                        ? 'border-violet-500/40 bg-violet-500/10'
                        : 'border-slate-200 dark:border-white/8 opacity-75'
                    }`}
                  >
                    <p className="text-sm font-bold">
                      {b.title} {earned ? '✓' : ''}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{b.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'help' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3">
            <h3 className="font-display text-base font-bold">الأسئلة الشائعة والأمان</h3>
            <div className="space-y-3">
              {FAQ_ITEMS.map((item) => (
                <div
                  key={item.q}
                  className="rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200/70 dark:border-white/8 p-3.5"
                >
                  <p className="text-sm font-bold mb-1">{item.q}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-300 leading-relaxed">
                    {item.a}
                  </p>
                </div>
              ))}
            </div>
            <div className="pt-2 text-xs text-slate-500 dark:text-slate-400 space-y-1">
              <p className="font-bold text-slate-700 dark:text-slate-200">الشروط وسياسة الخصوصية</p>
              <p>{appConfig.termsText}</p>
              <p>{appConfig.privacyText}</p>
            </div>
          </div>

          <form
            onSubmit={handleSupportSubmit}
            className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3"
          >
            <h3 className="font-display text-base font-bold">تواصل معنا / إرسال مشكلة أو اقتراح</h3>
            <select
              value={supCategory}
              onChange={(e) => setSupCategory(e.target.value)}
              className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-xs"
            >
              <option value="مشكلة تقنية">مشكلة تقنية</option>
              <option value="مشكلة في الحساب">مشكلة في الحساب</option>
              <option value="مشكلة في الرسائل">مشكلة في الرسائل</option>
              <option value="مشكلة في المنشورات">مشكلة في المنشورات</option>
              <option value="الخصوصية والأمان">الخصوصية والأمان</option>
              <option value="اقتراح تطوير">اقتراح تطوير</option>
            </select>
            <input
              type="text"
              required
              value={supSubject}
              onChange={(e) => setSupSubject(e.target.value)}
              placeholder="عنوان المشكلة أو الاقتراح"
              className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
            />
            <textarea
              rows={3}
              required
              value={supDesc}
              onChange={(e) => setSupDesc(e.target.value)}
              placeholder="اشرح التفاصيل لمساعدتك بشكل أسرع..."
              className="w-full rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 p-3 text-sm"
            />
            <div className="flex items-center justify-between flex-wrap gap-2">
              {currentUser && (
                <label className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-white/10 flex items-center gap-1.5 text-xs cursor-pointer">
                  <ImageIcon className="w-4 h-4 text-violet-500" />
                  <span>{supImg ? 'تم إرفاق لقطة شاشة' : 'إرفاق صورة (اختياري)'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) setSupImg(await uploadMediaFile(f));
                    }}
                    className="hidden"
                  />
                </label>
              )}
              <button
                type="submit"
                className="min-h-[44px] px-5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
              >
                إرسال للإدارة
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

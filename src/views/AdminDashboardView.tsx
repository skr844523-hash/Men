import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Megaphone,
  Search,
  ShieldAlert,
  Trash2,
  Users,
} from 'lucide-react';
import { apiRequest, setMemoryToken } from '../lib/api';
import type { AppConfig, GlobalNotificationSettings, User } from '../types';

interface AdminDashboardViewProps {
  currentUser: User | null;
  appConfig: AppConfig;
  onRefreshSession: () => void;
  onToast: (msg: string) => void;
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  currentUser,
  appConfig,
  onRefreshSession,
  onToast,
}) => {
  const [adminStatus, setAdminStatus] = useState<{
    hasAdmin: boolean;
    envPasscodeConfigured: boolean;
    canBootstrap: boolean;
    designatedAdminEmail?: string;
    canPromoteCurrentUser?: boolean;
    isAdmin: boolean;
    isPrimaryAdmin?: boolean;
    isDesignatedAdmin?: boolean;
  } | null>(null);
  const [tab, setTab] = useState<
    'overview' | 'notifications' | 'users' | 'content' | 'reports' | 'support' | 'app'
  >('overview');

  // Bootstrap / Passcode form
  const [passcode, setPasscode] = useState('');
  const [bootName, setBootName] = useState('مدير مين؟');
  const [bootUser, setBootUser] = useState('meen_admin');
  const [bootEmail, setBootEmail] = useState('');
  const [bootPass, setBootPass] = useState('');
  const [bootConfirm, setBootConfirm] = useState('');
  const [claimPassword, setClaimPassword] = useState('');
  const [showBootPass, setShowBootPass] = useState(false);

  // Broadcast form
  const [broadcastTitle, setBroadcastTitle] = useState('تنبيه من إدارة مين؟');
  const [broadcastBody, setBroadcastBody] = useState('');

  // Global Platform Notification Settings (designated administrator only)
  const [globalNotif, setGlobalNotif] = useState<GlobalNotificationSettings>({
    instantAlertsEnabled: true,
    browserPushEnabled: true,
    quietModeEnabled: false,
    allowReactionNotifs: true,
    allowCommentNotifs: true,
    allowFriendNotifs: true,
    allowMessageNotifs: true,
    allowBroadcastBanner: true,
    ...(appConfig.notificationSettings || {}),
  });
  const [savingNotifCfg, setSavingNotifCfg] = useState(false);

  useEffect(() => {
    if (appConfig.notificationSettings) {
      setGlobalNotif((prev) => ({ ...prev, ...appConfig.notificationSettings }));
    }
  }, [appConfig.notificationSettings]);

  // Dashboard data
  const [overview, setOverview] = useState<{
    stats: Record<string, number>;
    recentActions: Array<Record<string, unknown>>;
  } | null>(null);
  const [usersList, setUsersList] = useState<Array<Record<string, unknown>>>([]);
  const [userSearch, setUserSearch] = useState('');
  const [contentData, setContentData] = useState<{
    posts: Array<Record<string, unknown>>;
    comments: Array<Record<string, unknown>>;
    communities: Array<Record<string, unknown>>;
  }>({ posts: [], comments: [], communities: [] });
  const [reports, setReports] = useState<Array<Record<string, unknown>>>([]);
  const [supportReqs, setSupportReqs] = useState<Array<Record<string, unknown>>>([]);

  // App management state
  const [dailyText, setDailyText] = useState('');
  const [chTitle, setChTitle] = useState('');
  const [chDesc, setChDesc] = useState('');
  const [chCat, setChCat] = useState('إيجابي');
  const [chPoints, setChPoints] = useState(20);
  const [announcement, setAnnouncement] = useState(appConfig.announcement);
  const [categoriesText, setCategoriesText] = useState(appConfig.categories.join('، '));
  const [adsEnabled, setAdsEnabled] = useState(appConfig.monetization.adsEnabled);
  const [premiumEnabled, setPremiumEnabled] = useState(appConfig.monetization.premiumEnabled);

  const loadStatus = useCallback(() => {
    apiRequest<NonNullable<typeof adminStatus>>('/admin/status')
      .then((res) => {
        setAdminStatus(res);
        if (res.designatedAdminEmail) {
          setBootEmail(res.designatedAdminEmail);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus, currentUser]);

  const loadAdminTab = useCallback(() => {
    if (!adminStatus?.isAdmin) return;
    if (tab === 'overview') {
      apiRequest<NonNullable<typeof overview>>('/admin/overview')
        .then(setOverview)
        .catch((err) => onToast(err instanceof Error ? err.message : 'تعذر التحميل.'));
    } else if (tab === 'users') {
      const q = userSearch.trim() ? `?q=${encodeURIComponent(userSearch.trim())}` : '';
      apiRequest<{ users: Array<Record<string, unknown>> }>(`/admin/users${q}`)
        .then((res) => setUsersList(res.users))
        .catch(() => {});
    } else if (tab === 'content') {
      apiRequest<typeof contentData>('/admin/content').then(setContentData).catch(() => {});
    } else if (tab === 'reports') {
      apiRequest<{ reports: Array<Record<string, unknown>> }>('/admin/reports')
        .then((res) => setReports(res.reports))
        .catch(() => {});
    } else if (tab === 'support') {
      apiRequest<{ requests: Array<Record<string, unknown>> }>('/admin/support')
        .then((res) => setSupportReqs(res.requests))
        .catch(() => {});
    }
  }, [adminStatus?.isAdmin, tab, userSearch, onToast]);

  useEffect(() => {
    loadAdminTab();
  }, [loadAdminTab]);

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ token?: string; recoveryCode?: string }>('/admin/bootstrap', {
        method: 'POST',
        body: currentUser
          ? { password: claimPassword }
          : {
              displayName: bootName,
              username: bootUser,
              email: bootEmail,
              password: bootPass,
              confirmPassword: bootConfirm,
              birthDate: '1998-01-01',
            },
      });
      if (res.token) setMemoryToken(res.token);
      setClaimPassword('');
      onToast(
        res.recoveryCode
          ? `تم إنشاء حساب الإدارة بنجاح! رمز الاستعادة: ${res.recoveryCode}`
          : 'تمت ترقية حسابك كمسؤول للنظام.'
      );
      onRefreshSession();
      loadStatus();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر إعداد حساب الإدارة.');
    }
  };

  const handleVerifyPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/admin/verify-passcode', { method: 'POST', body: { passcode } });
      onToast('تم التحقق من صلاحية الإدارة.');
      onRefreshSession();
      loadStatus();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'رمز غير صحيح.');
    }
  };

  if (!adminStatus) {
    return <div className="h-44 rounded-2xl bg-white dark:bg-[#12121A] animate-pulse" />;
  }

  // Not yet admin -> show First-Run Setup or Passcode gate or Access Denied
  if (!adminStatus.isAdmin) {
    if (adminStatus.canBootstrap) {
      const designatedEmail = adminStatus.designatedAdminEmail || 'غير محدد في إعدادات السيرفر';
      return (
        <div className="max-w-md mx-auto rounded-3xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 p-6 space-y-4">
          <div className="flex items-center gap-2 text-violet-500">
            <KeyRound className="w-5 h-5" />
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              تفعيل حساب الأدمن المعتمد
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-300 leading-relaxed">
            بوابة الإدارة مخصصة للبريد الإداري المعتمد{' '}
            <span className="font-mono text-violet-400" dir="ltr">
              {designatedEmail}
            </span>
            . أنشئ كلمة المرور الخاصة بك مباشرة هنا لتفعيل الصلاحية بأمان (يُغلق هذا الخيار تلقائيًا بعد التفعيل).
          </p>

          {currentUser && !adminStatus.canPromoteCurrentUser ? (
            <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-4 text-xs text-rose-300 leading-relaxed">
              أنت مسجل حاليًا بالبريد ({currentUser.email || currentUser.username}). لتفعيل الإدارة، سجّل الخروج ثم ادخل من هنا بحساب{' '}
              <span className="font-mono" dir="ltr">
                {designatedEmail}
              </span>
              .
            </div>
          ) : (
            <form onSubmit={handleBootstrap} className="space-y-3">
              {currentUser ? (
                <>
                  <p className="text-xs text-slate-300">
                    تم التحقق من البريد الإداري ({designatedEmail}). أدخل كلمة مرور حسابك لتفعيل صلاحيات الأدمن:
                  </p>
                  <div className="relative">
                    <input
                      type={showBootPass ? 'text' : 'password'}
                      required
                      value={claimPassword}
                      onChange={(e) => setClaimPassword(e.target.value)}
                      placeholder="كلمة مرور الحساب"
                      className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 pl-10 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowBootPass((v) => !v)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      aria-label={showBootPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    >
                      {showBootPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    required
                    value={bootName}
                    onChange={(e) => setBootName(e.target.value)}
                    placeholder="الاسم المستعار"
                    className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
                  />
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={bootUser}
                    onChange={(e) => setBootUser(e.target.value)}
                    placeholder="admin_username"
                    className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm font-mono text-left"
                  />
                  <input
                    type="email"
                    required
                    readOnly
                    dir="ltr"
                    value={bootEmail}
                    className="w-full min-h-[42px] rounded-xl bg-slate-100 dark:bg-white/5 border border-violet-500/30 px-3 text-sm text-left text-violet-300 font-mono"
                  />
                  <div className="relative">
                    <input
                      type={showBootPass ? 'text' : 'password'}
                      required
                      value={bootPass}
                      onChange={(e) => setBootPass(e.target.value)}
                      placeholder="كلمة المرور التي تختارها (8 أحرف+)"
                      className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 pl-10 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowBootPass((v) => !v)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      aria-label={showBootPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    >
                      {showBootPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <input
                    type={showBootPass ? 'text' : 'password'}
                    required
                    value={bootConfirm}
                    onChange={(e) => setBootConfirm(e.target.value)}
                    placeholder="تأكيد كلمة المرور"
                    className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
                  />
                </>
              )}
              <button
                type="submit"
                className="w-full min-h-[44px] rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold"
              >
                تفعيل صلاحيات الأدمن
              </button>
            </form>
          )}
        </div>
      );
    }

    if (adminStatus.envPasscodeConfigured && currentUser) {
      return (
        <div className="max-w-md mx-auto rounded-3xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 p-6 space-y-4">
          <h2 className="font-display text-lg font-bold">التحقق من رمز الإدارة</h2>
          <form onSubmit={handleVerifyPasscode} className="space-y-3">
            <input
              type="password"
              required
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="أدخل رمز الإدارة"
              className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
            />
            <button
              type="submit"
              className="w-full min-h-[44px] rounded-xl bg-violet-600 text-white text-sm font-semibold"
            >
              دخول لوحة الإدارة
            </button>
          </form>
        </div>
      );
    }

    return (
      <div className="rounded-3xl bg-white dark:bg-[#12121A] border border-rose-500/30 p-8 text-center space-y-2">
        <ShieldAlert className="w-10 h-10 text-rose-500 mx-auto" />
        <h2 className="font-display text-lg font-bold">وصول محظور</h2>
        <p className="text-xs text-slate-400">
          لوحة الإدارة مخصصة للمشرفين ومسؤولي النظام فقط.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-4 flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-lg font-bold flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-violet-500" />
          <span>لوحة الإدارة والإشراف</span>
        </h2>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(
            [
              { id: 'overview', label: 'نظرة عامة' },
              { id: 'notifications', label: 'إعدادات الإشعارات' },
              { id: 'reports', label: 'البلاغات' },
              { id: 'users', label: 'المستخدمون' },
              { id: 'content', label: 'المحتوى' },
              { id: 'support', label: 'الدعم' },
              { id: 'app', label: 'إدارة التطبيق' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap ${
                tab === t.id
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && overview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'إجمالي المستخدمين', val: overview.stats.totalUsers },
              { label: 'المتصلون الآن (فوري)', val: overview.stats.onlineUsers },
              { label: 'مستخدمون جدد اليوم', val: overview.stats.newUsersToday },
              { label: 'إجمالي المنشورات', val: overview.stats.totalPosts },
              { label: 'التعليقات', val: overview.stats.totalComments },
              { label: 'المجتمعات', val: overview.stats.totalCommunities },
              { label: 'البلاغات المفتوحة', val: overview.stats.openReports },
              { label: 'تذاكر الدعم المفتوحة', val: overview.stats.openSupport },
            ].map((k) => (
              <div
                key={k.label}
                className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-4"
              >
                <p className="text-xs text-slate-400">{k.label}</p>
                <p className="font-mono text-2xl font-bold tabular-nums mt-1">{k.val ?? 0}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-2">
            <h3 className="font-display text-sm font-bold">سجل الإجراءات الإدارية</h3>
            {overview.recentActions.length === 0 ? (
              <p className="text-xs text-slate-400">لا توجد إجراءات مسجلة بعد.</p>
            ) : (
              overview.recentActions.map((a, i) => (
                <div
                  key={i}
                  className="text-xs flex items-center justify-between py-2 border-b border-slate-100 dark:border-white/5"
                >
                  <span>
                    @{String(a.moderator_username)} · {String(a.action_type)} ({String(a.target_type)} #{String(a.target_id)})
                  </span>
                  <span className="text-slate-400">{String(a.created_at)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'notifications' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-violet-500/30 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-1">
                <h3 className="font-display text-base font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                  <BellRing className="w-5 h-5 text-violet-500" />
                  <span>إدارة إعدادات الإشعارات العامة للمنصة</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  التحكم المركزي في التنبيهات الفورية وإشعارات الأنشطة لجميع مستخدمي مين؟ (متاح حصريًا للأدمن المعتمد:{' '}
                  <span className="font-mono text-violet-400" dir="ltr">
                    {adminStatus.designatedAdminEmail || 'غير محدد في إعدادات السيرفر'}
                  </span>
                  ).
                </p>
              </div>
              <span
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                  globalNotif.instantAlertsEnabled
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-rose-500/15 text-rose-400'
                }`}
              >
                {globalNotif.instantAlertsEnabled
                  ? 'التنبيهات الفورية مفعّلة للمنصة'
                  : 'التنبيهات الفورية معطّلة للمنصة'}
              </span>
            </div>

            {!adminStatus.isDesignatedAdmin ? (
              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 flex items-center gap-3 text-xs text-amber-300">
                <Lock className="w-5 h-5 shrink-0" />
                <span>
                  تعديل إعدادات الإشعارات العامة للمنصة بالكامل مخصص فقط لحساب الأدمن المحدد (
                  <span className="font-mono" dir="ltr">
                    {adminStatus.designatedAdminEmail || 'غير محدد في إعدادات السيرفر'}
                  </span>
                  ).
                </span>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={savingNotifCfg}
                    onClick={async () => {
                      const next = { ...globalNotif, instantAlertsEnabled: true, quietModeEnabled: false };
                      setSavingNotifCfg(true);
                      try {
                        const res = await apiRequest<{ notificationSettings: GlobalNotificationSettings }>(
                          '/admin/notification-settings',
                          { method: 'PATCH', body: next }
                        );
                        setGlobalNotif(res.notificationSettings);
                        onRefreshSession();
                        onToast('تم تفعيل التنبيهات الفورية للمنصة بالكامل.');
                      } catch (err) {
                        onToast(err instanceof Error ? err.message : 'تعذر حفظ الإعدادات.');
                      } finally {
                        setSavingNotifCfg(false);
                      }
                    }}
                    className="min-h-[38px] px-3.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-xs font-semibold"
                  >
                    تفعيل الوضع القياسي الكامل
                  </button>
                  <button
                    type="button"
                    disabled={savingNotifCfg}
                    onClick={async () => {
                      const next = { ...globalNotif, instantAlertsEnabled: false };
                      setSavingNotifCfg(true);
                      try {
                        const res = await apiRequest<{ notificationSettings: GlobalNotificationSettings }>(
                          '/admin/notification-settings',
                          { method: 'PATCH', body: next }
                        );
                        setGlobalNotif(res.notificationSettings);
                        onRefreshSession();
                        onToast('تم تعطيل التنبيهات الفورية للمنصة بالكامل فورًا.');
                      } catch (err) {
                        onToast(err instanceof Error ? err.message : 'تعذر حفظ الإعدادات.');
                      } finally {
                        setSavingNotifCfg(false);
                      }
                    }}
                    className="min-h-[38px] px-3.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 text-xs font-semibold"
                  >
                    تعطيل التنبيهات الفورية فورًا للجميع
                  </button>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-white/5 border-t border-slate-100 dark:border-white/5">
                  {(
                    [
                      {
                        key: 'instantAlertsEnabled',
                        title: 'تفعيل التنبيهات الفورية للمنصة بالكامل',
                        desc: 'عند التعطيل، تتوقف جميع التنبيهات المنبثقة المباشرة على مستوى المنصة بالكامل لكل المستخدمين.',
                      },
                      {
                        key: 'quietModeEnabled',
                        title: 'تفعيل وضع الهدوء العام',
                        desc: 'يحفظ الإشعارات داخل صفحة الإشعارات بدون إظهار شريط التنبيه المنبثق (ما عدا تنبيهات الإدارة).',
                      },
                      {
                        key: 'browserPushEnabled',
                        title: 'السماح بإشعارات المتصفح الخارجية (Push)',
                        desc: 'التحكم في إرسال تنبيهات المتصفح عندما يكون التطبيق في الخلفية.',
                      },
                      {
                        key: 'allowReactionNotifs',
                        title: 'إشعارات الإعجاب والدعم للمنصة',
                        desc: 'تفعيل أو إيقاف توليد إشعارات التفاعل والدعم على مستوى التطبيق.',
                      },
                      {
                        key: 'allowCommentNotifs',
                        title: 'إشعارات التعليقات والردود للمنصة',
                        desc: 'تفعيل أو إيقاف إشعارات التعليقات والردود الجديدة للجميع.',
                      },
                      {
                        key: 'allowFriendNotifs',
                        title: 'إشعارات طلبات وقبول الصداقة',
                        desc: 'تفعيل أو إيقاف إشعارات طلبات الصداقة على مستوى المنصة.',
                      },
                      {
                        key: 'allowMessageNotifs',
                        title: 'إشعارات الرسائل المباشرة',
                        desc: 'تفعيل أو إيقاف تنبيهات وصول الرسائل الخاصة.',
                      },
                      {
                        key: 'allowBroadcastBanner',
                        title: 'شريط البث الإداري الفوري',
                        desc: 'السماح بظهور إعلانات الإدارة العاجلة كتنبيه مباشر لجميع المتصلين.',
                      },
                    ] as const
                  ).map((item) => (
                    <label
                      key={item.key}
                      className="flex items-center justify-between gap-4 py-3 cursor-pointer"
                    >
                      <div className="space-y-0.5">
                        <p className="text-sm font-semibold">{item.title}</p>
                        <p className="text-xs text-slate-400">{item.desc}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean(globalNotif[item.key])}
                        disabled={savingNotifCfg}
                        aria-label={item.title}
                        onChange={async (e) => {
                          const next = { ...globalNotif, [item.key]: e.target.checked };
                          setGlobalNotif(next);
                          setSavingNotifCfg(true);
                          try {
                            const res = await apiRequest<{
                              notificationSettings: GlobalNotificationSettings;
                            }>('/admin/notification-settings', { method: 'PATCH', body: next });
                            setGlobalNotif(res.notificationSettings);
                            onRefreshSession();
                            onToast('تم تحديث إعدادات الإشعارات العامة للمنصة وتطبيقها فورًا.');
                          } catch (err) {
                            onToast(err instanceof Error ? err.message : 'تعذر حفظ التغييرات.');
                          } finally {
                            setSavingNotifCfg(false);
                          }
                        }}
                        className="w-4 h-4 accent-violet-600 shrink-0"
                      />
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="بحث عن مستخدم..."
              className="w-full min-h-[42px] rounded-xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 pr-10 pl-4 text-xs"
            />
          </div>
          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 divide-y divide-slate-100 dark:divide-white/5">
            {usersList.map((u) => (
              <div key={String(u.id)} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Users className="w-5 h-5 text-violet-400 shrink-0" />
                  <div>
                    <p className="text-sm font-bold">
                      {String(u.display_name)} (@{String(u.username)})
                    </p>
                    <p className="text-xs text-slate-400">
                      الدور: {String(u.role)} · الحالة: {String(u.status)} · المنشورات:{' '}
                      {String(u.posts_count)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {adminStatus.isPrimaryAdmin && Number(u.id) !== currentUser?.id && (
                    <button
                      type="button"
                      onClick={async () => {
                        const nextAction = u.role === 'user' ? 'make_moderator' : 'demote';
                        await apiRequest(`/admin/users/${u.id}/action`, {
                          method: 'POST',
                          body: { action: nextAction },
                        });
                        loadAdminTab();
                        onToast(u.role === 'user' ? 'تمت الترقية إلى مشرف.' : 'تم إلغاء الإشراف.');
                      }}
                      className="min-h-[34px] px-2.5 rounded-lg bg-violet-500/15 text-violet-400 text-xs font-semibold"
                    >
                      {u.role === 'user' ? 'ترقية لمشرف' : 'إزالة الإشراف'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      await apiRequest(`/admin/users/${u.id}/action`, {
                        method: 'POST',
                        body: { action: 'warn', reason: 'تنبيه بخصوص الالتزام بقواعد مين؟' },
                      });
                      onToast('تم إرسال تنبيه للمستخدم.');
                    }}
                    className="min-h-[34px] px-2.5 rounded-lg bg-amber-500/15 text-amber-400 text-xs"
                  >
                    تحذير
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiRequest(`/admin/users/${u.id}/action`, {
                        method: 'POST',
                        body: { action: u.status === 'active' ? 'suspend' : 'activate' },
                      });
                      loadAdminTab();
                    }}
                    className="min-h-[34px] px-2.5 rounded-lg bg-slate-100 dark:bg-white/5 text-xs"
                  >
                    {u.status === 'active' ? 'إيقاف' : 'تفعيل'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiRequest(`/admin/users/${u.id}/action`, {
                        method: 'POST',
                        body: { action: 'ban' },
                      });
                      loadAdminTab();
                    }}
                    className="min-h-[34px] px-2.5 rounded-lg bg-rose-500/15 text-rose-400 text-xs"
                  >
                    حظر
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'reports' && (
        <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 divide-y divide-slate-100 dark:divide-white/5">
          {reports.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-400">لا توجد بلاغات مسجلة.</p>
          ) : (
            reports.map((r) => (
              <div key={String(r.id)} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>
                      {String(r.reason)} · {String(r.target_type)} #{String(r.target_id)}
                    </span>
                  </p>
                  {Boolean(r.details) && <p className="text-xs text-slate-400">{String(r.details)}</p>}
                  <p className="text-[11px] text-slate-500">
                    المُبلغ: @{String(r.reporter_username)} · الحالة: {String(r.status)}
                  </p>
                </div>
                {r.status === 'open' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        await apiRequest(`/admin/reports/${r.id}/resolve`, {
                          method: 'POST',
                          body: { decision: 'accepted', hideTarget: true, resolutionNote: 'تم إخفاء المحتوى المخالف' },
                        });
                        loadAdminTab();
                        onToast('تم قبول البلاغ وإخفاء المحتوى.');
                      }}
                      className="min-h-[36px] px-3 rounded-xl bg-rose-600 text-white text-xs font-semibold"
                    >
                      قبول وإخفاء المحتوى
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiRequest(`/admin/reports/${r.id}/resolve`, {
                          method: 'POST',
                          body: { decision: 'rejected', resolutionNote: 'لا توجد مخالفة' },
                        });
                        loadAdminTab();
                      }}
                      className="min-h-[36px] px-3 rounded-xl bg-slate-100 dark:bg-white/5 text-xs"
                    >
                      رفض
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'content' && (
        <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 divide-y divide-slate-100 dark:divide-white/5">
          {contentData.posts.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-400">لا يوجد محتوى منشور.</p>
          ) : (
            contentData.posts.map((p) => (
              <div key={String(p.id)} className="p-4 flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <p className="text-xs text-slate-400">
                    #{String(p.id)} · {String(p.type)} · {String(p.category)} ·{' '}
                    {Number(p.is_anonymous) === 1 ? 'مجهول' : `@${String(p.username)}`}
                    {Number(p.is_hidden) === 1 ? ' · [مخفي]' : ''}
                  </p>
                  <p className="text-sm line-clamp-2">{String(p.content)}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      await apiRequest(`/admin/content/post/${p.id}/moderate`, {
                        method: 'POST',
                        body: { action: Number(p.is_hidden) === 1 ? 'unhide' : 'hide' },
                      });
                      loadAdminTab();
                    }}
                    className="min-h-[34px] px-3 rounded-lg bg-slate-100 dark:bg-white/5 text-xs"
                  >
                    {Number(p.is_hidden) === 1 ? 'إظهار' : 'إخفاء'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiRequest(`/admin/content/post/${p.id}/moderate`, {
                        method: 'POST',
                        body: { action: 'delete' },
                      });
                      loadAdminTab();
                    }}
                    className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg bg-rose-500/15 text-rose-400"
                    aria-label="حذف"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'support' && (
        <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 divide-y divide-slate-100 dark:divide-white/5">
          {supportReqs.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-400">لا توجد طلبات دعم حاليًا.</p>
          ) : (
            supportReqs.map((sr) => (
              <div key={String(sr.id)} className="p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">{String(sr.subject)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{String(sr.description)}</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {String(sr.category)} · الحالة: {String(sr.status)}
                  </p>
                </div>
                {sr.status !== 'resolved' && (
                  <button
                    type="button"
                    onClick={async () => {
                      await apiRequest(`/admin/support/${sr.id}/resolve`, {
                        method: 'POST',
                        body: { status: 'resolved', adminReply: 'تمت المعالجة' },
                      });
                      loadAdminTab();
                    }}
                    className="min-h-[36px] px-3 rounded-xl bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>تم الحل</span>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'app' && (
        <div className="space-y-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const res = await apiRequest<{ sentCount: number }>('/admin/broadcast', {
                  method: 'POST',
                  body: { title: broadcastTitle, message: broadcastBody },
                });
                setBroadcastBody('');
                onToast(`تم إرسال التنبيه الفوري إلى ${res.sentCount} عضو متصل.`);
              } catch (err) {
                onToast(err instanceof Error ? err.message : 'تعذر إرسال التنبيه.');
              }
            }}
            className="rounded-2xl bg-white dark:bg-[#12121A] border border-violet-500/30 p-5 space-y-3"
          >
            <h3 className="font-display text-sm font-bold flex items-center gap-2 text-violet-400">
              <Megaphone className="w-4 h-4" />
              <span>إرسال إشعار فوري لجميع الأعضاء (Real-Time)</span>
            </h3>
            <input
              type="text"
              required
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              placeholder="عنوان التنبيه"
              className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
            />
            <textarea
              rows={2}
              required
              value={broadcastBody}
              onChange={(e) => setBroadcastBody(e.target.value)}
              placeholder="اكتب نص الإشعار ليصل فورًا لكل مستخدمي مين؟..."
              className="w-full rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 p-3 text-sm"
            />
            <button
              type="submit"
              className="min-h-[42px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
            >
              بث الإشعار الآن
            </button>
          </form>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiRequest('/admin/daily-question', {
                method: 'POST',
                body: { questionText: dailyText },
              });
              setDailyText('');
              onToast('تم تحديث سؤال اليوم بنجاح!');
            }}
            className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3"
          >
            <h3 className="font-display text-sm font-bold">تغيير سؤال اليوم</h3>
            <div className="flex items-center gap-2">
              <input
                type="text"
                required
                value={dailyText}
                onChange={(e) => setDailyText(e.target.value)}
                placeholder="اكتب سؤال اليوم الجديد لجميع المستخدمين..."
                className="flex-1 min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
              />
              <button
                type="submit"
                className="min-h-[42px] px-4 rounded-xl bg-violet-600 text-white text-xs font-semibold"
              >
                تحديث
              </button>
            </div>
          </form>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiRequest('/admin/challenges', {
                method: 'POST',
                body: { title: chTitle, description: chDesc, category: chCat, pointsReward: chPoints },
              });
              setChTitle('');
              setChDesc('');
              onToast('تم إنشاء التحدي الجديد!');
            }}
            className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3"
          >
            <h3 className="font-display text-sm font-bold">إضافة تحدي جديد</h3>
            <input
              type="text"
              required
              value={chTitle}
              onChange={(e) => setChTitle(e.target.value)}
              placeholder="عنوان التحدي"
              className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
            />
            <textarea
              rows={2}
              required
              value={chDesc}
              onChange={(e) => setChDesc(e.target.value)}
              placeholder="وصف التحدي الآمن"
              className="w-full rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 p-3 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={chCat}
                onChange={(e) => setChCat(e.target.value)}
                placeholder="التصنيف"
                className="min-h-[40px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-xs"
              />
              <input
                type="number"
                min={5}
                max={100}
                value={chPoints}
                onChange={(e) => setChPoints(Number(e.target.value))}
                className="min-h-[40px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-xs"
              />
            </div>
            <button
              type="submit"
              className="min-h-[42px] px-4 rounded-xl bg-violet-600 text-white text-xs font-semibold"
            >
              نشر التحدي
            </button>
          </form>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiRequest('/admin/settings', {
                method: 'PATCH',
                body: {
                  announcement,
                  categories: categoriesText
                    .split(/[،,]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                  monetization: {
                    ...appConfig.monetization,
                    adsEnabled,
                    premiumEnabled,
                  },
                },
              });
              onRefreshSession();
              onToast('تم حفظ إعدادات التطبيق.');
            }}
            className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3"
          >
            <h3 className="font-display text-sm font-bold">إعدادات التطبيق والتصنيفات</h3>
            <div>
              <label className="block text-xs font-semibold mb-1">رسالة تنبيه عامة (اختياري)</label>
              <input
                type="text"
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value)}
                placeholder="رسالة تظهر في أعلى الصفحة لجميع الأعضاء..."
                className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">التصنيفات (مفصولة بفاصلة)</label>
              <input
                type="text"
                value={categoriesText}
                onChange={(e) => setCategoriesText(e.target.value)}
                className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
              />
            </div>
            <div className="flex items-center gap-4 text-xs pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={adsEnabled}
                  onChange={(e) => setAdsEnabled(e.target.checked)}
                  className="accent-violet-600"
                />
                <span>تجهيز مساحة الإعلانات المستقبلية</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={premiumEnabled}
                  onChange={(e) => setPremiumEnabled(e.target.checked)}
                  className="accent-violet-600"
                />
                <span>تجهيز مزايا الحساب المميز مستقبلًا</span>
              </label>
            </div>
            <button
              type="submit"
              className="min-h-[42px] px-4 rounded-xl bg-violet-600 text-white text-xs font-semibold"
            >
              حفظ الإعدادات
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

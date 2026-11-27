import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Award,
  BarChart2,
  Bell,
  Bookmark,
  CalendarHeart,
  Compass,
  Flame,
  HelpCircle,
  Home,
  Menu,
  MessageCircle,
  MessageSquareHeart,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  Trophy,
  User as UserIcon,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { apiRequest } from './lib/api';
import {
  evaluateRealtimeNotification,
  type RealtimeNotificationPayload,
} from './lib/notificationFilter';
import { SplashScreen } from './components/SplashScreen';
import { AuthScreen } from './components/AuthScreen';
import { PostComposerModal } from './components/PostComposerModal';
import { ReportModal } from './components/ReportModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { HomeView } from './views/HomeView';
import { ConfessionsView } from './views/ConfessionsView';
import { ExploreView } from './views/ExploreView';
import { QuestionsPollsView } from './views/QuestionsPollsView';
import { CommunitiesView } from './views/CommunitiesView';
import { TrendingView } from './views/TrendingView';
import { MessagesView } from './views/MessagesView';
import { FriendsView } from './views/FriendsView';
import { DailyQuestionChallengesView } from './views/DailyQuestionChallengesView';
import { NotificationsView } from './views/NotificationsView';
import { ProfileView } from './views/ProfileView';
import { SavedView } from './views/SavedView';
import { SettingsHelpView } from './views/SettingsHelpView';
import { AdminDashboardView } from './views/AdminDashboardView';
import type { AppConfig, AppSection, User } from './types';
import { subscribeLive } from './lib/realtime';

const DEFAULT_CONFIG: AppConfig = {
  categories: ['فضفضة', 'مشاعر', 'مواقف', 'أسئلة', 'قصص', 'نصائح', 'علاقات', 'الحياة اليومية'],
  announcement: '',
  termsText: '',
  privacyText: '',
  monetization: {
    adsEnabled: false,
    premiumEnabled: false,
    supporterBadgesEnabled: false,
    announcementSlot: '',
  },
};

export default function App() {
  const [splashDone, setSplashDone] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('autostart') === '1';
  });
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [guestMode, setGuestMode] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [appConfig, setAppConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [darkMode, setDarkMode] = useState(true);

  const [section, setSection] = useState<AppSection>('home');
  const [selectedProfileUsername, setSelectedProfileUsername] = useState<string>('');
  const [selectedCommunityId, setSelectedCommunityId] = useState<number | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [exploreQuery, setExploreQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Composer & Report Modals
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerType, setComposerType] = useState<'post' | 'confession' | 'question' | 'poll'>('confession');
  const [composerCommunity, setComposerCommunity] = useState<{ id: number; name: string } | null>(null);
  const [draftText, setDraftText] = useState('');
  const [reportTarget, setReportTarget] = useState<{
    type: 'post' | 'comment' | 'user' | 'community' | 'message';
    id: number;
  } | null>(null);

  const [refreshSignal, setRefreshSignal] = useState(0);
  const [wsSyncSignal, setWsSyncSignal] = useState(0);
  const [newFeedAvailable, setNewFeedAvailable] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [instantAlert, setInstantAlert] = useState<RealtimeNotificationPayload | null>(null);
  const [lastWsEvent, setLastWsEvent] = useState<Record<string, unknown> | null>(null);
  const sectionRef = useRef<AppSection>(section);
  sectionRef.current = section;
  const userRef = useRef<User | null>(user);
  userRef.current = user;
  const appConfigRef = useRef<AppConfig>(appConfig);
  appConfigRef.current = appConfig;
  const instantAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3600);
  }, []);

  const showInstantAlert = useCallback((notif: RealtimeNotificationPayload) => {
    setInstantAlert(notif);
    if (instantAlertTimerRef.current) {
      clearTimeout(instantAlertTimerRef.current);
    }
    instantAlertTimerRef.current = setTimeout(() => {
      setInstantAlert((prev) => (prev?.id === notif.id ? null : prev));
    }, 5200);

    if (
      appConfigRef.current.notificationSettings?.browserPushEnabled !== false &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted' &&
      document.visibilityState === 'hidden'
    ) {
      try {
        new Notification(notif.title, { body: notif.body });
      } catch {
        // Ignore browser notification failure
      }
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const fetchMe = useCallback(async () => {
    try {
      const res = await apiRequest<{ user: User | null; appConfig: AppConfig }>('/auth/me');
      setUser(res.user);
      if (res.appConfig) setAppConfig(res.appConfig);
    } catch {
      setUser(null);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  // Realtime: Firebase Realtime Database channels (see src/lib/realtime.ts).
  useEffect(() => {
    if (!user?.uid) return;
    const unsubscribe = subscribeLive(user.uid, (event) => {
      setLastWsEvent(event);
      if (event.type === 'notification:new') {
        const notif = event.notification as RealtimeNotificationPayload | undefined;
        if (!notif) return;
        const decision = evaluateRealtimeNotification(
          notif,
          userRef.current,
          sectionRef.current,
          appConfigRef.current.notificationSettings
        );
        if (decision.shouldIncrementUnread) {
          setUser((prev) => (prev ? { ...prev, unreadNotifications: prev.unreadNotifications + 1 } : prev));
        }
        if (decision.shouldShowInstantAlert) showInstantAlert(notif);
      } else if (event.type === 'app:notification_settings_updated') {
        const nextSettings = event.notificationSettings as AppConfig['notificationSettings'];
        if (nextSettings) setAppConfig((prev) => ({ ...prev, notificationSettings: nextSettings }));
      } else if (event.type === 'message:new') {
        const msg = event.message as { senderId?: number };
        if (msg.senderId !== user.id) {
          setUser((prev) => (prev ? { ...prev, unreadMessages: prev.unreadMessages + 1 } : prev));
        }
      } else if (event.type === 'feed:new_post') {
        setNewFeedAvailable(true);
      }
    });
    const handleOnline = () => {
      fetchMe();
      setWsSyncSignal((s) => s + 1);
    };
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      unsubscribe();
    };
  }, [user?.uid, user?.id, fetchMe, showInstantAlert]);

  const navigate = (target: AppSection) => {
    const authOnlySections: AppSection[] = [
      'messages',
      'friends',
      'notifications',
      'saved',
    ];
    if (!user && authOnlySections.includes(target)) {
      setShowAuthModal(true);
      return;
    }
    if (target === 'profile') {
      if (!user) {
        setShowAuthModal(true);
        return;
      }
      setSelectedProfileUsername(user.username);
    }
    if (target === 'communities') {
      setSelectedCommunityId(null);
    }
    setSection(target);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openProfile = (username: string) => {
    setSelectedProfileUsername(username);
    setSection('profile');
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openCommunity = (communityId: number) => {
    setSelectedCommunityId(communityId);
    setSection('communities');
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startChatWithUser = async (peerId: number) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    try {
      const res = await apiRequest<{ conversationId: number }>('/messages/conversations', {
        method: 'POST',
        body: { peerId },
      });
      setSelectedConversationId(res.conversationId);
      setSection('messages');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر بدء المحادثة.');
    }
  };

  const openComposer = (
    type: 'post' | 'confession' | 'question' | 'poll' = 'confession',
    community: { id: number; name: string } | null = null,
    prefill?: string
  ) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    setComposerType(type);
    setComposerCommunity(community);
    if (prefill !== undefined) {
      setDraftText(prefill);
    }
    setComposerOpen(true);
  };

  if (!splashDone) {
    return <SplashScreen onComplete={() => setSplashDone(true)} />;
  }

  if (booting) {
    return (
      <div className="min-h-screen bg-[#09090D] flex items-center justify-center text-slate-400 text-sm">
        جاري تجهيز مين؟...
      </div>
    );
  }

  // Require Login/Register unless user explicitly chose Guest browse or is accessing /admin bootstrap
  if (!user && !guestMode && section !== 'admin') {
    return (
      <AuthScreen
        appConfig={appConfig}
        onSuccess={(loggedInUser) => {
          setUser(loggedInUser);
          setGuestMode(false);
          setShowAuthModal(false);
        }}
        onBrowseGuest={() => setGuestMode(true)}
      />
    );
  }

  const SIDEBAR_ITEMS: Array<{
    id: AppSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'home', label: 'الرئيسية', icon: Home },
    { id: 'confessions', label: 'الفضفضة', icon: MessageSquareHeart },
    { id: 'explore', label: 'اكتشف', icon: Compass },
    { id: 'trending', label: 'التريند', icon: Flame },
    { id: 'daily', label: 'سؤال اليوم', icon: CalendarHeart },
    { id: 'challenges', label: 'التحديات', icon: Trophy },
    { id: 'questions', label: 'الأسئلة', icon: HelpCircle },
    { id: 'polls', label: 'التصويتات', icon: BarChart2 },
    { id: 'communities', label: 'المجتمعات', icon: Users },
    { id: 'friends', label: 'الأصدقاء', icon: UserPlus },
    { id: 'messages', label: 'الرسائل', icon: MessageCircle, badge: user?.unreadMessages },
    { id: 'notifications', label: 'الإشعارات', icon: Bell, badge: user?.unreadNotifications },
    { id: 'saved', label: 'المحفوظات', icon: Bookmark },
    { id: 'gamification', label: 'النقاط والشارات', icon: Award },
    { id: 'settings', label: 'الإعدادات', icon: Settings },
    { id: 'help', label: 'الدعم والمساعدة', icon: HelpCircle },
    ...(user?.role === 'admin' || user?.role === 'moderator'
      ? [{ id: 'admin' as AppSection, label: 'لوحة الإدارة', icon: ShieldAlert }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-[#F8F7FB] dark:bg-[#09090D] text-slate-900 dark:text-[#F4F3FA] pb-20 lg:pb-8">
      {/* Top Bar (3-zone contract, <=56px sticky height) */}
      <header className="sticky top-0 z-30 h-14 bg-white/90 dark:bg-[#09090D]/90 backdrop-blur-md border-b border-slate-200/80 dark:border-white/8">
        <div className="max-w-7xl mx-auto h-full px-4 flex items-center justify-between gap-8">
          {/* Zone 1: Brand wordmark */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300"
              aria-label="فتح القائمة الجانبية"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => navigate('home')}
              className="font-display text-xl font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
            >
              مين؟
            </button>
          </div>

          {/* Zone 2: Concise single-line desktop nav links */}
          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
            <button
              type="button"
              onClick={() => navigate('home')}
              className={`whitespace-nowrap shrink-0 hover:text-violet-500 transition-colors ${
                section === 'home' ? 'text-violet-500 font-bold' : ''
              }`}
            >
              الرئيسية
            </button>
            <button
              type="button"
              onClick={() => navigate('confessions')}
              className={`whitespace-nowrap shrink-0 hover:text-violet-500 transition-colors ${
                section === 'confessions' ? 'text-violet-500 font-bold' : ''
              }`}
            >
              الفضفضة
            </button>
            <button
              type="button"
              onClick={() => navigate('communities')}
              className={`whitespace-nowrap shrink-0 hover:text-violet-500 transition-colors ${
                section === 'communities' ? 'text-violet-500 font-bold' : ''
              }`}
            >
              المجتمعات
            </button>
            <button
              type="button"
              onClick={() => navigate('trending')}
              className={`whitespace-nowrap shrink-0 hover:text-violet-500 transition-colors ${
                section === 'trending' ? 'text-violet-500 font-bold' : ''
              }`}
            >
              التريند
            </button>
            <button
              type="button"
              onClick={() => navigate('daily')}
              className={`whitespace-nowrap shrink-0 hover:text-violet-500 transition-colors ${
                section === 'daily' ? 'text-violet-500 font-bold' : ''
              }`}
            >
              سؤال اليوم
            </button>
          </nav>

          {/* Zone 3: Search + Notifications + Primary CTA */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => navigate('explore')}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5"
              aria-label="بحث واكتشاف"
            >
              <Search className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => navigate('notifications')}
              className="relative min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5"
              aria-label="الإشعارات"
            >
              <Bell className="w-5 h-5" />
              {user && user.unreadNotifications > 0 && (
                <span className="absolute top-1.5 left-1.5 min-w-[16px] h-4 px-1 rounded-full bg-violet-600 text-white text-[10px] font-mono flex items-center justify-center">
                  {user.unreadNotifications}
                </span>
              )}
            </button>
            {user ? (
              <button
                type="button"
                onClick={() => openComposer('confession')}
                className="hidden sm:flex min-h-[38px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>احكي اللي جواك</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                className="min-h-[38px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold whitespace-nowrap shrink-0"
              >
                تسجيل الدخول
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Global Admin Announcement */}
      {appConfig.announcement && (
        <div className="bg-violet-600/15 border-b border-violet-500/20 text-center py-2 px-4 text-xs text-violet-700 dark:text-violet-200">
          {appConfig.announcement}
        </div>
      )}

      {/* Live Feed Refresh Banner */}
      {newFeedAvailable && section === 'home' && (
        <div className="max-w-2xl mx-auto px-4 pt-3">
          <button
            type="button"
            onClick={() => {
              setNewFeedAvailable(false);
              setRefreshSignal((s) => s + 1);
            }}
            className="w-full min-h-[38px] rounded-xl bg-violet-600/15 border border-violet-500/30 text-violet-400 text-xs font-semibold"
          >
            تتوفر منشورات جديدة — اضغط للتحديث
          </button>
        </div>
      )}

      {/* Main 3-Column Responsive Layout */}
      <div className="max-w-7xl mx-auto px-4 pt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Right Sidebar (Desktop Navigation) */}
        <aside className="hidden lg:block lg:col-span-3 sticky top-20 space-y-3">
          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200/80 dark:border-white/8 p-2 space-y-0.5 max-h-[78vh] overflow-y-auto">
            {SIDEBAR_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.id)}
                  className={`w-full min-h-[38px] px-3 rounded-xl flex items-center justify-between text-sm font-medium transition-colors ${
                    active
                      ? 'bg-violet-600 text-white font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-violet-500/20 text-violet-300 text-[11px] font-mono flex items-center justify-center">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <PWAInstallButton variant="full" />
        </aside>

        {/* Center Main Content */}
        <main
          className={
            section === 'messages' || section === 'admin'
              ? 'lg:col-span-9 min-w-0'
              : 'lg:col-span-6 min-w-0'
          }
        >
          {section === 'home' && (
            <HomeView
              currentUser={user}
              categories={appConfig.categories}
              refreshSignal={refreshSignal + wsSyncSignal}
              lastWsEvent={lastWsEvent}
              onOpenComposer={(t, prefill) => openComposer(t || 'confession', null, prefill)}
              onOpenProfile={openProfile}
              onOpenCommunity={openCommunity}
              onOpenReport={(type, id) => setReportTarget({ type, id })}
              onRequireAuth={() => setShowAuthModal(true)}
              onToast={showToast}
            />
          )}

          {section === 'confessions' && (
            <ConfessionsView
              currentUser={user}
              refreshSignal={refreshSignal + wsSyncSignal}
              lastWsEvent={lastWsEvent}
              onOpenComposer={() => openComposer('confession')}
              onOpenProfile={openProfile}
              onOpenCommunity={openCommunity}
              onOpenReport={(type, id) => setReportTarget({ type, id })}
              onRequireAuth={() => setShowAuthModal(true)}
              onToast={showToast}
            />
          )}

          {section === 'explore' && (
            <ExploreView
              currentUser={user}
              initialQuery={exploreQuery}
              onNavigate={navigate}
              onOpenProfile={openProfile}
              onOpenCommunity={openCommunity}
              onOpenReport={(type, id) => setReportTarget({ type, id })}
              onRequireAuth={() => setShowAuthModal(true)}
              onToast={showToast}
            />
          )}

          {(section === 'questions' || section === 'polls') && (
            <QuestionsPollsView
              mode={section === 'questions' ? 'question' : 'poll'}
              currentUser={user}
              refreshSignal={refreshSignal + wsSyncSignal}
              lastWsEvent={lastWsEvent}
              onOpenComposer={(t) => openComposer(t)}
              onOpenProfile={openProfile}
              onOpenCommunity={openCommunity}
              onOpenReport={(type, id) => setReportTarget({ type, id })}
              onRequireAuth={() => setShowAuthModal(true)}
              onToast={showToast}
            />
          )}

          {section === 'communities' && (
            <CommunitiesView
              currentUser={user}
              selectedCommunityId={selectedCommunityId}
              onSelectCommunity={setSelectedCommunityId}
              onOpenComposerForCommunity={(id, name) => openComposer('post', { id, name })}
              onOpenProfile={openProfile}
              onOpenReport={(type, id) => setReportTarget({ type, id })}
              onRequireAuth={() => setShowAuthModal(true)}
              onToast={showToast}
              refreshSignal={refreshSignal}
            />
          )}

          {section === 'trending' && (
            <TrendingView
              currentUser={user}
              lastWsEvent={lastWsEvent}
              onOpenProfile={openProfile}
              onOpenCommunity={openCommunity}
              onOpenReport={(type, id) => setReportTarget({ type, id })}
              onRequireAuth={() => setShowAuthModal(true)}
              onToast={showToast}
            />
          )}

          {section === 'messages' && user && (
            <MessagesView
              currentUser={user}
              initialConversationId={selectedConversationId}
              lastWsEvent={lastWsEvent}
              syncSignal={wsSyncSignal}
              onUnreadRefresh={fetchMe}
              onOpenProfile={openProfile}
              onToast={showToast}
            />
          )}

          {section === 'friends' && user && (
            <FriendsView
              lastWsEvent={lastWsEvent}
              syncSignal={wsSyncSignal}
              onOpenProfile={openProfile}
              onStartChat={startChatWithUser}
              onToast={showToast}
            />
          )}

          {(section === 'daily' || section === 'challenges') && (
            <DailyQuestionChallengesView
              mode={section === 'daily' ? 'daily' : 'challenges'}
              currentUser={user}
              onOpenProfile={openProfile}
              onOpenCommunity={openCommunity}
              onOpenReport={(type, id) => setReportTarget({ type, id })}
              onRequireAuth={() => setShowAuthModal(true)}
              onToast={showToast}
            />
          )}

          {section === 'notifications' && user && (
            <NotificationsView
              lastWsEvent={lastWsEvent}
              syncSignal={wsSyncSignal}
              onNavigateTarget={(target, id) => {
                if (target === 'messages' && id) setSelectedConversationId(id);
                navigate(target);
              }}
              onRefreshCounts={fetchMe}
              onToast={showToast}
            />
          )}

          {section === 'profile' && (
            <ProfileView
              username={selectedProfileUsername || user?.username || ''}
              currentUser={user}
              onNavigate={navigate}
              onOpenProfile={openProfile}
              onOpenCommunity={openCommunity}
              onStartChat={startChatWithUser}
              onOpenReport={(type, id) => setReportTarget({ type, id })}
              onRequireAuth={() => setShowAuthModal(true)}
              onToast={showToast}
            />
          )}

          {section === 'saved' && user && (
            <SavedView
              currentUser={user}
              lastWsEvent={lastWsEvent}
              onOpenProfile={openProfile}
              onOpenCommunity={openCommunity}
              onOpenReport={(type, id) => setReportTarget({ type, id })}
              onRequireAuth={() => setShowAuthModal(true)}
              onToast={showToast}
            />
          )}

          {(section === 'settings' || section === 'help' || section === 'gamification') && (
            <SettingsHelpView
              initialTab={section}
              currentUser={user}
              appConfig={appConfig}
              darkMode={darkMode}
              onToggleDarkMode={() => setDarkMode((d) => !d)}
              onUserUpdated={setUser}
              onLoggedOut={() => {
                setUser(null);
                setGuestMode(false);
                setSection('home');
              }}
              onNavigate={navigate}
              onToast={showToast}
            />
          )}

          {section === 'admin' && (
            <AdminDashboardView
              currentUser={user}
              appConfig={appConfig}
              onRefreshSession={fetchMe}
              onToast={showToast}
            />
          )}
        </main>

        {/* Left Utility Rail (Desktop) */}
        {section !== 'messages' && section !== 'admin' && (
        <aside className="hidden lg:block lg:col-span-3 sticky top-20 space-y-4">
          {user ? (
            <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200/80 dark:border-white/8 p-4 space-y-3">
              <button
                type="button"
                onClick={() => openProfile(user.username)}
                className="flex items-center gap-3 text-right w-full"
              >
                <img
                  src={user.avatar}
                  alt={user.displayName}
                  className="w-11 h-11 rounded-full object-cover shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{user.displayName}</p>
                  <p className="text-xs text-violet-500 font-semibold">
                    {user.level.name} · {user.points} نقطة
                  </p>
                </div>
              </button>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-violet-600 rounded-full"
                  style={{ width: `${user.level.progressPercent}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200/80 dark:border-white/8 p-4 space-y-3">
              <h3 className="font-display text-sm font-bold">انضم إلى مين؟</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                أنشئ حسابًا مجانيًا للفضفضة الآمنة، التصويت، التواصل، والانضمام للمجتمعات.
              </p>
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                className="w-full min-h-[42px] rounded-xl bg-violet-600 text-white text-xs font-semibold"
              >
                تسجيل الدخول / حساب جديد
              </button>
            </div>
          )}

          {/* Daily Question Spotlight */}
          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200/80 dark:border-white/8 p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-violet-500 text-xs font-bold">
              <CalendarHeart className="w-4 h-4" />
              <span>سؤال اليوم</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              شارك إجابتك على سؤال اليوم واكسب نقاطًا جديدة، باسمك أو كمجهول.
            </p>
            <button
              type="button"
              onClick={() => navigate('daily')}
              className="w-full min-h-[38px] rounded-xl bg-violet-500/10 hover:bg-violet-500/20 text-violet-500 dark:text-violet-300 text-xs font-semibold"
            >
              إجابة سؤال اليوم
            </button>
          </div>

          {/* Safety & Help Links */}
          <div className="px-2 text-[11px] text-slate-400 flex items-center gap-3 flex-wrap">
            <button type="button" onClick={() => navigate('help')} className="hover:underline">
              مركز المساعدة والأمان
            </button>
            <span>·</span>
            <button type="button" onClick={() => navigate('settings')} className="hover:underline">
              الخصوصية
            </button>
            <span>·</span>
            <button type="button" onClick={() => navigate('admin')} className="hover:underline">
              الإدارة
            </button>
          </div>
        </aside>
        )}
      </div>

      {/* Mobile Fixed Bottom Navigation Bar (5 items, <= 64px height) */}
      <nav
        aria-label="التنقل السفلي"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 pb-safe bg-white/95 dark:bg-[#09090D]/95 backdrop-blur-md border-t border-slate-200 dark:border-white/10"
      >
        <div className="h-full max-w-lg mx-auto grid grid-cols-5 items-center px-2">
          <button
            type="button"
            onClick={() => navigate('home')}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
              section === 'home' ? 'text-violet-500 font-bold' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Home className="w-5 h-5" />
            <span>الرئيسية</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setExploreQuery('');
              navigate('explore');
            }}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
              section === 'explore'
                ? 'text-violet-500 font-bold'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Compass className="w-5 h-5" />
            <span>اكتشف</span>
          </button>

          {/* Prominent Central Publish CTA */}
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => openComposer('confession')}
              aria-label="نشر جديد"
              className="w-12 h-12 rounded-2xl bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/30 flex items-center justify-center active:scale-95 transition-transform"
            >
              <Plus className="w-6 h-6" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => navigate('messages')}
            className={`relative min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
              section === 'messages'
                ? 'text-violet-500 font-bold'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <MessageCircle className="w-5 h-5" />
            <span>الرسائل</span>
            {user && user.unreadMessages > 0 && (
              <span className="absolute top-1 left-4 min-w-[16px] h-4 px-1 rounded-full bg-violet-600 text-white text-[10px] font-mono flex items-center justify-center">
                {user.unreadMessages}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => navigate('profile')}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
              section === 'profile'
                ? 'text-violet-500 font-bold'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <UserIcon className="w-5 h-5" />
            <span>حسابي</span>
          </button>
        </div>
      </nav>

      {/* Mobile Full Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-72 max-w-[85vw] h-full bg-white dark:bg-[#12121A] border-l border-white/10 p-4 flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200 dark:border-white/10">
              <span className="font-display text-lg font-extrabold">مين؟ MEEN</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400"
                aria-label="إغلاق القائمة"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-1 flex-1">
              {SIDEBAR_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.id)}
                    className={`w-full min-h-[42px] px-3 rounded-xl flex items-center justify-between text-sm ${
                      section === item.id
                        ? 'bg-violet-600 text-white font-semibold'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="pt-3 border-t border-slate-200 dark:border-white/10">
              <PWAInstallButton variant="full" />
            </div>
          </div>
          <button
            type="button"
            className="flex-1"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="إغلاق الخلفية"
          />
        </div>
      )}

      {/* Auth Modal for Guests */}
      {showAuthModal && !user && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowAuthModal(false)}
              className="fixed top-4 left-4 z-50 min-h-[44px] min-w-[44px] rounded-xl bg-white/10 text-white flex items-center justify-center"
              aria-label="إغلاق نافذة تسجيل الدخول"
            >
              <X className="w-5 h-5" />
            </button>
            <AuthScreen
              appConfig={appConfig}
              onSuccess={(loggedInUser) => {
                setUser(loggedInUser);
                setGuestMode(false);
                setShowAuthModal(false);
              }}
            />
          </div>
        </div>
      )}

      {/* Post Composer Modal */}
      {composerOpen && user && (
        <PostComposerModal
          user={user}
          categories={appConfig.categories}
          initialType={composerType}
          communityId={composerCommunity?.id ?? null}
          communityName={composerCommunity?.name ?? null}
          draftText={draftText}
          onSaveDraft={setDraftText}
          onClose={() => setComposerOpen(false)}
          onPublished={() => {
            setRefreshSignal((s) => s + 1);
            fetchMe();
            showToast('تم النشر بنجاح!');
          }}
        />
      )}

      {/* Report Modal */}
      {reportTarget && (
        <ReportModal
          targetType={reportTarget.type}
          targetId={reportTarget.id}
          onClose={() => setReportTarget(null)}
          onSuccess={showToast}
        />
      )}

      {/* Instant Real-Time Notification Banner */}
      {instantAlert && (
        <div
          role="alert"
          data-testid="instant-alert-banner"
          className="fixed top-16 left-4 right-4 sm:left-4 sm:right-auto sm:w-96 z-50 rounded-2xl bg-[#161622] border border-violet-500/50 text-white p-3.5 shadow-2xl flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-violet-600/20 text-violet-400 flex items-center justify-center shrink-0 mt-0.5">
              <Bell className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-violet-300 truncate">{instantAlert.title}</p>
              <p className="text-xs text-slate-200 leading-relaxed line-clamp-2 mt-0.5">
                {instantAlert.body}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                const target = instantAlert.targetType;
                const tid = instantAlert.targetId;
                setInstantAlert(null);
                if (target === 'messages' && tid) {
                  setSelectedConversationId(tid);
                  navigate('messages');
                } else if (target === 'friends') {
                  navigate('friends');
                } else {
                  navigate('notifications');
                }
              }}
              className="min-h-[30px] px-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold"
            >
              عرض
            </button>
            <button
              type="button"
              onClick={() => setInstantAlert(null)}
              className="min-h-[30px] min-w-[30px] rounded-lg text-slate-400 hover:text-white flex items-center justify-center"
              aria-label="إغلاق التنبيه الفوري"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Toast Feedback */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[90vw] rounded-2xl bg-[#1A1A26] border border-violet-500/40 text-white px-4 py-3 text-xs font-semibold text-center shadow-2xl"
        >
          {toast}
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
}

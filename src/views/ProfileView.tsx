import React, { useCallback, useEffect, useState } from 'react';
import {
  Award,
  Ban,
  Calendar,
  Flag,
  Lock,
  MessageSquare,
  Settings,
  Share2,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { PostCard } from '../components/PostCard';
import type { AppSection, BadgeItem, LevelInfo, Post, User } from '../types';

interface ProfileData {
  id: number;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  interests: string[];
  privacyLevel: 'public' | 'friends' | 'limited';
  canSeeFullProfile: boolean;
  isSelf: boolean;
  friendStatus: 'none' | 'pending_sent' | 'pending_received' | 'friends';
  isFollowing: boolean;
  allowMessagesFrom: string;
  createdAt: string;
  friendsCount: number;
  followersCount: number;
  postsCount: number;
  points: number;
  level: LevelInfo;
  badges: BadgeItem[];
  posts: Post[];
}

interface ProfileViewProps {
  username: string;
  currentUser: User | null;
  onNavigate: (section: AppSection) => void;
  onOpenProfile: (username: string) => void;
  onOpenCommunity: (communityId: number) => void;
  onStartChat: (userId: number) => void;
  onOpenReport: (targetType: 'post' | 'comment' | 'user', targetId: number) => void;
  onRequireAuth: () => void;
  onToast: (msg: string) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  username,
  currentUser,
  onNavigate,
  onOpenProfile,
  onOpenCommunity,
  onStartChat,
  onOpenReport,
  onRequireAuth,
  onToast,
}) => {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'posts' | 'confessions' | 'badges'>('posts');

  const load = useCallback(() => {
    if (!username) return;
    setLoading(true);
    apiRequest<{ profile: ProfileData }>(`/users/${encodeURIComponent(username)}`)
      .then((res) => setProfile(res.profile))
      .catch((err) => onToast(err instanceof Error ? err.message : 'تعذر تحميل الملف الشخصي.'))
      .finally(() => setLoading(false));
  }, [username, onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFriendAction = async () => {
    if (!currentUser || !profile) return onRequireAuth();
    try {
      if (profile.friendStatus === 'none') {
        await apiRequest('/friends/request', { method: 'POST', body: { userId: profile.id } });
        onToast('تم إرسال طلب الصداقة.');
      } else if (profile.friendStatus === 'pending_received') {
        await apiRequest('/friends/respond', {
          method: 'POST',
          body: { userId: profile.id, action: 'accept' },
        });
        onToast('تم قبول الصداقة!');
      } else if (profile.friendStatus === 'friends') {
        await apiRequest(`/friends/${profile.id}`, { method: 'DELETE' });
        onToast('تمت إزالة الصديق.');
      }
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء.');
    }
  };

  const handleFollow = async () => {
    if (!currentUser || !profile) return onRequireAuth();
    try {
      const res = await apiRequest<{ following: boolean }>(`/follow/${profile.id}`, {
        method: 'POST',
      });
      setProfile((p) =>
        p
          ? {
              ...p,
              isFollowing: res.following,
              followersCount: p.followersCount + (res.following ? 1 : -1),
            }
          : p
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر المتابعة.');
    }
  };

  const handleBlock = async () => {
    if (!currentUser || !profile) return onRequireAuth();
    try {
      await apiRequest(`/blocks/${profile.id}`, { method: 'POST' });
      onToast('تم حظر المستخدم.');
      onNavigate('home');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر الحظر.');
    }
  };

  if (loading) {
    return <div className="h-56 rounded-3xl bg-white dark:bg-[#12121A] animate-pulse" />;
  }

  if (!profile) {
    return (
      <div className="rounded-3xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center text-sm text-slate-400">
        الملف الشخصي غير متاح.
      </div>
    );
  }

  const displayedPosts =
    tab === 'confessions'
      ? profile.posts.filter((p) => p.type === 'confession')
      : profile.posts.filter((p) => p.type !== 'confession');

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 sm:p-6 space-y-5">
        {/* Top Profile Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img
              src={profile.avatar}
              alt={profile.displayName}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl object-cover border border-violet-500/30 shrink-0"
            />
            <div>
              <h2 className="font-display text-xl font-bold">{profile.displayName}</h2>
              <p className="text-xs font-mono text-slate-400" dir="ltr">
                @{profile.username}
              </p>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
                <Calendar className="w-3.5 h-3.5" />
                <span>انضم {new Date(profile.createdAt).toLocaleDateString('ar-EG')}</span>
                <span>·</span>
                <span className="text-violet-500 font-semibold">{profile.level.name}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {profile.isSelf ? (
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="min-h-[42px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <Settings className="w-4 h-4" />
                <span>تعديل الحساب والخصوصية</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleFriendAction}
                  className="min-h-[42px] px-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  {profile.friendStatus === 'friends' ? (
                    <>
                      <UserCheck className="w-4 h-4" />
                      <span>أصدقاء</span>
                    </>
                  ) : profile.friendStatus === 'pending_sent' ? (
                    <span>تم إرسال الطلب</span>
                  ) : profile.friendStatus === 'pending_received' ? (
                    <span>قبول الصداقة</span>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      <span>إضافة صديق</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleFollow}
                  className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold"
                >
                  {profile.isFollowing ? 'تتابعه' : 'متابعة'}
                </button>
                <button
                  type="button"
                  onClick={() => (currentUser ? onStartChat(profile.id) : onRequireAuth())}
                  className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-white/15"
                  aria-label="إرسال رسالة"
                >
                  <MessageSquare className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    currentUser ? onOpenReport('user', profile.id) : onRequireAuth()
                  }
                  className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-white/15 text-slate-400 hover:text-rose-400"
                  aria-label="الإبلاغ عن المستخدم"
                >
                  <Flag className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleBlock}
                  className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-white/15 text-slate-400 hover:text-rose-500"
                  aria-label="حظر المستخدم"
                >
                  <Ban className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                if (navigator.clipboard) {
                  navigator.clipboard
                    .writeText(`${window.location.origin}/?u=${profile.username}`)
                    .catch(() => {});
                }
                onToast('تم نسخ رابط الملف الشخصي.');
              }}
              className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-white/15"
              aria-label="مشاركة الملف الشخصي"
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {profile.bio && (
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{profile.bio}</p>
        )}

        {/* Metrics strip */}
        <div className="grid grid-cols-4 gap-2 pt-3 border-t border-slate-100 dark:border-white/8 text-center">
          <div>
            <p className="font-mono text-base font-bold tabular-nums">{profile.postsCount}</p>
            <p className="text-[11px] text-slate-400">منشور</p>
          </div>
          <div>
            <p className="font-mono text-base font-bold tabular-nums">{profile.friendsCount}</p>
            <p className="text-[11px] text-slate-400">صديق</p>
          </div>
          <div>
            <p className="font-mono text-base font-bold tabular-nums">{profile.followersCount}</p>
            <p className="text-[11px] text-slate-400">متابع</p>
          </div>
          <div>
            <p className="font-mono text-base font-bold tabular-nums text-violet-500">
              {profile.points}
            </p>
            <p className="text-[11px] text-slate-400">نقطة</p>
          </div>
        </div>

        {/* Gamification Progress */}
        <div className="rounded-2xl bg-slate-50 dark:bg-[#09090D] border border-slate-200/80 dark:border-white/8 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">
              المستوى {profile.level.levelIndex}: {profile.level.name}
            </span>
            <span className="font-mono tabular-nums text-slate-400">
              {profile.level.nextLevelPoints
                ? `${profile.points} / ${profile.level.nextLevelPoints}`
                : 'المستوى الأعلى'}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
            <div
              className="h-full bg-violet-600 rounded-full transition-all duration-300"
              style={{ width: `${profile.level.progressPercent}%` }}
            />
          </div>
        </div>

        {profile.interests.length > 0 && (
          <div className="text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-200 ml-2">
              الاهتمامات:
            </span>
            {profile.interests.join(' · ')}
          </div>
        )}
      </div>

      {!profile.canSeeFullProfile ? (
        <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center space-y-2">
          <Lock className="w-8 h-8 text-violet-400 mx-auto" />
          <p className="text-sm font-bold">هذا الملف الشخصي مقيد</p>
          <p className="text-xs text-slate-400">
            إعدادات خصوصية المستخدم تتيح العرض للأصدقاء أو بشكل محدود فقط.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: 'posts', label: 'المنشورات' },
                ...(profile.isSelf ? [{ id: 'confessions', label: 'فضفضتي' } as const] : []),
                { id: 'badges', label: `الشارات (${profile.badges.length})` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`min-h-[38px] px-4 rounded-xl text-xs font-semibold ${
                  tab === t.id
                    ? 'bg-violet-600 text-white'
                    : 'bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 text-slate-500 dark:text-slate-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'badges' ? (
            profile.badges.length === 0 ? (
              <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-6 text-center text-xs text-slate-400">
                لا توجد شارات مكتسبة بعد.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {profile.badges.map((b) => (
                  <div
                    key={b.slug}
                    className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-4 flex items-center gap-3"
                  >
                    <div className="w-10 h-10 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center shrink-0">
                      <Award className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold">{b.title}</p>
                      <p className="text-xs text-slate-400">{b.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : displayedPosts.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center text-xs text-slate-400">
              لا توجد منشورات هنا بعد.
            </div>
          ) : (
            <div className="space-y-4">
              {displayedPosts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUser={currentUser}
                  onUpdatePost={(u) =>
                    setProfile((prev) =>
                      prev
                        ? { ...prev, posts: prev.posts.map((p) => (p.id === u.id ? u : p)) }
                        : prev
                    )
                  }
                  onDeletePost={(id) =>
                    setProfile((prev) =>
                      prev ? { ...prev, posts: prev.posts.filter((p) => p.id !== id) } : prev
                    )
                  }
                  onOpenProfile={onOpenProfile}
                  onOpenCommunity={onOpenCommunity}
                  onOpenReport={onOpenReport}
                  onRequireAuth={onRequireAuth}
                  onToast={onToast}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

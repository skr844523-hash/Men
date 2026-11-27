import React, { useEffect, useState } from 'react';
import { Lock, MessageSquareHeart, Plus, Shield } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { applyRealtimePostEvent } from '../lib/realtimePosts';
import { PostCard } from '../components/PostCard';
import type { Post, User } from '../types';

interface ConfessionsViewProps {
  currentUser: User | null;
  refreshSignal: number;
  lastWsEvent?: Record<string, unknown> | null;
  onOpenComposer: () => void;
  onOpenProfile: (username: string) => void;
  onOpenCommunity: (communityId: number) => void;
  onOpenReport: (targetType: 'post' | 'comment' | 'user', targetId: number) => void;
  onRequireAuth: () => void;
  onToast: (msg: string) => void;
}

const MOOD_FILTERS = [
  'الكل',
  'فضفضة عامة',
  'مشاعر',
  'حزن',
  'ضغط',
  'فرحة',
  'مشاكل يومية',
  'علاقات',
  'تجارب شخصية',
  'طلب نصيحة',
  'فضفضة بدون اسم',
];

export const ConfessionsView: React.FC<ConfessionsViewProps> = ({
  currentUser,
  refreshSignal,
  lastWsEvent,
  onOpenComposer,
  onOpenProfile,
  onOpenCommunity,
  onOpenReport,
  onRequireAuth,
  onToast,
}) => {
  const [mood, setMood] = useState('الكل');
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ type: 'confession', limit: '25' });
    if (mood !== 'الكل') params.set('moodType', mood);

    apiRequest<{ items: Post[] }>(`/posts?${params.toString()}`)
      .then((res) => setPosts(res.items))
      .catch((err) => onToast(err instanceof Error ? err.message : 'تعذر التحميل.'))
      .finally(() => setLoading(false));
  }, [mood, refreshSignal, onToast]);

  useEffect(() => {
    if (!lastWsEvent) return;
    setPosts((prev) => applyRealtimePostEvent(prev, lastWsEvent));
  }, [lastWsEvent]);

  return (
    <div className="space-y-4">
      {/* Confessions Header Banner */}
      <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-violet-500">
            <Shield className="w-5 h-5" />
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              قسم الفضفضة
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            اكتب ما بداخلك بحرية تامة. المنشورات المجهولة لا تكشف هويتك لأي مستخدم أو في أي واجهة.
          </p>
        </div>
        <button
          type="button"
          onClick={() => (currentUser ? onOpenComposer() : onRequireAuth())}
          className="min-h-[44px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shrink-0 transition-colors"
        >
          <Lock className="w-4 h-4" />
          <span>فضفضة جديدة</span>
        </button>
      </div>

      {/* Mood Filter Strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {MOOD_FILTERS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMood(m)}
            className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              mood === m
                ? 'bg-violet-600 text-white'
                : 'bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 text-slate-600 dark:text-slate-300'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-40 rounded-2xl bg-white dark:bg-[#12121A] animate-pulse" />
      ) : posts.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center space-y-3">
          <MessageSquareHeart className="w-10 h-10 text-violet-400 mx-auto" />
          <h3 className="font-display text-base font-bold">ابدأ أول فضفضة في مين؟</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            لا توجد فضفضات في هذا التصنيف حتى الآن.
          </p>
          <button
            type="button"
            onClick={() => (currentUser ? onOpenComposer() : onRequireAuth())}
            className="min-h-[44px] px-5 rounded-xl bg-violet-600 text-white text-xs font-semibold inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>اكتب فضفضة الآن</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUser={currentUser}
              lastWsEvent={lastWsEvent}
              onUpdatePost={(u) => setPosts((prev) => prev.map((p) => (p.id === u.id ? u : p)))}
              onDeletePost={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
              onOpenProfile={onOpenProfile}
              onOpenCommunity={onOpenCommunity}
              onOpenReport={onOpenReport}
              onRequireAuth={onRequireAuth}
              onToast={onToast}
            />
          ))}
        </div>
      )}
    </div>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import { Feather, Lock, Plus, Sparkles } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { applyRealtimePostEvent } from '../lib/realtimePosts';
import { PostCard } from '../components/PostCard';
import type { Post, User } from '../types';

interface HomeViewProps {
  currentUser: User | null;
  categories: string[];
  refreshSignal: number;
  lastWsEvent?: Record<string, unknown> | null;
  onOpenComposer: (type?: 'post' | 'confession' | 'question' | 'poll', prefill?: string) => void;
  onOpenProfile: (username: string) => void;
  onOpenCommunity: (communityId: number) => void;
  onOpenReport: (targetType: 'post' | 'comment' | 'user', targetId: number) => void;
  onRequireAuth: () => void;
  onToast: (msg: string) => void;
}

const HOME_FILTERS = [
  { id: 'latest', label: 'أحدث المنشورات', mode: 'sort' },
  { id: 'friends', label: 'منشورات الأصدقاء', mode: 'sort', authOnly: true },
  { id: 'top', label: 'الأكثر تفاعلًا', mode: 'sort' },
  { id: 'interests', label: 'حسب اهتماماتك', mode: 'sort', authOnly: true },
  { id: 'فضفضة', label: 'فضفضة', mode: 'category' },
  { id: 'مشاعر', label: 'مشاعر', mode: 'category' },
  { id: 'مواقف', label: 'مواقف', mode: 'category' },
  { id: 'أسئلة', label: 'أسئلة', mode: 'category' },
  { id: 'قصص', label: 'قصص', mode: 'category' },
  { id: 'نصائح', label: 'نصائح', mode: 'category' },
  { id: 'علاقات', label: 'علاقات', mode: 'category' },
  { id: 'الحياة اليومية', label: 'الحياة اليومية', mode: 'category' },
] as const;

export const HomeView: React.FC<HomeViewProps> = ({
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
  const [activeFilter, setActiveFilter] = useState<string>('latest');
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const fetchFeed = useCallback(
    async (reset = true) => {
      if (reset) setLoading(true);
      try {
        const nextOffset = reset ? 0 : offset;
        const selected = HOME_FILTERS.find((f) => f.id === activeFilter);
        const query = new URLSearchParams({ limit: '12', offset: String(nextOffset) });
        if (selected?.mode === 'sort') {
          query.set('filter', selected.id);
        } else if (selected?.mode === 'category') {
          query.set('category', selected.id);
        }

        const res = await apiRequest<{ items: Post[]; hasMore: boolean }>(
          `/posts?${query.toString()}`
        );
        setPosts((prev) => (reset ? res.items : [...prev, ...res.items]));
        setHasMore(res.hasMore);
        setOffset(nextOffset + res.items.length);
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'تعذر تحميل المنشورات.');
      } finally {
        setLoading(false);
      }
    },
    [activeFilter, offset, onToast]
  );

  useEffect(() => {
    fetchFeed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, refreshSignal]);

  useEffect(() => {
    if (!lastWsEvent) return;
    setPosts((prev) => applyRealtimePostEvent(prev, lastWsEvent));
  }, [lastWsEvent]);

  return (
    <div className="space-y-4">
      {/* Quick Post Creation Bar */}
      <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200/80 dark:border-white/8 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-violet-500/15 flex items-center justify-center shrink-0">
            {currentUser ? (
              <img
                src={currentUser.avatar}
                alt={currentUser.displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <Lock className="w-4 h-4 text-violet-400" />
            )}
          </div>
          <button
            type="button"
            onClick={() => (currentUser ? onOpenComposer('confession') : onRequireAuth())}
            className="flex-1 min-h-[44px] rounded-xl bg-slate-100 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-4 text-right text-sm text-slate-500 dark:text-slate-400 hover:border-violet-500/50 transition-colors"
          >
            احكي اللي جواك... اكتب فضفضة أو منشور سريع
          </button>
          <button
            type="button"
            onClick={() => (currentUser ? onOpenComposer('post') : onRequireAuth())}
            className="min-h-[44px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>نشر</span>
          </button>
        </div>

        {/* Quick Mood Prompt Strip */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1 border-t border-slate-100 dark:border-white/6">
          <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1 shrink-0 ml-1">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            <span>حالتك الآن:</span>
          </span>
          {[
            { label: 'محتاج فضفضة', draft: 'بصراحة محتاج أفضفض شوية النهاردة... ' },
            { label: 'متفائل', draft: 'حاسس بتفاؤل النهاردة وحابب أشارككم... ' },
            { label: 'مضغوط', draft: 'اليوم كان تقيل عليا شوية وحاسس بضغط... ' },
            { label: 'ممتن', draft: 'ممتن جدًا لحاجة حلوة حصلتلي مؤخرًا: ' },
            { label: 'عايز نصيحة', draft: 'محتاج رأيكم ونصيحتكم في موقف محيرني: ' },
          ].map((m) => (
            <button
              key={m.label}
              type="button"
              onClick={() =>
                currentUser ? onOpenComposer('confession', m.draft) : onRequireAuth()
              }
              className="min-h-[30px] px-2.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-violet-500/15 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-violet-300 whitespace-nowrap shrink-0 transition-colors"
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Horizontal Segmented Filter Strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {HOME_FILTERS.filter((f) => !('authOnly' in f && f.authOnly) || Boolean(currentUser)).map(
          (f) => {
            const active = activeFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setActiveFilter(f.id)}
                className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-violet-600 text-white'
                    : 'bg-white dark:bg-[#12121A] border border-slate-200/80 dark:border-white/8 text-slate-600 dark:text-slate-300 hover:border-violet-500/40'
                }`}
              >
                {f.label}
              </button>
            );
          }
        )}
      </div>

      {/* Feed List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 animate-pulse"
            />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div
          className="rounded-3xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center space-y-3"
          data-testid="empty-feed-state"
        >
          <div className="w-12 h-12 rounded-2xl bg-violet-500/10 text-violet-400 flex items-center justify-center mx-auto">
            <Feather className="w-6 h-6" />
          </div>
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
            لسه مفيش منشورات هنا، كن أول شخص يبدأ الحكاية.
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
            تقدر تشارك فضفضة مجهولة تمامًا أو تفتح موضوع نقاش جديد مع المجتمع.
          </p>
          <button
            type="button"
            onClick={() => (currentUser ? onOpenComposer('confession') : onRequireAuth())}
            className="min-h-[44px] px-5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>ابدأ أول فضفضة في مين؟</span>
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
              onUpdatePost={(updated) =>
                setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
              }
              onDeletePost={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
              onOpenProfile={onOpenProfile}
              onOpenCommunity={onOpenCommunity}
              onOpenReport={onOpenReport}
              onRequireAuth={onRequireAuth}
              onToast={onToast}
            />
          ))}

          {hasMore && (
            <button
              type="button"
              onClick={() => fetchFeed(false)}
              className="w-full min-h-[44px] rounded-xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 text-xs font-semibold text-violet-500 hover:border-violet-500 transition-colors"
            >
              عرض المزيد من المنشورات
            </button>
          )}
        </div>
      )}
    </div>
  );
};

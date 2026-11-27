import React, { useCallback, useEffect, useState } from 'react';
import { Bookmark, Search } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { applyRealtimePostEvent } from '../lib/realtimePosts';
import { PostCard } from '../components/PostCard';
import type { Post, User } from '../types';

interface SavedViewProps {
  currentUser: User;
  lastWsEvent?: Record<string, unknown> | null;
  onOpenProfile: (username: string) => void;
  onOpenCommunity: (communityId: number) => void;
  onOpenReport: (targetType: 'post' | 'comment' | 'user', targetId: number) => void;
  onRequireAuth: () => void;
  onToast: (msg: string) => void;
}

export const SavedView: React.FC<SavedViewProps> = ({
  currentUser,
  lastWsEvent,
  onOpenProfile,
  onOpenCommunity,
  onOpenReport,
  onRequireAuth,
  onToast,
}) => {
  const [items, setItems] = useState<Post[]>([]);
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (type !== 'all') params.set('type', type);
    if (q.trim()) params.set('q', q.trim());

    apiRequest<{ items: Post[] }>(`/saved?${params.toString()}`)
      .then((res) => setItems(res.items))
      .catch((err) => onToast(err instanceof Error ? err.message : 'تعذر تحميل المحفوظات.'))
      .finally(() => setLoading(false));
  }, [type, q, onToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!lastWsEvent) return;
    setItems((prev) => applyRealtimePostEvent(prev, lastWsEvent));
  }, [lastWsEvent]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3">
        <h2 className="font-display text-lg font-bold flex items-center gap-2">
          <Bookmark className="w-5 h-5 text-violet-500" />
          <span>المحفوظات</span>
        </h2>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث في المحفوظات..."
            className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 pr-10 pl-4 text-xs"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {(
            [
              { id: 'all', label: 'الكل' },
              { id: 'post', label: 'منشورات' },
              { id: 'confession', label: 'فضفضة' },
              { id: 'question', label: 'أسئلة' },
              { id: 'poll', label: 'تصويتات' },
              { id: 'community', label: 'مجتمعات' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setType(tab.id)}
              className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap ${
                type === tab.id
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-40 rounded-2xl bg-white dark:bg-[#12121A] animate-pulse" />
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center space-y-2">
          <Bookmark className="w-8 h-8 text-violet-400 mx-auto" />
          <p className="text-sm font-semibold">لا توجد عناصر محفوظة</p>
          <p className="text-xs text-slate-400">
            اضغط على أيقونة الحفظ في أي منشور أو فضفضة للرجوع إليها لاحقًا.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUser={currentUser}
              lastWsEvent={lastWsEvent}
              onUpdatePost={(u) => {
                if (!u.userSaved) {
                  setItems((prev) => prev.filter((p) => p.id !== u.id));
                } else {
                  setItems((prev) => prev.map((p) => (p.id === u.id ? u : p)));
                }
              }}
              onDeletePost={(id) => setItems((prev) => prev.filter((p) => p.id !== id))}
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

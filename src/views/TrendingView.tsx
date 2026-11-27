import React, { useEffect, useState } from 'react';
import { Flame, Hash } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { applyRealtimePostEvent } from '../lib/realtimePosts';
import { PostCard } from '../components/PostCard';
import type { Community, Post, User } from '../types';

interface TrendingViewProps {
  currentUser: User | null;
  lastWsEvent?: Record<string, unknown> | null;
  onOpenProfile: (username: string) => void;
  onOpenCommunity: (communityId: number) => void;
  onOpenReport: (targetType: 'post' | 'comment' | 'user', targetId: number) => void;
  onRequireAuth: () => void;
  onToast: (msg: string) => void;
}

export const TrendingView: React.FC<TrendingViewProps> = ({
  currentUser,
  lastWsEvent,
  onOpenProfile,
  onOpenCommunity,
  onOpenReport,
  onRequireAuth,
  onToast,
}) => {
  const [tab, setTab] = useState<'posts' | 'questions' | 'polls' | 'communities'>('posts');
  const [data, setData] = useState<{
    posts: Post[];
    questions: Post[];
    polls: Post[];
    communities: Community[];
    topics: Array<{ name: string; count: number }>;
  }>({ posts: [], questions: [], polls: [], communities: [], topics: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiRequest<typeof data>('/trending')
      .then((res) => setData(res))
      .catch((err) => onToast(err instanceof Error ? err.message : 'تعذر تحميل التريند.'))
      .finally(() => setLoading(false));
  }, [onToast]);

  useEffect(() => {
    if (!lastWsEvent) return;
    setData((prev) => ({
      ...prev,
      posts: applyRealtimePostEvent(prev.posts, lastWsEvent),
      questions: applyRealtimePostEvent(prev.questions, lastWsEvent),
      polls: applyRealtimePostEvent(prev.polls, lastWsEvent),
    }));
  }, [lastWsEvent]);

  const activePosts =
    tab === 'posts' ? data.posts : tab === 'questions' ? data.questions : data.polls;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5">
        <div className="flex items-center gap-2 text-violet-500 mb-1">
          <Flame className="w-5 h-5" />
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            التريند الآن
          </h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          يعتمد الترتيب على التفاعل والدعم والتعليقات والمشاركات وجودة المحتوى وحداثته، مع استبعاد المحتوى المخالف.
        </p>

        {data.topics.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-white/8">
            {data.topics.map((t) => (
              <span
                key={t.name}
                className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300"
              >
                <Hash className="w-3.5 h-3.5 text-violet-500" />
                <span>{t.name}</span>
                <span className="text-slate-400 tabular-nums">({t.count})</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {(
          [
            { id: 'posts', label: 'المنشورات الرائجة' },
            { id: 'questions', label: 'الأسئلة الرائجة' },
            { id: 'polls', label: 'التصويتات الرائجة' },
            { id: 'communities', label: 'المجتمعات الرائجة' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap ${
              tab === t.id
                ? 'bg-violet-600 text-white'
                : 'bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 text-slate-600 dark:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-40 rounded-2xl bg-white dark:bg-[#12121A] animate-pulse" />
      ) : tab === 'communities' ? (
        data.communities.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center text-xs text-slate-400">
            لا توجد مجتمعات رائجة حاليًا.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.communities.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenCommunity(c.id)}
                className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-4 text-right hover:border-violet-500/40"
              >
                <p className="text-sm font-bold">{c.name}</p>
                <p className="text-xs text-slate-400 mt-1 tabular-nums">
                  {c.category} · {c.membersCount} عضو
                </p>
              </button>
            ))}
          </div>
        )
      ) : activePosts.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center text-xs text-slate-400">
          لا يوجد محتوى رائج في هذا القسم حاليًا.
        </div>
      ) : (
        <div className="space-y-4">
          {activePosts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUser={currentUser}
              lastWsEvent={lastWsEvent}
              onUpdatePost={(updated) => {
                setData((prev) => ({
                  ...prev,
                  posts: prev.posts.map((p) => (p.id === updated.id ? updated : p)),
                  questions: prev.questions.map((p) => (p.id === updated.id ? updated : p)),
                  polls: prev.polls.map((p) => (p.id === updated.id ? updated : p)),
                }));
              }}
              onDeletePost={(deletedId) => {
                setData((prev) => ({
                  ...prev,
                  posts: prev.posts.filter((p) => p.id !== deletedId),
                  questions: prev.questions.filter((p) => p.id !== deletedId),
                  polls: prev.polls.filter((p) => p.id !== deletedId),
                }));
              }}
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

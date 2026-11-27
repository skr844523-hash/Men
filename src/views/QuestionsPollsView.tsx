import React, { useEffect, useState } from 'react';
import { BarChart2, HelpCircle, Plus } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { applyRealtimePostEvent } from '../lib/realtimePosts';
import { PostCard } from '../components/PostCard';
import type { Post, User } from '../types';

interface QuestionsPollsViewProps {
  mode: 'question' | 'poll';
  currentUser: User | null;
  refreshSignal: number;
  lastWsEvent?: Record<string, unknown> | null;
  onOpenComposer: (type: 'question' | 'poll') => void;
  onOpenProfile: (username: string) => void;
  onOpenCommunity: (communityId: number) => void;
  onOpenReport: (targetType: 'post' | 'comment' | 'user', targetId: number) => void;
  onRequireAuth: () => void;
  onToast: (msg: string) => void;
}

export const QuestionsPollsView: React.FC<QuestionsPollsViewProps> = ({
  mode,
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
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiRequest<{ items: Post[] }>(`/posts?type=${mode}&limit=30`)
      .then((res) => setPosts(res.items))
      .catch((err) => onToast(err instanceof Error ? err.message : 'تعذر التحميل.'))
      .finally(() => setLoading(false));
  }, [mode, refreshSignal, onToast]);

  useEffect(() => {
    if (!lastWsEvent) return;
    setPosts((prev) => applyRealtimePostEvent(prev, lastWsEvent));
  }, [lastWsEvent]);

  const isQuestion = mode === 'question';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-violet-500">
            {isQuestion ? <HelpCircle className="w-5 h-5" /> : <BarChart2 className="w-5 h-5" />}
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              {isQuestion ? 'قسم الأسئلة' : 'قسم التصويتات'}
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isQuestion
              ? 'اطرح سؤالك باسمك أو كمجهول واستقبل إجابات وتصويتات المجتمع.'
              : 'أنشئ تصويتًا بخيارات متعددة وتابع نسب المشاركة الحقيقية.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => (currentUser ? onOpenComposer(mode) : onRequireAuth())}
          className="min-h-[44px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{isQuestion ? 'سؤال جديد' : 'تصويت جديد'}</span>
        </button>
      </div>

      {loading ? (
        <div className="h-40 rounded-2xl bg-white dark:bg-[#12121A] animate-pulse" />
      ) : posts.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center space-y-3">
          {isQuestion ? (
            <HelpCircle className="w-10 h-10 text-violet-400 mx-auto" />
          ) : (
            <BarChart2 className="w-10 h-10 text-violet-400 mx-auto" />
          )}
          <h3 className="font-display text-base font-bold">
            {isQuestion ? 'لا توجد أسئلة بعد' : 'لا توجد تصويتات بعد'}
          </h3>
          <p className="text-xs text-slate-400">
            {isQuestion ? 'كن أول من يطرح سؤالًا للنقاش.' : 'أنشئ أول تصويت بين الأعضاء.'}
          </p>
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

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarHeart, Image as ImageIcon, Share2, Trophy } from 'lucide-react';
import { apiRequest, uploadMediaFile } from '../lib/api';
import { PostCard } from '../components/PostCard';
import type { Post, User } from '../types';

interface DailyChallengeProps {
  mode: 'daily' | 'challenges';
  currentUser: User | null;
  onOpenProfile: (username: string) => void;
  onOpenCommunity: (communityId: number) => void;
  onOpenReport: (targetType: 'post' | 'comment' | 'user', targetId: number) => void;
  onRequireAuth: () => void;
  onToast: (msg: string) => void;
}

export const DailyQuestionChallengesView: React.FC<DailyChallengeProps> = ({
  mode,
  currentUser,
  onOpenProfile,
  onOpenCommunity,
  onOpenReport,
  onRequireAuth,
  onToast,
}) => {
  // Daily Question state
  const [dailyData, setDailyData] = useState<{
    activeQuestion: { id: number; questionText: string; dateKey: string } | null;
    archive: Array<{ id: number; questionText: string; dateKey: string; isActive: boolean }>;
    answers: Post[];
  }>({ activeQuestion: null, archive: [], answers: [] });
  const [selectedArchiveId, setSelectedArchiveId] = useState<number | null>(null);
  const [dailyText, setDailyText] = useState('');
  const [dailyAnon, setDailyAnon] = useState(false);

  // Challenges state
  const [challenges, setChallenges] = useState<
    Array<{
      id: number;
      title: string;
      description: string;
      category: string;
      pointsReward: number;
      status: 'active' | 'ended';
      entriesCount: number;
      userParticipated: boolean;
      entries: Post[];
    }>
  >([]);
  const [entryChallengeId, setEntryChallengeId] = useState<number | null>(null);
  const [entryText, setEntryText] = useState('');
  const [entryMedia, setEntryMedia] = useState<string | null>(null);
  const [entryAnon, setEntryAnon] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadDaily = useCallback(
    (archiveId?: number | null) => {
      setLoading(true);
      const q = archiveId ? `?id=${archiveId}` : '';
      apiRequest<typeof dailyData>(`/daily-question${q}`)
        .then((res) => setDailyData(res))
        .catch((err) => onToast(err instanceof Error ? err.message : 'تعذر التحميل.'))
        .finally(() => setLoading(false));
    },
    [onToast]
  );

  const loadChallenges = useCallback(() => {
    setLoading(true);
    apiRequest<{ challenges: typeof challenges }>('/challenges')
      .then((res) => setChallenges(res.challenges))
      .catch((err) => onToast(err instanceof Error ? err.message : 'تعذر التحميل.'))
      .finally(() => setLoading(false));
  }, [onToast]);

  useEffect(() => {
    if (mode === 'daily') loadDaily(selectedArchiveId);
    else loadChallenges();
  }, [mode, selectedArchiveId, loadDaily, loadChallenges]);

  const submitDailyAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return onRequireAuth();
    const targetId = selectedArchiveId || dailyData.activeQuestion?.id;
    if (!targetId || !dailyText.trim()) return;
    try {
      await apiRequest(`/daily-question/${targetId}/answer`, {
        method: 'POST',
        body: { content: dailyText, isAnonymous: dailyAnon },
      });
      setDailyText('');
      onToast('تم نشر إجابتك وحصلت على نقاط المشاركة!');
      loadDaily(selectedArchiveId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر النشر.');
    }
  };

  const submitChallengeEntry = async (e: React.FormEvent, challengeId: number) => {
    e.preventDefault();
    if (!currentUser) return onRequireAuth();
    if (!entryText.trim()) return;
    try {
      await apiRequest(`/challenges/${challengeId}/enter`, {
        method: 'POST',
        body: { content: entryText, mediaUrl: entryMedia, isAnonymous: entryAnon },
      });
      setEntryText('');
      setEntryMedia(null);
      setEntryChallengeId(null);
      onToast('تمت مشاركتك في التحدي وحصلت على النقاط والشارة!');
      loadChallenges();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر إرسال المشاركة.');
    }
  };

  if (mode === 'daily') {
    const shownQuestion =
      dailyData.archive.find((a) => a.id === selectedArchiveId) || dailyData.activeQuestion;

    return (
      <div className="space-y-4">
        <div className="rounded-3xl overflow-hidden relative bg-[#12121A] border border-white/10 text-white">
          <img
            src="/src/assets/images/meen_daily_prompt_bg_1795731517868.jpg"
            alt="خلفية سؤال اليوم"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover opacity-70"
          />
          <div className="relative z-10 p-6 space-y-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-300">
                <CalendarHeart className="w-4 h-4" />
                <span>سؤال اليوم · {shownQuestion?.dateKey || ''}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  if (navigator.clipboard && shownQuestion) {
                    navigator.clipboard.writeText(shownQuestion.questionText).catch(() => {});
                  }
                  onToast('تم نسخ سؤال اليوم لمشاركته.');
                }}
                className="min-h-[36px] px-3 rounded-xl bg-white/10 hover:bg-white/20 text-xs flex items-center gap-1.5"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>مشاركة</span>
              </button>
            </div>
            <h2 className="font-display text-xl sm:text-2xl font-bold leading-snug">
              {shownQuestion?.questionText || 'جاري التحميل...'}
            </h2>

            <form onSubmit={submitDailyAnswer} className="space-y-2.5 pt-2">
              <textarea
                rows={2}
                value={dailyText}
                onChange={(e) => setDailyText(e.target.value)}
                placeholder="شارك إجابتك على سؤال اليوم..."
                className="w-full rounded-2xl bg-black/50 border border-white/15 p-3 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-violet-400"
              />
              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dailyAnon}
                    onChange={(e) => setDailyAnon(e.target.checked)}
                    className="accent-violet-500"
                  />
                  <span>الإجابة كمجهول</span>
                </label>
                <button
                  type="submit"
                  className="min-h-[42px] px-5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
                >
                  نشر الإجابة
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Archive selector */}
        {dailyData.archive.length > 1 && (
          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-4 space-y-2">
            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-300">
              أرشيف الأسئلة السابقة
            </h3>
            <div className="flex flex-wrap gap-2">
              {dailyData.archive.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setSelectedArchiveId(q.isActive ? null : q.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                    (selectedArchiveId === null && q.isActive) || selectedArchiveId === q.id
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {q.dateKey}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Answers List */}
        {loading ? (
          <div className="h-36 rounded-2xl bg-white dark:bg-[#12121A] animate-pulse" />
        ) : dailyData.answers.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center text-xs text-slate-400">
            لا توجد إجابات على هذا السؤال بعد. كن أول من يشارك!
          </div>
        ) : (
          <div className="space-y-4">
            {dailyData.answers.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                currentUser={currentUser}
                onUpdatePost={(u) =>
                  setDailyData((prev) => ({
                    ...prev,
                    answers: prev.answers.map((p) => (p.id === u.id ? u : p)),
                  }))
                }
                onDeletePost={(id) =>
                  setDailyData((prev) => ({
                    ...prev,
                    answers: prev.answers.filter((p) => p.id !== id),
                  }))
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
      </div>
    );
  }

  // Challenges View
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5">
        <div className="flex items-center gap-2 text-violet-500 mb-1">
          <Trophy className="w-5 h-5" />
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            التحديات الإيجابية
          </h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          تحديات اجتماعية خفيفة وآمنة لاكتساب النقاط والشارات ومشاركة اللحظات الإيجابية.
        </p>
      </div>

      {loading ? (
        <div className="h-40 rounded-2xl bg-white dark:bg-[#12121A] animate-pulse" />
      ) : (
        <div className="space-y-4">
          {challenges.map((ch) => (
            <div
              key={ch.id}
              className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs text-violet-500 font-semibold mb-1">
                    <span>{ch.category}</span>
                    <span>·</span>
                    <span className="tabular-nums">+{ch.pointsReward} نقطة</span>
                    <span>·</span>
                    <span>{ch.status === 'active' ? 'جاري الآن' : 'منتهي'}</span>
                  </div>
                  <h3 className="font-display text-base font-bold">{ch.title}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-300 mt-1 leading-relaxed">
                    {ch.description}
                  </p>
                </div>

                {ch.status === 'active' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!currentUser) return onRequireAuth();
                      setEntryChallengeId((prev) => (prev === ch.id ? null : ch.id));
                    }}
                    className="min-h-[42px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shrink-0"
                  >
                    {ch.userParticipated ? 'مشاركة إضافية' : 'شارك في التحدي'}
                  </button>
                )}
              </div>

              {entryChallengeId === ch.id && (
                <form
                  onSubmit={(e) => submitChallengeEntry(e, ch.id)}
                  className="rounded-2xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 p-4 space-y-3"
                >
                  <textarea
                    rows={3}
                    required
                    value={entryText}
                    onChange={(e) => setEntryText(e.target.value)}
                    placeholder="اكتب مشاركتك في التحدي بدون ذكر بيانات شخصية..."
                    className="w-full rounded-xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 p-3 text-sm"
                  />
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <label className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-white/10 flex items-center gap-1.5 text-xs cursor-pointer">
                      <ImageIcon className="w-4 h-4 text-violet-500" />
                      <span>{entryMedia ? 'تم إرفاق صورة' : 'إرفاق صورة'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={async (ev) => {
                          const f = ev.target.files?.[0];
                          if (f) {
                            const url = await uploadMediaFile(f);
                            setEntryMedia(url);
                          }
                        }}
                        className="hidden"
                      />
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={entryAnon}
                        onChange={(e) => setEntryAnon(e.target.checked)}
                        className="accent-violet-600"
                      />
                      <span>كمجهول</span>
                    </label>
                    <button
                      type="submit"
                      className="min-h-[40px] px-4 rounded-xl bg-violet-600 text-white text-xs font-semibold"
                    >
                      إرسال المشاركة
                    </button>
                  </div>
                </form>
              )}

              {ch.entries.length > 0 ? (
                <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-white/8">
                  <p className="text-xs font-semibold text-slate-400">
                    المشاركات ({ch.entriesCount})
                  </p>
                  {ch.entries.map((entry) => (
                    <PostCard
                      key={entry.id}
                      post={entry}
                      currentUser={currentUser}
                      onUpdatePost={() => loadChallenges()}
                      onDeletePost={() => loadChallenges()}
                      onOpenProfile={onOpenProfile}
                      onOpenCommunity={onOpenCommunity}
                      onOpenReport={onOpenReport}
                      onRequireAuth={onRequireAuth}
                      onToast={onToast}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 pt-2 border-t border-slate-100 dark:border-white/8">
                  لا توجد مشاركات في هذا التحدي بعد. كن أول مشارك!
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import {
  Award,
  Bell,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Edit3,
  Flag,
  Heart,
  HeartHandshake,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Send,
  Share2,
  Trash2,
} from 'lucide-react';
import { apiRequest, formatRelativeArabic } from '../lib/api';
import type { AnswerItem, CommentItem, CommentReply, Post, User } from '../types';

interface PostCardProps {
  post: Post;
  currentUser: User | null;
  lastWsEvent?: Record<string, unknown> | null;
  onUpdatePost: (updated: Post) => void;
  onDeletePost: (postId: number) => void;
  onOpenProfile: (username: string) => void;
  onOpenCommunity: (communityId: number) => void;
  onOpenReport: (targetType: 'post' | 'comment' | 'user', targetId: number) => void;
  onRequireAuth: () => void;
  onToast: (msg: string) => void;
}

export const PostCard: React.FC<PostCardProps> = ({
  post,
  currentUser,
  lastWsEvent,
  onUpdatePost,
  onDeletePost,
  onOpenProfile,
  onOpenCommunity,
  onOpenReport,
  onRequireAuth,
  onToast,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [savingEdit, setSavingEdit] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentAnon, setCommentAnon] = useState(false);
  const [replyTargetId, setReplyTargetId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');

  // Question answers state
  const [answersOpen, setAnswersOpen] = useState(false);
  const [answers, setAnswers] = useState<AnswerItem[]>([]);
  const [loadingAnswers, setLoadingAnswers] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [answerAnon, setAnswerAnon] = useState(false);

  // Realtime hints (post:comment_new / post:reply_new) carry only ids and counters,
  // so open threads refetch their comments through the API (which enforces visibility).
  useEffect(() => {
    if (!lastWsEvent || !commentsOpen) return;
    if ((lastWsEvent.type === 'post:comment_new' || lastWsEvent.type === 'post:reply_new') && Number(lastWsEvent.postId) === post.id) {
      apiRequest<{ comments: CommentItem[] }>(`/posts/${post.id}/comments`)
        .then((res) => setComments(res.comments))
        .catch(() => {});
    }
  }, [lastWsEvent, commentsOpen, post.id]);

  const handleReact = async (reactionType: 'like' | 'support') => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    try {
      const res = await apiRequest<{
        active: boolean;
        likesCount: number;
        supportsCount: number;
      }>(`/posts/${post.id}/react`, {
        method: 'POST',
        body: { reactionType },
      });
      onUpdatePost({
        ...post,
        likesCount: res.likesCount,
        supportsCount: res.supportsCount,
        userLiked: reactionType === 'like' ? res.active : post.userLiked,
        userSupported: reactionType === 'support' ? res.active : post.userSupported,
      });
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر التفاعل.');
    }
  };

  const handleSave = async () => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    try {
      const res = await apiRequest<{ saved: boolean }>(`/posts/${post.id}/save`, {
        method: 'POST',
        body: { tag: post.category },
      });
      onUpdatePost({
        ...post,
        userSaved: res.saved,
        savesCount: post.savesCount + (res.saved ? 1 : -1),
      });
      onToast(res.saved ? 'تم حفظ المنشور في محفوظاتك.' : 'تمت إزالة المنشور من المحفوظات.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر الحفظ.');
    }
  };

  const handleFollowPost = async () => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    try {
      const res = await apiRequest<{ following: boolean }>(`/posts/${post.id}/follow`, {
        method: 'POST',
      });
      onUpdatePost({ ...post, userFollowingPost: res.following });
      setMenuOpen(false);
      onToast(res.following ? 'تتابع هذا المنشور الآن وستصلك إشعارات بتعليقاته.' : 'تم إلغاء متابعة المنشور.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تنفيذ الطلب.');
    }
  };

  const handleShare = async () => {
    try {
      const res = await apiRequest<{ sharesCount: number }>(`/posts/${post.id}/share`, {
        method: 'POST',
      });
      onUpdatePost({ ...post, sharesCount: res.sharesCount });
      const url = `${window.location.origin}/?post=${post.id}`;
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url).catch(() => {});
      }
      onToast('تم نسخ رابط المشاركة.');
    } catch {
      onToast('تمت مشاركة المنشور.');
    }
  };

  const handleDelete = async () => {
    try {
      await apiRequest(`/posts/${post.id}`, { method: 'DELETE' });
      onDeletePost(post.id);
      onToast('تم حذف المنشور.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر حذف المنشور.');
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editContent.trim()) return;
    setSavingEdit(true);
    try {
      const res = await apiRequest<{ post: Post }>(`/posts/${post.id}`, {
        method: 'PATCH',
        body: { content: editContent },
      });
      onUpdatePost(res.post);
      setEditing(false);
      onToast('تم تعديل المنشور.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تعديل المنشور.');
    } finally {
      setSavingEdit(false);
    }
  };

  const loadComments = async () => {
    setLoadingComments(true);
    try {
      const res = await apiRequest<{ comments: CommentItem[] }>(`/posts/${post.id}/comments`);
      setComments(res.comments);
    } finally {
      setLoadingComments(false);
    }
  };

  const toggleComments = async () => {
    const next = !commentsOpen;
    setCommentsOpen(next);
    if (next) {
      await loadComments();
    }
  };

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    if (!commentText.trim()) return;
    try {
      const res = await apiRequest<{ comment: CommentItem }>(`/posts/${post.id}/comments`, {
        method: 'POST',
        body: { content: commentText, isAnonymous: commentAnon },
      });
      setComments((prev) => [...prev, res.comment]);
      setCommentText('');
      onUpdatePost({ ...post, commentsCount: post.commentsCount + 1 });
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر إضافة التعليق.');
    }
  };

  const submitReply = async (commentId: number) => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    if (!replyText.trim()) return;
    try {
      await apiRequest(`/comments/${commentId}/replies`, {
        method: 'POST',
        body: { content: replyText, isAnonymous: commentAnon },
      });
      setReplyText('');
      setReplyTargetId(null);
      await loadComments();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر إرسال الرد.');
    }
  };

  const handleVotePoll = async (optionId: number) => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    try {
      const res = await apiRequest<{ post: Post }>(`/polls/${post.id}/vote`, {
        method: 'POST',
        body: { optionId },
      });
      onUpdatePost(res.post);
      onToast('تم تسجيل صوتك بنجاح.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر التصويت.');
    }
  };

  const loadAnswers = async () => {
    setLoadingAnswers(true);
    try {
      const res = await apiRequest<{ answers: AnswerItem[] }>(`/questions/${post.id}/answers`);
      setAnswers(res.answers);
    } finally {
      setLoadingAnswers(false);
    }
  };

  const toggleAnswers = async () => {
    const next = !answersOpen;
    setAnswersOpen(next);
    if (next) {
      await loadAnswers();
    }
  };

  const submitAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    if (!answerText.trim()) return;
    try {
      await apiRequest(`/questions/${post.id}/answers`, {
        method: 'POST',
        body: { content: answerText, isAnonymous: answerAnon },
      });
      setAnswerText('');
      await loadAnswers();
      if (post.question) {
        onUpdatePost({
          ...post,
          question: { ...post.question, answersCount: post.question.answersCount + 1 },
        });
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر نشر الإجابة.');
    }
  };

  const handleVoteAnswer = async (answerId: number, value: 1 | -1) => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    try {
      await apiRequest(`/answers/${answerId}/vote`, { method: 'POST', body: { value } });
      await loadAnswers();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر التصويت.');
    }
  };

  const handleBestAnswer = async (answerId: number) => {
    try {
      await apiRequest(`/questions/${post.id}/best-answer`, {
        method: 'POST',
        body: { answerId },
      });
      await loadAnswers();
      if (post.question) {
        onUpdatePost({ ...post, question: { ...post.question, bestAnswerId: answerId } });
      }
      onToast('تم تحديد أفضل إجابة.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تحديد أفضل إجابة.');
    }
  };

  return (
    <article
      className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200/80 dark:border-white/8 p-4 sm:p-5 transition-colors"
      data-testid={`post-card-${post.id}`}
    >
      {/* Header: Author + Unboxed Inline Metadata */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {post.isAnonymous || !post.author ? (
            <div className="w-10 h-10 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4 text-violet-400" />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onOpenProfile(post.author!.username)}
              className="w-10 h-10 rounded-full overflow-hidden border border-slate-200 dark:border-white/10 shrink-0"
              aria-label={`عرض ملف ${post.author.displayName}`}
            >
              <img
                src={post.author.avatar}
                alt={post.author.displayName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </button>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {post.isAnonymous || !post.author ? (
                <span className="text-sm font-bold text-slate-900 dark:text-white">مجهول</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenProfile(post.author!.username)}
                  className="text-sm font-bold text-slate-900 dark:text-white hover:text-violet-400 transition-colors truncate"
                >
                  {post.author.displayName}
                </button>
              )}
              {post.author && (
                <span className="text-xs font-mono text-slate-500" dir="ltr">
                  @{post.author.username}
                </span>
              )}
            </div>

            {/* Clean unboxed inline metadata separated by · */}
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 flex-wrap mt-0.5">
              <span>{post.type === 'confession' ? 'فضفضة' : post.category}</span>
              {post.moodType && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{post.moodType}</span>
                </>
              )}
              {post.communityName && post.communityId && (
                <>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => onOpenCommunity(post.communityId!)}
                    className="text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    {post.communityName}
                  </button>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{formatRelativeArabic(post.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Options menu */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
            aria-label="خيارات المنشور"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>

          {menuOpen && (
            <div className="absolute left-0 top-11 z-20 w-48 rounded-2xl bg-white dark:bg-[#1A1A26] border border-slate-200 dark:border-white/10 shadow-xl py-1.5 text-xs">
              <button
                type="button"
                onClick={handleFollowPost}
                className="w-full px-3.5 py-2.5 flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/5 text-right"
              >
                <Bell className="w-4 h-4 text-violet-400" />
                <span>{post.userFollowingPost ? 'إلغاء متابعة المنشور' : 'متابعة المنشور'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  if (!currentUser) return onRequireAuth();
                  onOpenReport('post', post.id);
                }}
                className="w-full px-3.5 py-2.5 flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/5 text-rose-500 text-right"
              >
                <Flag className="w-4 h-4" />
                <span>إبلاغ عن المنشور</span>
              </button>
              {post.isOwner && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setEditContent(post.content);
                      setEditing(true);
                    }}
                    className="w-full px-3.5 py-2.5 flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/5 text-right"
                  >
                    <Edit3 className="w-4 h-4 text-violet-400" />
                    <span>تعديل المنشور</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      handleDelete();
                    }}
                    className="w-full px-3.5 py-2.5 flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/5 text-rose-500 text-right"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>حذف المنشور</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body Content */}
      <div className="mt-3.5 space-y-3">
        {editing ? (
          <form onSubmit={handleSaveEdit} className="space-y-2">
            <textarea
              rows={3}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full rounded-xl bg-slate-50 dark:bg-[#09090D] border border-violet-500/40 p-3 text-sm"
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="min-h-[36px] px-3 rounded-xl bg-slate-100 dark:bg-white/5 text-xs"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="min-h-[36px] px-4 rounded-xl bg-violet-600 text-white text-xs font-semibold"
              >
                {savingEdit ? 'جاري الحفظ...' : 'حفظ التعديل'}
              </button>
            </div>
          </form>
        ) : (
          <p className="text-[15px] leading-[1.7] text-slate-800 dark:text-slate-100 whitespace-pre-wrap">
            {post.content}
          </p>
        )}

        {post.mediaUrl && (
          <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 bg-[#09090D]">
            <img
              src={post.mediaUrl}
              alt="صورة مرفقة بالمنشور"
              referrerPolicy="no-referrer"
              className="w-full max-h-96 object-cover"
            />
          </div>
        )}

        {/* Poll UI */}
        {post.type === 'poll' && post.poll && (
          <div className="space-y-2 pt-1">
            {post.poll.options.map((opt) => {
              const isSelected = post.poll?.userVotedOptionId === opt.id;
              const pct = opt.percent ?? 0;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={Boolean(post.poll?.userVotedOptionId)}
                  onClick={() => handleVotePoll(opt.id)}
                  className={`relative w-full min-h-[44px] rounded-xl border overflow-hidden px-3.5 py-2.5 flex items-center justify-between text-sm transition-colors text-right ${
                    isSelected
                      ? 'border-violet-500 text-slate-900 dark:text-white font-semibold'
                      : 'border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-violet-500/50'
                  }`}
                >
                  {post.poll?.showResults && (
                    <span
                      className={`absolute inset-y-0 right-0 transition-all duration-300 ${
                        isSelected ? 'bg-violet-600/25' : 'bg-slate-200/60 dark:bg-white/8'
                      }`}
                      style={{ width: `${pct}%` }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10">{opt.label}</span>
                  {post.poll?.showResults && (
                    <span className="relative z-10 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-300">
                      {pct}%
                    </span>
                  )}
                </button>
              );
            })}
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              إجمالي المشاركين: {post.poll.totalVotes}
              {!post.poll.showResults && ' · ستظهر النتائج بعد التصويت'}
            </p>
          </div>
        )}

        {/* Question Answers Toggle */}
        {post.type === 'question' && post.question && (
          <div className="pt-1">
            <button
              type="button"
              onClick={toggleAnswers}
              className="min-h-[40px] px-3.5 rounded-xl bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 dark:text-violet-300 text-xs font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <span>
                {answersOpen
                  ? 'إخفاء الإجابات'
                  : `عرض وإضافة إجابات (${post.question.answersCount})`}
              </span>
              {answersOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        )}
      </div>

      {/* Action Bar */}
      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-white/8 flex items-center justify-between gap-1 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleReact('like')}
            className={`min-h-[40px] px-2.5 rounded-xl flex items-center gap-1.5 text-xs font-medium transition-colors ${
              post.userLiked
                ? 'text-rose-500 bg-rose-500/10'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
            }`}
            aria-label={`إعجاب (${post.likesCount})`}
          >
            <Heart className={`w-4 h-4 ${post.userLiked ? 'fill-current' : ''}`} />
            <span className="tabular-nums">{post.likesCount}</span>
          </button>

          <button
            type="button"
            onClick={() => handleReact('support')}
            className={`min-h-[40px] px-2.5 rounded-xl flex items-center gap-1.5 text-xs font-medium transition-colors ${
              post.userSupported
                ? 'text-violet-400 bg-violet-500/15'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
            }`}
            aria-label={`دعم (${post.supportsCount})`}
          >
            <HeartHandshake className="w-4 h-4" />
            <span>دعم</span>
            <span className="tabular-nums">{post.supportsCount}</span>
          </button>

          <button
            type="button"
            onClick={toggleComments}
            className="min-h-[40px] px-2.5 rounded-xl flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
            aria-label={`تعليقات (${post.commentsCount})`}
          >
            <MessageCircle className="w-4 h-4" />
            <span className="tabular-nums">{post.commentsCount}</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleShare}
            className="min-h-[40px] px-2.5 rounded-xl flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
            aria-label="مشاركة"
          >
            <Share2 className="w-4 h-4" />
            {post.sharesCount > 0 && <span className="tabular-nums">{post.sharesCount}</span>}
          </button>

          <button
            type="button"
            onClick={handleSave}
            className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl transition-colors ${
              post.userSaved
                ? 'text-violet-400 bg-violet-500/15'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
            }`}
            aria-label={post.userSaved ? 'إزالة من المحفوظات' : 'حفظ المنشور'}
          >
            <Bookmark className={`w-4 h-4 ${post.userSaved ? 'fill-current' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => {
              if (!currentUser) return onRequireAuth();
              onOpenReport('post', post.id);
            }}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
            aria-label="إبلاغ"
          >
            <Flag className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Question Answers Drawer */}
      {answersOpen && post.type === 'question' && (
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-white/8 space-y-3">
          {loadingAnswers ? (
            <p className="text-xs text-slate-400">جاري تحميل الإجابات...</p>
          ) : answers.length === 0 ? (
            <p className="text-xs text-slate-400">لا توجد إجابات بعد. كن أول من يجيب.</p>
          ) : (
            <div className="space-y-2.5">
              {answers.map((ans) => (
                <div
                  key={ans.id}
                  className={`rounded-xl p-3 border ${
                    ans.isBest
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#09090D]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">
                        {ans.isAnonymous || !ans.author ? 'مجهول' : ans.author.displayName}
                      </span>
                      <span className="text-slate-400">· {formatRelativeArabic(ans.createdAt)}</span>
                      {ans.isBest && (
                        <span className="inline-flex items-center gap-1 text-emerald-500 font-semibold">
                          <Award className="w-3.5 h-3.5" /> أفضل إجابة
                        </span>
                      )}
                    </div>
                    {post.question?.allowVoting && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleVoteAnswer(ans.id, 1)}
                          className={`px-2 py-1 rounded-lg text-xs ${
                            ans.userVote === 1 ? 'bg-violet-600 text-white' : 'bg-white/5 text-slate-400'
                          }`}
                          aria-label="تصويت إيجابي"
                        >
                          ▲
                        </button>
                        <span className="font-mono tabular-nums px-1">{ans.score}</span>
                        <button
                          type="button"
                          onClick={() => handleVoteAnswer(ans.id, -1)}
                          className={`px-2 py-1 rounded-lg text-xs ${
                            ans.userVote === -1 ? 'bg-rose-600 text-white' : 'bg-white/5 text-slate-400'
                          }`}
                          aria-label="تصويت سلبي"
                        >
                          ▼
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed">{ans.content}</p>
                  {post.isOwner && !ans.isBest && (
                    <button
                      type="button"
                      onClick={() => handleBestAnswer(ans.id)}
                      className="mt-2 text-xs text-emerald-500 hover:underline font-medium"
                    >
                      تحديد كأفضل إجابة
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <form onSubmit={submitAnswer} className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder="اكتب إجابتك..."
                className="flex-1 min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
              />
              <button
                type="submit"
                className="min-h-[42px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
              >
                إجابة
              </button>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={answerAnon}
                onChange={(e) => setAnswerAnon(e.target.checked)}
                className="accent-violet-600"
              />
              <span>الإجابة كمجهول</span>
            </label>
          </form>
        </div>
      )}

      {/* Comments & Replies Drawer */}
      {commentsOpen && (
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-white/8 space-y-3">
          {!post.allowComments ? (
            <p className="text-xs text-slate-400">التعليقات مغلقة على هذا المنشور.</p>
          ) : (
            <>
              {loadingComments ? (
                <p className="text-xs text-slate-400">جاري تحميل التعليقات...</p>
              ) : comments.length === 0 ? (
                <p className="text-xs text-slate-400">لا توجد تعليقات بعد. شارك برأيك.</p>
              ) : (
                <div className="space-y-2.5">
                  {comments.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200/70 dark:border-white/8 p-3"
                    >
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold">
                            {c.isAnonymous || !c.author ? 'مجهول' : c.author.displayName}
                          </span>
                          <span className="text-slate-400">· {formatRelativeArabic(c.createdAt)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setReplyTargetId((prev) => (prev === c.id ? null : c.id))
                            }
                            className="text-violet-500 hover:underline"
                          >
                            رد
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!currentUser) return onRequireAuth();
                              onOpenReport('comment', c.id);
                            }}
                            className="text-slate-400 hover:text-rose-400"
                            aria-label="إبلاغ عن تعليق"
                          >
                            <Flag className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="text-sm leading-relaxed">{c.content}</p>

                      {/* Nested replies */}
                      {c.replies.length > 0 && (
                        <div className="mt-2.5 pr-3 border-r border-slate-200 dark:border-white/10 space-y-2">
                          {c.replies.map((r) => (
                            <div key={r.id} className="text-xs">
                              <span className="font-bold">
                                {r.isAnonymous || !r.author ? 'مجهول' : r.author.displayName}
                              </span>
                              <span className="text-slate-400 mx-1">
                                · {formatRelativeArabic(r.createdAt)}
                              </span>
                              <p className="mt-0.5 text-slate-700 dark:text-slate-200">{r.content}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {replyTargetId === c.id && (
                        <div className="mt-2.5 flex items-center gap-2">
                          <input
                            type="text"
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="اكتب ردك..."
                            className="flex-1 min-h-[38px] rounded-xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 px-3 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => submitReply(c.id)}
                            className="min-h-[38px] px-3 rounded-xl bg-violet-600 text-white text-xs font-semibold"
                          >
                            إرسال
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={submitComment} className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="اكتب تعليقًا داعمًا..."
                    aria-label="اكتب تعليقًا"
                    className="flex-1 min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm focus:outline-none focus:border-violet-500"
                  />
                  <button
                    type="submit"
                    className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl bg-violet-600 hover:bg-violet-500 text-white"
                    aria-label="إرسال التعليق"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={commentAnon}
                    onChange={(e) => setCommentAnon(e.target.checked)}
                    className="accent-violet-600"
                  />
                  <span>التعليق كمجهول</span>
                </label>
              </form>
            </>
          )}
        </div>
      )}
    </article>
  );
};

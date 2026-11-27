import React, { useState } from 'react';
import {
  BarChart2,
  Eye,
  Feather,
  HelpCircle,
  Image as ImageIcon,
  Lock,
  MessageSquareHeart,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest, uploadMediaFile } from '../lib/api';
import type { Post, User } from '../types';

interface PostComposerModalProps {
  user: User;
  categories: string[];
  initialType?: 'post' | 'confession' | 'question' | 'poll';
  communityId?: number | null;
  communityName?: string | null;
  draftText: string;
  onSaveDraft: (text: string) => void;
  onClose: () => void;
  onPublished: (post: Post) => void;
}

const CONFESSION_MOODS = [
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

const QUESTION_TYPES = ['سؤال عام', 'سؤال شخصي', 'سؤال للنقاش', 'سؤال اختيار من متعدد'];

export const PostComposerModal: React.FC<PostComposerModalProps> = ({
  user,
  categories,
  initialType = 'confession',
  communityId = null,
  communityName = null,
  draftText,
  onSaveDraft,
  onClose,
  onPublished,
}) => {
  const [type, setType] = useState<'post' | 'confession' | 'question' | 'poll'>(initialType);
  const [content, setContent] = useState(draftText);
  const [category, setCategory] = useState(
    initialType === 'confession' ? 'فضفضة' : categories[0] || 'فضفضة'
  );
  const [moodType, setMoodType] = useState('فضفضة عامة');
  const [isAnonymous, setIsAnonymous] = useState(initialType === 'confession');
  const [audience, setAudience] = useState<'public' | 'friends'>('public');
  const [allowComments, setAllowComments] = useState(true);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  // Question specific
  const [questionType, setQuestionType] = useState(QUESTION_TYPES[0]);
  const [allowVoting, setAllowVoting] = useState(true);

  // Poll specific
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollShowResults, setPollShowResults] = useState<'always' | 'after_vote'>('always');
  const [pollDurationHours, setPollDurationHours] = useState<string>('24');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const url = await uploadMediaFile(file);
      setMediaUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر رفع الصورة.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await apiRequest<{ post: Post }>('/posts', {
        method: 'POST',
        body: {
          type,
          category: type === 'confession' ? 'فضفضة' : category,
          moodType: type === 'confession' ? moodType : undefined,
          content,
          mediaUrl,
          isAnonymous: isAnonymous || (type === 'confession' && moodType === 'فضفضة بدون اسم'),
          allowComments,
          audience: communityId ? 'community' : audience,
          communityId,
          questionType,
          allowVoting,
          pollOptions: type === 'poll' ? pollOptions.filter((o) => o.trim()) : undefined,
          pollShowResults,
          pollDurationHours: pollDurationHours ? Number(pollDurationHours) : null,
        },
      });
      onSaveDraft('');
      onPublished(res.post);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر نشر المحتوى.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="إنشاء منشور جديد"
    >
      <div className="w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 max-h-[92vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              {communityName ? `نشر في ${communityName}` : 'احكي اللي جواك'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewMode((v) => !v)}
              className={`min-h-[38px] px-3 rounded-xl text-xs font-medium flex items-center gap-1.5 border transition-colors ${
                previewMode
                  ? 'border-violet-500 bg-violet-500/15 text-violet-400'
                  : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-300'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{previewMode ? 'تعديل' : 'معاينة'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onSaveDraft(content);
                onClose();
              }}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:bg-white/5"
              aria-label="إغلاق وحفظ المسودة"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          {/* Type Switcher */}
          <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-white/5">
            {(
              [
                { id: 'confession', label: 'فضفضة', icon: MessageSquareHeart },
                { id: 'post', label: 'منشور', icon: Feather },
                { id: 'question', label: 'سؤال', icon: HelpCircle },
                { id: 'poll', label: 'تصويت', icon: BarChart2 },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setType(item.id);
                    if (item.id === 'confession') setIsAnonymous(true);
                  }}
                  className={`min-h-[40px] flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    type === item.id
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-500 dark:text-rose-300"
            >
              {error}
            </div>
          )}

          {previewMode ? (
            <div className="rounded-2xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center overflow-hidden">
                  {isAnonymous ? (
                    <Lock className="w-5 h-5 text-violet-400" />
                  ) : (
                    <img src={user.avatar} alt={user.displayName} className="w-full h-full object-cover" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-bold">{isAnonymous ? 'مجهول' : user.displayName}</p>
                  <p className="text-xs text-slate-400">
                    {type === 'confession' ? `فضفضة · ${moodType}` : category} · معاينة
                  </p>
                </div>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {content || 'لم تكتب نصًا بعد...'}
              </p>
              {mediaUrl && (
                <img
                  src={mediaUrl}
                  alt="معاينة المرفق"
                  className="rounded-xl max-h-60 w-full object-cover"
                />
              )}
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="composer-content" className="sr-only">
                  محتوى المنشور
                </label>
                <textarea
                  id="composer-content"
                  rows={4}
                  required
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={
                    type === 'confession'
                      ? 'فضفض بحرية... محدش هيعرف هويتك لو اخترت النشر كمجهول.'
                      : type === 'question'
                        ? 'اكتب سؤالك بوضوح ليشاركك المجتمع بالإجابات...'
                        : type === 'poll'
                          ? 'اكتب سؤال التصويت هنا...'
                          : 'شارك قصتك أو موقفك أو فكرتك مع المجتمع...'
                  }
                  className="w-full rounded-2xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 p-3.5 text-sm leading-relaxed focus:outline-none focus:border-violet-500"
                />
              </div>

              {/* Category or Confession Mood */}
              {type === 'confession' ? (
                <div>
                  <span className="block text-xs font-semibold text-slate-500 dark:text-slate-300 mb-1.5">
                    نوع الفضفضة
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {CONFESSION_MOODS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setMoodType(m);
                          if (m === 'فضفضة بدون اسم') setIsAnonymous(true);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          moodType === m
                            ? 'bg-violet-600 text-white'
                            : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="composer-category"
                      className="block text-xs font-semibold text-slate-500 dark:text-slate-300 mb-1"
                    >
                      التصنيف
                    </label>
                    <select
                      id="composer-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
                    >
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  {type === 'question' && (
                    <div>
                      <label
                        htmlFor="composer-qtype"
                        className="block text-xs font-semibold text-slate-500 dark:text-slate-300 mb-1"
                      >
                        نوع السؤال
                      </label>
                      <select
                        id="composer-qtype"
                        value={questionType}
                        onChange={(e) => setQuestionType(e.target.value)}
                        className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
                      >
                        {QUESTION_TYPES.map((qt) => (
                          <option key={qt} value={qt}>
                            {qt}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Poll Builder */}
              {type === 'poll' && (
                <div className="space-y-2.5 rounded-2xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 p-3.5">
                  <span className="block text-xs font-semibold text-slate-500 dark:text-slate-300">
                    خيارات التصويت
                  </span>
                  {pollOptions.map((opt, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        required
                        value={opt}
                        onChange={(e) =>
                          setPollOptions((prev) =>
                            prev.map((item, i) => (i === idx ? e.target.value : item))
                          )
                        }
                        placeholder={`الخيار ${idx + 1}`}
                        className="flex-1 min-h-[40px] rounded-xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 px-3 text-sm"
                      />
                      {pollOptions.length > 2 && (
                        <button
                          type="button"
                          onClick={() =>
                            setPollOptions((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center text-rose-400"
                          aria-label={`حذف الخيار ${idx + 1}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {pollOptions.length < 8 && (
                    <button
                      type="button"
                      onClick={() => setPollOptions((prev) => [...prev, ''])}
                      className="inline-flex items-center gap-1.5 text-xs text-violet-500 font-semibold min-h-[36px]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>إضافة خيار</span>
                    </button>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <select
                      aria-label="عرض نتائج التصويت"
                      value={pollShowResults}
                      onChange={(e) =>
                        setPollShowResults(e.target.value === 'after_vote' ? 'after_vote' : 'always')
                      }
                      className="min-h-[38px] rounded-xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 px-2.5 text-xs"
                    >
                      <option value="always">إظهار النتائج دائمًا</option>
                      <option value="after_vote">إظهار النتائج بعد التصويت</option>
                    </select>
                    <select
                      aria-label="مدة التصويت"
                      value={pollDurationHours}
                      onChange={(e) => setPollDurationHours(e.target.value)}
                      className="min-h-[38px] rounded-xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 px-2.5 text-xs"
                    >
                      <option value="24">لمدة 24 ساعة</option>
                      <option value="72">لمدة 3 أيام</option>
                      <option value="168">لمدة أسبوع</option>
                      <option value="">مفتوح بدون وقت</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Media Upload */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <label className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-white/10 flex items-center gap-2 text-xs font-medium cursor-pointer hover:border-violet-500 transition-colors">
                  <ImageIcon className="w-4 h-4 text-violet-500" />
                  <span>{uploading ? 'جاري الرفع...' : 'إرفاق صورة (اختياري)'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleImagePick}
                    className="hidden"
                  />
                </label>

                {mediaUrl && (
                  <div className="flex items-center gap-2">
                    <img src={mediaUrl} alt="مرفق" className="w-10 h-10 rounded-lg object-cover" />
                    <button
                      type="button"
                      onClick={() => setMediaUrl(null)}
                      className="text-xs text-rose-400 hover:underline"
                    >
                      إزالة الصورة
                    </button>
                  </div>
                )}
              </div>

              {/* Privacy & Identity Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10">
                  <button
                    type="button"
                    onClick={() => setIsAnonymous(true)}
                    className={`min-h-[38px] px-2 rounded-lg text-xs font-semibold transition-colors ${
                      isAnonymous
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-500 dark:text-slate-300 hover:text-white'
                    }`}
                  >
                    مجهول داخل التطبيق
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAnonymous(false)}
                    className={`min-h-[38px] px-2 rounded-lg text-xs font-semibold truncate transition-colors ${
                      !isAnonymous
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-500 dark:text-slate-300 hover:text-white'
                    }`}
                  >
                    باسم {user.displayName}
                  </button>
                </div>

                {!communityId && (
                  <select
                    aria-label="الجمهور"
                    value={audience}
                    onChange={(e) =>
                      setAudience(e.target.value === 'friends' ? 'friends' : 'public')
                    }
                    className="min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 text-xs font-semibold"
                  >
                    <option value="public">الجمهور: الجميع</option>
                    <option value="friends">الجمهور: الأصدقاء فقط</option>
                  </select>
                )}
              </div>

              <div className="flex items-center justify-between gap-4 text-xs pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowComments}
                    onChange={(e) => setAllowComments(e.target.checked)}
                    className="w-4 h-4 accent-violet-600 rounded"
                  />
                  <span>السماح بالتعليقات</span>
                </label>

                {type === 'question' && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowVoting}
                      onChange={(e) => setAllowVoting(e.target.checked)}
                      className="w-4 h-4 accent-violet-600 rounded"
                    />
                    <span>السماح بالتصويت على الإجابات</span>
                  </label>
                )}
              </div>
            </>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                onSaveDraft(content);
                onClose();
              }}
              className="min-h-[46px] px-4 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-600 dark:text-slate-300"
            >
              حفظ كمسودة
            </button>
            <button
              type="submit"
              disabled={submitting || uploading}
              className="flex-1 min-h-[46px] rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
            >
              {submitting ? 'جاري النشر...' : 'نشر الآن'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

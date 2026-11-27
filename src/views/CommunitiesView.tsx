import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Lock, Plus, Search, Shield, Users, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { PostCard } from '../components/PostCard';
import type { Community, Post, User } from '../types';

interface CommunitiesViewProps {
  currentUser: User | null;
  selectedCommunityId: number | null;
  onSelectCommunity: (id: number | null) => void;
  onOpenComposerForCommunity: (communityId: number, communityName: string) => void;
  onOpenProfile: (username: string) => void;
  onOpenReport: (targetType: 'post' | 'comment' | 'user' | 'community', targetId: number) => void;
  onRequireAuth: () => void;
  onToast: (msg: string) => void;
  refreshSignal: number;
}

const COMMUNITY_CATEGORIES = [
  'الفضفضة',
  'الألعاب',
  'كرة القدم',
  'العلاقات',
  'الدراسة',
  'التكنولوجيا',
  'السيارات',
  'الأفلام',
  'الضحك',
  'الحياة اليومية',
];

export const CommunitiesView: React.FC<CommunitiesViewProps> = ({
  currentUser,
  selectedCommunityId,
  onSelectCommunity,
  onOpenComposerForCommunity,
  onOpenProfile,
  onOpenReport,
  onRequireAuth,
  onToast,
  refreshSignal,
}) => {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [catFilter, setCatFilter] = useState('الكل');
  const [searchQ, setSearchQ] = useState('');

  // Create community modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCat, setNewCat] = useState(COMMUNITY_CATEGORIES[0]);
  const [newRules, setNewRules] = useState('');
  const [newPrivacy, setNewPrivacy] = useState<'public' | 'private'>('public');
  const [newWhoPost, setNewWhoPost] = useState<'members' | 'moderators'>('members');

  // Detail state
  const [detail, setDetail] = useState<{
    community: Community & {
      moderators: Array<{ id: number; username: string; display_name: string; role: string }>;
      posts: Post[];
    };
  } | null>(null);
  const [inCommunitySearch, setInCommunitySearch] = useState('');

  const loadList = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (catFilter !== 'الكل') params.set('category', catFilter);
    if (searchQ.trim()) params.set('q', searchQ.trim());

    apiRequest<{ communities: Community[] }>(`/communities?${params.toString()}`)
      .then((res) => setCommunities(res.communities))
      .catch((err) => onToast(err instanceof Error ? err.message : 'تعذر تحميل المجتمعات.'))
      .finally(() => setLoading(false));
  }, [catFilter, searchQ, onToast]);

  const loadDetail = useCallback(
    (id: number) => {
      setLoading(true);
      apiRequest<typeof detail>(`/communities/${id}`)
        .then((res) => setDetail(res))
        .catch((err) => {
          onToast(err instanceof Error ? err.message : 'تعذر فتح المجتمع.');
          onSelectCommunity(null);
        })
        .finally(() => setLoading(false));
    },
    [onSelectCommunity, onToast]
  );

  useEffect(() => {
    if (selectedCommunityId) {
      loadDetail(selectedCommunityId);
    } else {
      setDetail(null);
      loadList();
    }
  }, [selectedCommunityId, loadDetail, loadList, refreshSignal]);

  const handleJoinLeave = async (communityId: number) => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    try {
      const res = await apiRequest<{ joined: boolean }>(`/communities/${communityId}/join`, {
        method: 'POST',
      });
      onToast(res.joined ? 'انضممت إلى المجتمع بنجاح!' : 'غادرت المجتمع.');
      if (selectedCommunityId) loadDetail(selectedCommunityId);
      else loadList();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء.');
    }
  };

  const handleCreateCommunity = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ id: number }>('/communities', {
        method: 'POST',
        body: {
          name: newName,
          description: newDesc,
          category: newCat,
          rules: newRules,
          privacy: newPrivacy,
          whoCanPost: newWhoPost,
        },
      });
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      setNewRules('');
      onToast('تم إنشاء المجتمع بنجاح!');
      onSelectCommunity(res.id);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر إنشاء المجتمع.');
    }
  };

  if (selectedCommunityId && detail) {
    const c = detail.community;
    const filteredPosts = c.posts.filter((p) =>
      inCommunitySearch.trim()
        ? p.content.toLowerCase().includes(inCommunitySearch.trim().toLowerCase())
        : true
    );

    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => onSelectCommunity(null)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-500 hover:underline min-h-[36px]"
        >
          <ArrowRight className="w-4 h-4" />
          <span>العودة إلى كل المجتمعات</span>
        </button>

        {/* Community Cover & Header */}
        <div className="rounded-3xl overflow-hidden bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10">
          <div className="h-36 sm:h-44 relative bg-[#09090D]">
            <img
              src={c.coverUrl || '/src/assets/images/meen_community_cover_1795731518126.jpg'}
              alt={c.name}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover opacity-80"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          </div>

          <div className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-xl font-bold">{c.name}</h2>
                  {c.privacy === 'private' && <Lock className="w-4 h-4 text-amber-400" />}
                </div>
                <p className="text-xs text-slate-400 mt-1 tabular-nums">
                  {c.category} · {c.membersCount} عضو ·{' '}
                  {c.privacy === 'public' ? 'مجتمع عام' : 'مجتمع خاص'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleJoinLeave(c.id)}
                  className={`min-h-[42px] px-4 rounded-xl text-xs font-semibold transition-colors ${
                    c.isMember
                      ? 'border border-slate-200 dark:border-white/15 text-slate-600 dark:text-slate-200'
                      : 'bg-violet-600 hover:bg-violet-500 text-white'
                  }`}
                >
                  {c.isMember ? 'عضو (مغادرة)' : 'انضمام للمجتمع'}
                </button>
                {c.isMember && (
                  <button
                    type="button"
                    onClick={() => onOpenComposerForCommunity(c.id, c.name)}
                    className="min-h-[42px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>نشر</span>
                  </button>
                )}
              </div>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {c.description}
            </p>

            {/* Rules & Moderators */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-white/8 text-xs">
              <div>
                <h4 className="font-bold text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-violet-500" />
                  <span>قواعد المجتمع</span>
                </h4>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">{c.rules}</p>
              </div>
              <div>
                <h4 className="font-bold text-slate-700 dark:text-slate-200 mb-1">المشرفون</h4>
                <div className="flex flex-wrap gap-2">
                  {c.moderators.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onOpenProfile(m.username)}
                      className="text-violet-500 hover:underline font-medium"
                    >
                      {m.display_name} (@{m.username})
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* In-Community Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={inCommunitySearch}
            onChange={(e) => setInCommunitySearch(e.target.value)}
            placeholder={`ابحث داخل ${c.name}...`}
            className="w-full min-h-[42px] rounded-xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 pr-10 pl-4 text-xs"
          />
        </div>

        {filteredPosts.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center text-xs text-slate-400">
            {c.privacy === 'private' && !c.isMember
              ? 'هذا المجتمع خاص — انضم أولًا لمشاهدة المنشورات.'
              : 'لا توجد منشورات في هذا المجتمع بعد.'}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredPosts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                currentUser={currentUser}
                onUpdatePost={(u) =>
                  setDetail((prev) =>
                    prev
                      ? {
                          ...prev,
                          community: {
                            ...prev.community,
                            posts: prev.community.posts.map((p) => (p.id === u.id ? u : p)),
                          },
                        }
                      : prev
                  )
                }
                onDeletePost={(id) =>
                  setDetail((prev) =>
                    prev
                      ? {
                          ...prev,
                          community: {
                            ...prev.community,
                            posts: prev.community.posts.filter((p) => p.id !== id),
                          },
                        }
                      : prev
                  )
                }
                onOpenProfile={onOpenProfile}
                onOpenCommunity={onSelectCommunity}
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

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-500" />
            <span>المجتمعات</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            انضم لمساحات تجمعك بأشخاص يشاركونك نفس الاهتمامات أو أنشئ مجتمعك الخاص.
          </p>
        </div>
        <button
          type="button"
          onClick={() => (currentUser ? setShowCreate(true) : onRequireAuth())}
          className="min-h-[44px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>إنشاء مجتمع</span>
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="ابحث عن مجتمع..."
            className="w-full min-h-[42px] rounded-xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 pr-10 pl-4 text-xs"
          />
        </div>
        <select
          aria-label="تصنيف المجتمع"
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="min-h-[42px] rounded-xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 px-3 text-xs"
        >
          <option value="الكل">كل التصنيفات</option>
          {COMMUNITY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="h-40 rounded-2xl bg-white dark:bg-[#12121A] animate-pulse" />
      ) : communities.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center space-y-3">
          <Users className="w-10 h-10 text-violet-400 mx-auto" />
          <h3 className="font-display text-base font-bold">
            مفيش مجتمعات متاحة حاليًا، تقدر تنشئ مجتمعك.
          </h3>
          <button
            type="button"
            onClick={() => (currentUser ? setShowCreate(true) : onRequireAuth())}
            className="min-h-[44px] px-5 rounded-xl bg-violet-600 text-white text-xs font-semibold inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>أنشئ مجتمعًا الآن</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {communities.map((c) => (
            <div
              key={c.id}
              className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-4 flex flex-col justify-between gap-3"
            >
              <button
                type="button"
                onClick={() => onSelectCommunity(c.id)}
                className="flex items-start gap-3 text-right"
              >
                <img
                  src={c.avatarUrl}
                  alt={c.name}
                  className="w-12 h-12 rounded-2xl object-cover shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-bold truncate">{c.name}</h3>
                    {c.privacy === 'private' && <Lock className="w-3.5 h-3.5 text-amber-400" />}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
                    {c.category} · {c.membersCount} عضو
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-300 mt-1.5 line-clamp-2">
                    {c.description}
                  </p>
                </div>
              </button>

              <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-white/8">
                <button
                  type="button"
                  onClick={() => onSelectCommunity(c.id)}
                  className="flex-1 min-h-[38px] rounded-xl bg-slate-100 dark:bg-white/5 text-xs font-semibold"
                >
                  فتح المجتمع
                </button>
                <button
                  type="button"
                  onClick={() => handleJoinLeave(c.id)}
                  className={`min-h-[38px] px-4 rounded-xl text-xs font-semibold ${
                    c.isMember
                      ? 'border border-slate-200 dark:border-white/15 text-slate-500'
                      : 'bg-violet-600 text-white'
                  }`}
                >
                  {c.isMember ? 'منضم' : 'انضمام'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Community Modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold">إنشاء مجتمع جديد</h3>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-400"
                aria-label="إغلاق"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCommunity} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">اسم المجتمع</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="مثال: مجتمع التكنولوجيا"
                  className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">الوصف</label>
                <textarea
                  rows={3}
                  required
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="عن ماذا يتحدث هذا المجتمع؟"
                  className="w-full rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 p-3 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold mb-1">التصنيف</label>
                  <select
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-2.5 text-xs"
                  >
                    {COMMUNITY_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">الخصوصية</label>
                  <select
                    value={newPrivacy}
                    onChange={(e) => setNewPrivacy(e.target.value === 'private' ? 'private' : 'public')}
                    className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-2.5 text-xs"
                  >
                    <option value="public">عام</option>
                    <option value="private">خاص</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">من يستطيع النشر؟</label>
                <select
                  value={newWhoPost}
                  onChange={(e) =>
                    setNewWhoPost(e.target.value === 'moderators' ? 'moderators' : 'members')
                  }
                  className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-2.5 text-xs"
                >
                  <option value="members">جميع الأعضاء</option>
                  <option value="moderators">المشرفون فقط</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">قواعد المجتمع</label>
                <textarea
                  rows={2}
                  value={newRules}
                  onChange={(e) => setNewRules(e.target.value)}
                  placeholder="احترم الجميع، لا تنشر معلومات شخصية..."
                  className="w-full rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 p-2.5 text-xs"
                />
              </div>

              <button
                type="submit"
                className="w-full min-h-[46px] rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold"
              >
                إنشاء المجتمع
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

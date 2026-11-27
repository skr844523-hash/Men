import React, { useEffect, useState } from 'react';
import {
  Compass,
  Flame,
  Hash,
  Search,
  Sparkles,
  Trophy,
  Users,
  Bookmark,
  UserPlus,
  HelpCircle,
  BarChart2,
  CalendarHeart,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { PostCard } from '../components/PostCard';
import type { AppSection, Community, Post, User } from '../types';

interface ExploreViewProps {
  currentUser: User | null;
  initialQuery?: string;
  onNavigate: (section: AppSection) => void;
  onOpenProfile: (username: string) => void;
  onOpenCommunity: (communityId: number) => void;
  onOpenReport: (targetType: 'post' | 'comment' | 'user', targetId: number) => void;
  onRequireAuth: () => void;
  onToast: (msg: string) => void;
}

export const ExploreView: React.FC<ExploreViewProps> = ({
  currentUser,
  initialQuery = '',
  onNavigate,
  onOpenProfile,
  onOpenCommunity,
  onOpenReport,
  onRequireAuth,
  onToast,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<'all' | 'posts' | 'users' | 'communities' | 'categories'>('all');
  const [loading, setLoading] = useState(true);

  // Explore defaults
  const [categories, setCategories] = useState<string[]>([]);
  const [trendingTopics, setTrendingTopics] = useState<Array<{ name: string; count: number }>>([]);
  const [trendingPosts, setTrendingPosts] = useState<Post[]>([]);
  const [worthyConfessions, setWorthyConfessions] = useState<Post[]>([]);
  const [popularQuestions, setPopularQuestions] = useState<Post[]>([]);
  const [activeCommunities, setActiveCommunities] = useState<Community[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<
    Array<{ id: number; username: string; display_name: string; avatar: string; bio: string }>
  >([]);

  // Search results
  const [searchResults, setSearchResults] = useState<{
    users: Array<{ id: number; username: string; display_name: string; avatar: string; bio: string }>;
    posts: Post[];
    communities: Community[];
    categories: string[];
  } | null>(null);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (query.trim()) {
      params.set('q', query.trim());
      params.set('filter', filter);
    }

    apiRequest<Record<string, unknown>>(`/explore?${params.toString()}`)
      .then((res) => {
        if (query.trim()) {
          setSearchResults({
            users: (res.users as typeof suggestedUsers) || [],
            posts: (res.posts as Post[]) || [],
            communities: (res.communities as Community[]) || [],
            categories: (res.categories as string[]) || [],
          });
        } else {
          setSearchResults(null);
          setCategories((res.categories as string[]) || []);
          setTrendingTopics((res.trendingTopics as Array<{ name: string; count: number }>) || []);
          setTrendingPosts((res.trendingPosts as Post[]) || []);
          setWorthyConfessions((res.worthyConfessions as Post[]) || []);
          setPopularQuestions((res.popularQuestions as Post[]) || []);
          setActiveCommunities((res.activeCommunities as Community[]) || []);
          setSuggestedUsers((res.suggestedUsers as typeof suggestedUsers) || []);
        }
      })
      .catch((err) => onToast(err instanceof Error ? err.message : 'تعذر التحميل.'))
      .finally(() => setLoading(false));
  }, [query, filter, onToast]);

  const SHORTCUTS: Array<{ id: AppSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'confessions', label: 'الفضفضة', icon: Sparkles },
    { id: 'communities', label: 'المجتمعات', icon: Users },
    { id: 'trending', label: 'التريند', icon: Flame },
    { id: 'daily', label: 'سؤال اليوم', icon: CalendarHeart },
    { id: 'challenges', label: 'التحديات', icon: Trophy },
    { id: 'questions', label: 'الأسئلة', icon: HelpCircle },
    { id: 'polls', label: 'التصويتات', icon: BarChart2 },
    { id: 'friends', label: 'الأصدقاء', icon: UserPlus },
    { id: 'saved', label: 'المحفوظات', icon: Bookmark },
  ];

  return (
    <div className="space-y-5">
      {/* Search Bar */}
      <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-4 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن أشخاص، منشورات، كلمات، مجتمعات، أو تصنيفات..."
            aria-label="بحث شامل"
            className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 pr-10 pl-4 text-sm focus:outline-none focus:border-violet-500"
          />
        </div>

        {query.trim() && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {(
              [
                { id: 'all', label: 'الكل' },
                { id: 'posts', label: 'المنشورات' },
                { id: 'users', label: 'المستخدمون' },
                { id: 'communities', label: 'المجتمعات' },
                { id: 'categories', label: 'التصنيفات' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap ${
                  filter === tab.id
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quick Section Hub */}
      {!query.trim() && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {SHORTCUTS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onNavigate(s.id)}
                className="min-h-[68px] rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200/80 dark:border-white/8 hover:border-violet-500/50 p-3 flex flex-col items-center justify-center gap-1.5 text-xs font-semibold transition-colors"
              >
                <Icon className="w-5 h-5 text-violet-500" />
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="h-44 rounded-2xl bg-white dark:bg-[#12121A] animate-pulse" />
      ) : searchResults ? (
        <div className="space-y-5">
          {searchResults.users.length > 0 && (
            <section className="space-y-2.5">
              <h3 className="font-display text-sm font-bold text-slate-500 dark:text-slate-300">
                المستخدمون ({searchResults.users.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {searchResults.users.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => onOpenProfile(u.username)}
                    className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-3.5 flex items-center gap-3 text-right hover:border-violet-500/40"
                  >
                    <img
                      src={u.avatar}
                      alt={u.display_name}
                      className="w-11 h-11 rounded-full object-cover shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{u.display_name}</p>
                      <p className="text-xs font-mono text-slate-400" dir="ltr">
                        @{u.username}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {searchResults.communities.length > 0 && (
            <section className="space-y-2.5">
              <h3 className="font-display text-sm font-bold text-slate-500 dark:text-slate-300">
                المجتمعات ({searchResults.communities.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {searchResults.communities.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenCommunity(c.id)}
                    className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-3.5 text-right hover:border-violet-500/40"
                  >
                    <p className="text-sm font-bold">{c.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{c.description}</p>
                  </button>
                ))}
              </div>
            </section>
          )}

          {searchResults.posts.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-display text-sm font-bold text-slate-500 dark:text-slate-300">
                المنشورات ({searchResults.posts.length})
              </h3>
              {searchResults.posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUser={currentUser}
                  onUpdatePost={(u) =>
                    setSearchResults((prev) =>
                      prev ? { ...prev, posts: prev.posts.map((p) => (p.id === u.id ? u : p)) } : prev
                    )
                  }
                  onDeletePost={(id) =>
                    setSearchResults((prev) =>
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
            </section>
          )}

          {searchResults.users.length === 0 &&
            searchResults.communities.length === 0 &&
            searchResults.posts.length === 0 && (
              <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center text-sm text-slate-400">
                لم يتم العثور على نتائج مطابقة لـ «{query}».
              </div>
            )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Categories & Trending Topics */}
          <section className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold flex items-center gap-2">
                <Hash className="w-4 h-4 text-violet-500" />
                <span>التصنيفات والمواضيع الرائجة</span>
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('trending')}
                className="text-xs text-violet-500 hover:underline"
              >
                التريند الكامل
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(trendingTopics.length > 0
                ? trendingTopics.map((t) => `${t.name} (${t.count})`)
                : categories
              ).map((label, idx) => {
                const rawName = trendingTopics[idx]?.name || categories[idx];
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setQuery(rawName)}
                    className="min-h-[36px] px-3 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-violet-500/15 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Active Communities */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold">المجتمعات الأكثر نشاطًا</h3>
              <button
                type="button"
                onClick={() => onNavigate('communities')}
                className="text-xs text-violet-500 hover:underline"
              >
                عرض الكل
              </button>
            </div>
            {activeCommunities.length === 0 ? (
              <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 text-center text-xs text-slate-400">
                مفيش مجتمعات متاحة حاليًا، تقدر تنشئ مجتمعك.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {activeCommunities.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenCommunity(c.id)}
                    className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-4 flex items-center gap-3 text-right hover:border-violet-500/40"
                  >
                    <img
                      src={c.avatarUrl}
                      alt={c.name}
                      className="w-12 h-12 rounded-2xl object-cover shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{c.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
                        {c.category} · {c.membersCount} عضو
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Suggested Users */}
          {suggestedUsers.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-display text-sm font-bold">أشخاص مقترحون</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {suggestedUsers.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => onOpenProfile(u.username)}
                    className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-3.5 flex items-center gap-3 text-right hover:border-violet-500/40"
                  >
                    <img
                      src={u.avatar}
                      alt={u.display_name}
                      className="w-11 h-11 rounded-full object-cover shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{u.display_name}</p>
                      <p className="text-xs text-slate-400 truncate">
                        {u.bio || `@${u.username}`}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Worthy Confessions & Popular Questions */}
          {worthyConfessions.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-display text-sm font-bold">فضفضة تستحق التفاعل</h3>
              {worthyConfessions.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUser={currentUser}
                  onUpdatePost={(u) =>
                    setWorthyConfessions((prev) => prev.map((p) => (p.id === u.id ? u : p)))
                  }
                  onDeletePost={(id) =>
                    setWorthyConfessions((prev) => prev.filter((p) => p.id !== id))
                  }
                  onOpenProfile={onOpenProfile}
                  onOpenCommunity={onOpenCommunity}
                  onOpenReport={onOpenReport}
                  onRequireAuth={onRequireAuth}
                  onToast={onToast}
                />
              ))}
            </section>
          )}

          {popularQuestions.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-display text-sm font-bold">أسئلة متداولة</h3>
              {popularQuestions.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUser={currentUser}
                  onUpdatePost={(u) =>
                    setPopularQuestions((prev) => prev.map((p) => (p.id === u.id ? u : p)))
                  }
                  onDeletePost={(id) =>
                    setPopularQuestions((prev) => prev.filter((p) => p.id !== id))
                  }
                  onOpenProfile={onOpenProfile}
                  onOpenCommunity={onOpenCommunity}
                  onOpenReport={onOpenReport}
                  onRequireAuth={onRequireAuth}
                  onToast={onToast}
                />
              ))}
            </section>
          )}

          {trendingPosts.length === 0 &&
            activeCommunities.length === 0 &&
            suggestedUsers.length === 0 && (
              <div className="rounded-3xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center space-y-2">
                <Compass className="w-10 h-10 text-violet-400 mx-auto" />
                <p className="text-sm font-bold">مساحة الاستكشاف تنتظر أولى الحكايات</p>
                <p className="text-xs text-slate-400">
                  عند نشر المنشورات وإنشاء المجتمعات ستظهر هنا المواضيع الأكثر تفاعلًا تلقائيًا.
                </p>
              </div>
            )}
        </div>
      )}
    </div>
  );
};

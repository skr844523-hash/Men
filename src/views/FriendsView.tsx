import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Search, UserCheck, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { apiRequest } from '../lib/api';

interface FriendPerson {
  id: number;
  username: string;
  display_name: string;
  avatar: string;
  bio?: string;
  mutualCount?: number;
}

interface FriendsViewProps {
  lastWsEvent?: Record<string, unknown> | null;
  syncSignal?: number;
  onOpenProfile: (username: string) => void;
  onStartChat: (userId: number) => void;
  onToast: (msg: string) => void;
}

export const FriendsView: React.FC<FriendsViewProps> = ({
  lastWsEvent,
  syncSignal = 0,
  onOpenProfile,
  onStartChat,
  onToast,
}) => {
  const [data, setData] = useState<{
    friends: FriendPerson[];
    incomingRequests: FriendPerson[];
    outgoingRequests: FriendPerson[];
    suggestions: FriendPerson[];
    following: FriendPerson[];
  }>({ friends: [], incomingRequests: [], outgoingRequests: [], suggestions: [], following: [] });
  const [searchQ, setSearchQ] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    apiRequest<typeof data>('/friends')
      .then((res) => setData(res))
      .catch((err) => onToast(err instanceof Error ? err.message : 'تعذر تحميل قائمة الأصدقاء.'))
      .finally(() => setLoading(false));
  }, [onToast]);

  useEffect(() => {
    load();
  }, [load, syncSignal]);

  useEffect(() => {
    if (!lastWsEvent || typeof lastWsEvent.type !== 'string') return;
    if (
      lastWsEvent.type === 'friend:request' ||
      lastWsEvent.type === 'friend:accepted' ||
      lastWsEvent.type === 'friend:removed' ||
      lastWsEvent.type === 'friend:updated'
    ) {
      load();
    }
  }, [lastWsEvent, load]);

  const handleRequest = async (userId: number) => {
    try {
      await apiRequest('/friends/request', { method: 'POST', body: { userId } });
      onToast('تم إرسال طلب الصداقة.');
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر إرسال الطلب.');
    }
  };

  const handleRespond = async (userId: number, action: 'accept' | 'reject') => {
    try {
      await apiRequest('/friends/respond', { method: 'POST', body: { userId, action } });
      onToast(action === 'accept' ? 'تم قبول طلب الصداقة!' : 'تم رفض الطلب.');
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء.');
    }
  };

  const handleRemove = async (userId: number) => {
    try {
      await apiRequest(`/friends/${userId}`, { method: 'DELETE' });
      onToast('تمت إزالة الصديق.');
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر إزالة الصديق.');
    }
  };

  const filteredFriends = data.friends.filter((f) =>
    searchQ.trim()
      ? f.display_name.toLowerCase().includes(searchQ.toLowerCase()) ||
        f.username.toLowerCase().includes(searchQ.toLowerCase())
      : true
  );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-5 space-y-3">
        <h2 className="font-display text-lg font-bold flex items-center gap-2">
          <Users className="w-5 h-5 text-violet-500" />
          <span>الأصدقاء والتواصل</span>
        </h2>
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="ابحث في أصدقائك..."
            className="w-full min-h-[42px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 pr-10 pl-4 text-xs"
          />
        </div>
      </div>

      {loading ? (
        <div className="h-40 rounded-2xl bg-white dark:bg-[#12121A] animate-pulse" />
      ) : (
        <>
          {/* Incoming Friend Requests */}
          {data.incomingRequests.length > 0 && (
            <section className="space-y-2.5">
              <h3 className="font-display text-sm font-bold">
                طلبات الصداقة الواردة ({data.incomingRequests.length})
              </h3>
              <div className="space-y-2">
                {data.incomingRequests.map((req) => (
                  <div
                    key={req.id}
                    className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-3.5 flex items-center justify-between gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenProfile(req.username)}
                      className="flex items-center gap-3 text-right min-w-0"
                    >
                      <img
                        src={req.avatar}
                        alt={req.display_name}
                        className="w-11 h-11 rounded-full object-cover shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{req.display_name}</p>
                        <p className="text-xs font-mono text-slate-400" dir="ltr">
                          @{req.username}
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRespond(req.id, 'accept')}
                        className="min-h-[38px] px-3.5 rounded-xl bg-violet-600 text-white text-xs font-semibold flex items-center gap-1"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>قبول</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRespond(req.id, 'reject')}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-slate-100 dark:bg-white/5 text-slate-400"
                        aria-label="رفض الطلب"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Friends List */}
          <section className="space-y-2.5">
            <h3 className="font-display text-sm font-bold">أصدقائي ({filteredFriends.length})</h3>
            {filteredFriends.length === 0 ? (
              <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-6 text-center text-xs text-slate-400">
                لا يوجد أصدقاء مضافون حاليًا. يمكنك إرسال طلبات صداقة من المقترحات بالأسفل.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredFriends.map((f) => (
                  <div
                    key={f.id}
                    className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-3.5 flex items-center justify-between gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenProfile(f.username)}
                      className="flex items-center gap-3 text-right min-w-0"
                    >
                      <img
                        src={f.avatar}
                        alt={f.display_name}
                        className="w-11 h-11 rounded-full object-cover shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{f.display_name}</p>
                        <p className="text-xs font-mono text-slate-400" dir="ltr">
                          @{f.username}
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onStartChat(f.id)}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-violet-500/15 text-violet-500"
                        aria-label={`مراسلة ${f.display_name}`}
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(f.id)}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-rose-400"
                        aria-label={`إزالة ${f.display_name}`}
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Suggestions */}
          {data.suggestions.length > 0 && (
            <section className="space-y-2.5">
              <h3 className="font-display text-sm font-bold">أشخاص قد تعرفهم</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.suggestions.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-3.5 flex items-center justify-between gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenProfile(s.username)}
                      className="flex items-center gap-3 text-right min-w-0"
                    >
                      <img
                        src={s.avatar}
                        alt={s.display_name}
                        className="w-11 h-11 rounded-full object-cover shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{s.display_name}</p>
                        <p className="text-xs text-slate-400 truncate">
                          {s.mutualCount && s.mutualCount > 0
                            ? `${s.mutualCount} أصدقاء مشتركين`
                            : `@${s.username}`}
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRequest(s.id)}
                      className="min-h-[38px] px-3 rounded-xl bg-violet-600 text-white text-xs font-semibold flex items-center gap-1 shrink-0"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>إضافة</span>
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

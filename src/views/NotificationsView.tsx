import React, { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { apiRequest, formatRelativeArabic } from '../lib/api';
import type { AppSection, NotificationItem } from '../types';

interface NotificationsViewProps {
  lastWsEvent?: Record<string, unknown> | null;
  syncSignal?: number;
  onNavigateTarget: (section: AppSection, targetId?: number | null) => void;
  onRefreshCounts: () => void;
  onToast: (msg: string) => void;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  lastWsEvent,
  syncSignal = 0,
  onNavigateTarget,
  onRefreshCounts,
  onToast,
}) => {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    apiRequest<{ notifications: NotificationItem[] }>('/notifications')
      .then((res) => setItems(res.notifications))
      .catch((err) => onToast(err instanceof Error ? err.message : 'تعذر تحميل الإشعارات.'))
      .finally(() => setLoading(false));
  }, [onToast]);

  useEffect(() => {
    load();
  }, [load, syncSignal]);

  useEffect(() => {
    if (!lastWsEvent || lastWsEvent.type !== 'notification:new') return;
    const raw = lastWsEvent.notification as
      | {
          id: number;
          type: string;
          title: string;
          body: string;
          targetType?: string | null;
          targetId?: number | null;
          isRead?: boolean;
          createdAt?: string;
        }
      | undefined;
    if (!raw || !raw.id) return;
    const mapped: NotificationItem = {
      id: raw.id,
      type: raw.type,
      title: raw.title,
      body: raw.body,
      target_type: raw.targetType ?? null,
      target_id: raw.targetId ?? null,
      is_read: raw.isRead ? 1 : 0,
      created_at: raw.createdAt || new Date().toISOString(),
    };
    setItems((prev) => (prev.some((x) => x.id === mapped.id) ? prev : [mapped, ...prev]));
  }, [lastWsEvent]);

  const markRead = async (n: NotificationItem) => {
    if (!n.is_read) {
      await apiRequest(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
      onRefreshCounts();
    }
    if (n.target_type === 'messages') {
      onNavigateTarget('messages', n.target_id);
    } else if (n.target_type === 'friends') {
      onNavigateTarget('friends');
    } else if (n.target_type === 'post') {
      onNavigateTarget('home');
    }
  };

  const markAll = async () => {
    await apiRequest('/notifications/read-all', { method: 'POST' });
    setItems((prev) => prev.map((x) => ({ ...x, is_read: 1 })));
    onRefreshCounts();
    onToast('تم تحديد جميع الإشعارات كمقروءة.');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold flex items-center gap-2">
          <Bell className="w-5 h-5 text-violet-500" />
          <span>الإشعارات</span>
        </h2>
        {items.some((i) => !i.is_read) && (
          <button
            type="button"
            onClick={markAll}
            className="min-h-[38px] px-3 rounded-xl bg-violet-500/15 text-violet-500 text-xs font-semibold flex items-center gap-1.5"
          >
            <CheckCheck className="w-4 h-4" />
            <span>تحديد الكل كمقروء</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="h-40 rounded-2xl bg-white dark:bg-[#12121A] animate-pulse" />
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 p-8 text-center space-y-2">
          <Bell className="w-8 h-8 text-violet-400 mx-auto" />
          <p className="text-sm font-semibold">لا توجد إشعارات حتى الآن</p>
          <p className="text-xs text-slate-400">
            عندما يتفاعل أحدهم مع منشوراتك أو يراسلك ستظهر الإشعارات هنا فورًا.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 divide-y divide-slate-100 dark:divide-white/8 overflow-hidden">
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => markRead(n)}
              className={`w-full p-4 text-right flex items-start justify-between gap-3 transition-colors ${
                n.is_read
                  ? 'hover:bg-slate-50 dark:hover:bg-white/5'
                  : 'bg-violet-500/8 hover:bg-violet-500/12'
              }`}
            >
              <div className="space-y-1">
                <p className="text-sm font-bold">{n.title}</p>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {n.body}
                </p>
                <p className="text-[11px] text-slate-400">{formatRelativeArabic(n.created_at)}</p>
              </div>
              {!n.is_read && (
                <span className="mt-1.5 text-[11px] font-semibold text-violet-500 shrink-0">
                  جديد
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

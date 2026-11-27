import React, { useState } from 'react';
import { Flag, X } from 'lucide-react';
import { apiRequest } from '../lib/api';

interface ReportModalProps {
  targetType: 'post' | 'comment' | 'user' | 'community' | 'message';
  targetId: number;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

const REPORT_REASONS = [
  'محتوى غير مناسب',
  'تحرش',
  'تهديد',
  'تنمر',
  'انتحال شخصية',
  'محتوى ضار',
  'سبام',
  'كشف بيانات شخصية',
  'سبب آخر',
];

export const ReportModal: React.FC<ReportModalProps> = ({
  targetType,
  targetId,
  onClose,
  onSuccess,
}) => {
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiRequest('/reports', {
        method: 'POST',
        body: { targetType, targetId, reason, details },
      });
      onSuccess('تم استلام بلاغك بنجاح وستتم مراجعته من فريق الإشراف.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال البلاغ.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="إبلاغ عن محتوى"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-rose-500">
            <Flag className="w-5 h-5" />
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              إبلاغ عن مخالفة
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:bg-white/5"
            aria-label="إغلاق نافذة الإبلاغ"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <span className="block text-xs font-semibold text-slate-500 dark:text-slate-300 mb-2">
              سبب البلاغ
            </span>
            <div className="grid grid-cols-2 gap-2">
              {REPORT_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`min-h-[40px] px-3 rounded-xl text-xs font-medium text-right border transition-colors ${
                    reason === r
                      ? 'bg-rose-500/15 border-rose-500 text-rose-500 dark:text-rose-300'
                      : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="report-details"
              className="block text-xs font-semibold text-slate-500 dark:text-slate-300 mb-1"
            >
              تفاصيل إضافية (اختياري)
            </label>
            <textarea
              id="report-details"
              rows={3}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="اكتب أي تفاصيل تساعد المراجعين..."
              className="w-full rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 p-3 text-sm focus:outline-none focus:border-violet-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-200 dark:border-white/10 text-sm font-medium"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 min-h-[44px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold"
            >
              {loading ? 'جاري الإرسال...' : 'إرسال البلاغ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

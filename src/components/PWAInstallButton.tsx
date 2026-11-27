import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ variant?: 'compact' | 'full' }> = ({
  variant = 'compact',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          variant === 'full'
            ? 'w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap'
            : 'min-h-[40px] flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-violet-700 dark:text-violet-300 px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0'
        }
        aria-label="تثبيت تطبيق مين؟"
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>تثبيت التطبيق</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="تثبيت تطبيق مين؟"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/10 p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-violet-500" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  تثبيت مين؟ على هاتفك
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
                aria-label="إغلاق دليل التثبيت"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {isIOS ? (
              <ol className="space-y-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed list-decimal list-inside">
                <li>اضغط على زر المشاركة (Share) في شريط Safari بالأسفل.</li>
                <li>اختر «إضافة إلى الشاشة الرئيسية» (Add to Home Screen).</li>
                <li>اضغط «إضافة» ليظهر تطبيق مين؟ كأي تطبيق أصلي.</li>
              </ol>
            ) : (
              <ol className="space-y-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed list-decimal list-inside">
                <li>افتح قائمة المتصفح (⋮) في Chrome أو Edge على Android.</li>
                <li>اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</li>
                <li>سيعمل التطبيق بملء الشاشة مع دعم العمل دون اتصال.</li>
              </ol>
            )}
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full min-h-[44px] rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
            >
              فهمت
            </button>
          </div>
        </div>
      )}
    </>
  );
};

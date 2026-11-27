import React, { useEffect } from 'react';
import { motion } from 'motion/react';

interface SplashScreenProps {
  onComplete: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      onComplete();
      return;
    }
    const timer = setTimeout(onComplete, 1150);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#09090D] text-white px-6"
      data-testid="splash-screen"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center text-center"
      >
        <div className="w-24 h-24 rounded-3xl overflow-hidden border border-violet-500/30 shadow-2xl shadow-violet-950/50 bg-[#12121A] flex items-center justify-center mb-6">
          <img
            src="/src/assets/images/meen_brand_emblem_1795731517188.jpg"
            alt="شعار مين؟ MEEN"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        </div>

        <h1 className="font-display text-4xl font-extrabold tracking-tight text-white">
          مين؟ <span className="text-violet-400 font-mono text-2xl font-semibold">MEEN</span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.35 }}
          className="mt-3 text-base text-slate-300 font-medium"
        >
          احكي اللي جواك.
        </motion.p>
      </motion.div>
    </div>
  );
};

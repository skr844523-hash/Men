import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 left-4 right-4 md:right-auto md:w-80 z-50 flex items-center gap-2.5 rounded-xl bg-amber-600 text-white px-4 py-2.5 text-xs font-medium shadow-lg"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>أنت غير متصل بالإنترنت حاليًا — يتم عرض البيانات المحفوظة مؤقتًا.</span>
    </div>
  );
};

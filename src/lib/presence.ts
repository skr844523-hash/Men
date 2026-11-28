// Presence without a database-rules change: while signed in, the app pings a
// cheap endpoint every 45 seconds, on tab visibility changes, and (in the
// Android shell) on foreground/background. The server's "online" test is
// last_active_at within two minutes, so these pings make the green dot and
// message delivered/sent status actually true, and going offline shows within
// two minutes of closing instead of whenever the next API call happened to be.
import { apiRequest } from './api';
import { isNativeApp, onNativeAppState } from './native';

const PING_INTERVAL_MS = 45_000;

let timer: number | null = null;
let visibilityHandler: (() => void) | null = null;
let removeNativeListener: (() => void) | null = null;

function ping(active: boolean): void {
  void apiRequest('/presence/ping', { method: 'POST', body: { active } }).catch(() => {});
}

export function startPresence(): void {
  if (timer != null) return;
  ping(true);
  timer = window.setInterval(() => ping(document.visibilityState === 'visible'), PING_INTERVAL_MS);
  visibilityHandler = () => ping(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', visibilityHandler);
  if (isNativeApp()) {
    void onNativeAppState((isActive) => ping(isActive)).then((off) => {
      removeNativeListener = off;
    });
  }
}

export function stopPresence(): void {
  ping(false);
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  removeNativeListener?.();
  removeNativeListener = null;
}

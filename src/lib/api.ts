// Auth is Firebase Auth. Every API call carries a fresh Firebase ID token as a Bearer
// token (the SDK refreshes it automatically). Nothing is stored in localStorage by us.
import { onAuthStateChanged, type User as FbUser } from 'firebase/auth';
import { getFirebaseAuth, isFirebaseConfigured } from './firebase/config';

let readyPromise: Promise<FbUser | null> | null = null;

export function authReady(): Promise<FbUser | null> {
  if (!isFirebaseConfigured) return Promise.resolve(null);
  if (!readyPromise) {
    const auth = getFirebaseAuth();
    readyPromise = new Promise((resolve) => {
      const off = onAuthStateChanged(auth, (u) => {
        off();
        resolve(u);
      });
    });
  }
  return readyPromise;
}

export async function getIdToken(forceRefresh = false): Promise<string | null> {
  await authReady();
  if (!isFirebaseConfigured) return null;
  const u = getFirebaseAuth().currentUser;
  return u ? u.getIdToken(forceRefresh) : null;
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'MEEN-App' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const send = async (force: boolean) => {
    const token = await getIdToken(force);
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`/api${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  };
  let res = await send(false);
  if (res.status === 401 && getFirebaseAuthSafe()?.currentUser) res = await send(true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'حدث خطأ غير متوقع، حاول مرة أخرى.');
  }
  return data as T;
}

function getFirebaseAuthSafe() {
  return isFirebaseConfigured ? getFirebaseAuth() : null;
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('تعذر قراءة الملف.'));
    reader.readAsDataURL(file);
  });
}

export async function uploadMediaFile(file: File): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  const res = await apiRequest<{ url: string }>('/upload', {
    method: 'POST',
    body: { dataUrl },
  });
  return res.url;
}

export async function uploadMediaDataUrl(dataUrl: string): Promise<string> {
  const res = await apiRequest<{ url: string }>('/upload', {
    method: 'POST',
    body: { dataUrl },
  });
  return res.url;
}

export function formatRelativeArabic(dateStr: string): string {
  const normalized = dateStr.includes('T') || dateStr.endsWith('Z') ? dateStr : `${dateStr.replace(' ', 'T')}Z`;
  const ts = new Date(normalized).getTime();
  if (Number.isNaN(ts)) return dateStr;
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 45) return 'الآن';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `منذ ${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${hours} س`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `منذ ${days} ي`;
  return new Date(ts).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
}

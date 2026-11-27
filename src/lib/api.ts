// Session Bearer token held strictly in memory (never localStorage/sessionStorage)
// Cookie persistence across reloads is handled by HttpOnly SameSite=None cookie on the server.
let memoryToken: string | null = null;

export function setMemoryToken(token: string | null) {
  memoryToken = token;
}

export function getMemoryToken(): string | null {
  return memoryToken;
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'MEEN-App',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (memoryToken) {
    headers['Authorization'] = `Bearer ${memoryToken}`;
  }

  const res = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'حدث خطأ غير متوقع، حاول مرة أخرى.');
  }
  return data as T;
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

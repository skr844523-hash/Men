import crypto from 'node:crypto';
import { get, patch, put, nowIso, remove } from './store.ts';
import { rtdb } from './admin.ts';

const IMG_MAX = 3.5 * 1024 * 1024;
const AUDIO_MAX = 600 * 1024; // voice notes are stored in Realtime Database, so keep them short

export async function uploadMedia(dataUrl: unknown, userId: number): Promise<{ url: string } | { error: string; status: number }> {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return { error: 'صيغة الملف غير مدعومة.', status: 400 };
  const m = dataUrl.match(/^data:(image\/png|image\/jpeg|image\/webp|audio\/webm|audio\/ogg|audio\/mp4);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { error: 'يسمح برفع صور PNG/JPEG/WEBP أو مقاطع صوتية قصيرة فقط.', status: 400 };
  const mime = m[1];
  const buf = Buffer.from(m[2], 'base64');
  const isImage = mime.startsWith('image/');
  if (buf.length > (isImage ? IMG_MAX : AUDIO_MAX)) {
    return { error: isImage ? 'حجم الصورة يتجاوز الحد المسموح (3.5 ميجابايت).' : 'المقطع الصوتي طويل جدًا، اجعله أقصر.', status: 400 };
  }
  if (mime === 'image/png' && !(buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) return { error: 'ملف PNG تالف أو غير صحيح.', status: 400 };
  if (mime === 'image/jpeg' && !(buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return { error: 'ملف JPEG تالف أو غير صحيح.', status: 400 };
  if (mime === 'image/webp' && !(buf.length >= 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP')) return { error: 'ملف WEBP تالف أو غير صحيح.', status: 400 };

  if (!isImage) {
    const id = crypto.randomUUID();
    await put('media', id, { id, mime, data: m[2], owner: userId, created_at: nowIso() });
    await rtdb.ref(`t/media_by_owner/${userId}/${id}`).set(true);
    return { url: `/api/media/${id}` };
  }

  // Images go to ImgBB. The key stays on the server.
  const key = process.env.IMGBB_API_KEY;
  if (!key) return { error: 'رفع الصور غير مفعّل حاليًا.', status: 503 };
  const form = new URLSearchParams();
  form.set('image', m[2]);
  const fetchImpl = (globalThis as any).__imgbbFetch || fetch; // test hook
  const r = await fetchImpl(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, { method: 'POST', body: form });
  const j: any = await r.json().catch(() => ({}));
  const url = j?.data?.display_url || j?.data?.url;
  if (!r.ok || !j?.success || typeof url !== 'string' || !/^https:\/\//.test(url)) {
    return { error: 'تعذر رفع الصورة الآن، حاول مرة أخرى.', status: 502 };
  }
  return { url };
}

export type MediaRow = { id: string; mime: string; data: string; owner: number; conversation_id?: number | null; created_at?: string };

export async function getMedia(id: string): Promise<MediaRow | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return get<MediaRow>('media', id);
}

export const MEDIA_PATH_RE = /^\/api\/media\/([0-9a-f-]{36})$/;

// A voice note is uploaded before the message exists, so the conversation is
// stamped on it when the message is sent. Only the uploader can stamp it.
export async function attachMediaToConversation(mediaUrl: string | null, userId: number, conversationId: number): Promise<void> {
  if (!mediaUrl) return;
  const m = MEDIA_PATH_RE.exec(mediaUrl.trim());
  if (!m) return;
  const row = await getMedia(m[1]);
  if (!row || Number(row.owner) !== userId) return;
  await patch('media', m[1], { conversation_id: conversationId });
}

export async function deleteMediaByUrl(mediaUrl: string | null): Promise<void> {
  if (!mediaUrl) return;
  const m = MEDIA_PATH_RE.exec(mediaUrl.trim());
  if (!m) return;
  const row = await getMedia(m[1]);
  await remove('media', m[1]);
  if (row?.owner != null) await rtdb.ref(`t/media_by_owner/${row.owner}/${m[1]}`).remove().catch(() => {});
}

// Everything a user uploaded, e.g. when the account is deleted. Uses the small
// per-owner index written on upload rather than a query, so no database index or
// rules change is needed for it.
export async function deleteMediaOwnedBy(userId: number): Promise<void> {
  const s = await rtdb.ref(`t/media_by_owner/${userId}`).get();
  if (!s.exists()) return;
  for (const id of Object.keys(s.val() as Record<string, boolean>)) {
    await remove('media', id);
    await rtdb.ref(`t/media_by_owner/${userId}/${id}`).remove().catch(() => {});
  }
}

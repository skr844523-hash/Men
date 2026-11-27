import { rtdb } from './admin.ts';

// Tiny table layer over Realtime Database: t/<table>/<id>. Numeric ids come from
// transactional counters so the client keeps using numeric ids.
export type Row = Record<string, any> & { id: number };

const ref = (p: string) => rtdb.ref(p);

export async function nextId(table: string): Promise<number> {
  const r = await ref(`counters/${table}`).transaction((v) => (Number(v) || 0) + 1);
  return Number(r.snapshot.val());
}

export async function get<T = Row>(table: string, id: number | string): Promise<T | null> {
  const s = await ref(`t/${table}/${id}`).get();
  return s.exists() ? (s.val() as T) : null;
}

export async function all<T = Row>(table: string): Promise<T[]> {
  const s = await ref(`t/${table}`).get();
  if (!s.exists()) return [];
  return Object.values(s.val() as Record<string, T>);
}

export async function where<T = Row>(table: string, field: string, value: string | number | boolean): Promise<T[]> {
  const s = await ref(`t/${table}`).orderByChild(field).equalTo(value as any).get();
  if (!s.exists()) return [];
  return Object.values(s.val() as Record<string, T>);
}

export async function insert<T extends Record<string, any>>(table: string, data: T): Promise<T & { id: number }> {
  const id = await nextId(table);
  const row = { ...clean(data), id } as T & { id: number };
  await ref(`t/${table}/${id}`).set(row);
  return row;
}

export async function put(table: string, id: number | string, data: Record<string, any>): Promise<void> {
  await ref(`t/${table}/${id}`).set(clean(data));
}

export async function patch(table: string, id: number | string, data: Record<string, any>): Promise<void> {
  await ref(`t/${table}/${id}`).update(clean(data));
}

export async function remove(table: string, id: number | string): Promise<void> {
  await ref(`t/${table}/${id}`).remove();
}

// Unique keys (username, email, phone, uid). RTDB keys cannot contain . # $ [ ] /
function uKey(kind: string, key: string) {
  const k = kind === 'uid' ? key : key.toLowerCase();
  return `unique/${kind}/${encodeURIComponent(k).replace(/\./g, '%2E')}`;
}
// Atomic claim. Returns false if already taken.
export async function claimUnique(kind: string, key: string, owner: number | string): Promise<boolean> {
  const r = await ref(uKey(kind, key)).transaction((v) => (v == null ? owner : undefined));
  return r.committed;
}
export async function setUnique(kind: string, key: string, owner: number | string): Promise<void> {
  await ref(uKey(kind, key)).set(owner);
}
export async function releaseUnique(kind: string, key: string): Promise<void> {
  await ref(uKey(kind, key)).remove();
}
export async function lookupUnique(kind: string, key: string): Promise<string | number | null> {
  const s = await ref(uKey(kind, key)).get();
  return s.exists() ? (s.val() as any) : null;
}

export async function getKV<T>(path: string, fallback: T): Promise<T> {
  const s = await ref(`kv/${path}`).get();
  return s.exists() ? (s.val() as T) : fallback;
}
export async function setKV(path: string, value: unknown): Promise<void> {
  await ref(`kv/${path}`).set(value as any);
}

export const nowIso = () => new Date().toISOString();

// RTDB rejects undefined; convert to null-removal.
function clean<T extends Record<string, any>>(o: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

// Rows addressed by a composite string key (reactions, saves, follows, friendships...).
export async function putKeyed(table: string, key: string, data: Record<string, any>): Promise<void> {
  await ref(`t/${table}/${key}`).set(clean({ ...data, id: key }));
}
export async function getKeyed<T = any>(table: string, key: string): Promise<T | null> {
  const s = await ref(`t/${table}/${key}`).get();
  return s.exists() ? (s.val() as T) : null;
}
export async function bump(table: string, id: number | string, field: string, delta: number): Promise<number> {
  const r = await ref(`t/${table}/${id}/${field}`).transaction((v) => Math.max(0, (Number(v) || 0) + delta));
  return Number(r.snapshot.val() ?? 0);
}
export async function lastN<T = Row>(table: string, n: number): Promise<T[]> {
  const s = await ref(`t/${table}`).orderByKey().limitToLast(n).get();
  if (!s.exists()) return [];
  const out: T[] = [];
  s.forEach((c) => { out.push(c.val() as T); });
  return out.reverse(); // newest first
}
export const pairKey = (a: number, b: number) => `${Math.min(a, b)}_${Math.max(a, b)}`;

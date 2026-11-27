// Realtime without a WebSocket server: Firebase Realtime Database listeners on
// live/<uid> (private), live/_all and live/_posts (public hints). The server is
// the only writer; rules let a user read only their own channel.
import { limitToLast, onChildAdded, query, ref } from 'firebase/database';
import { getFirebaseDatabase } from './firebase/config';

export type LiveEvent = Record<string, unknown>;

export function subscribeLive(uid: string, onEvent: (e: LiveEvent) => void): () => void {
  const db = getFirebaseDatabase();
  const startedAt = Date.now() - 3000;
  const seen = new Set<string>();
  const offs = [`live/${uid}`, 'live/_all', 'live/_posts'].map((path) =>
    onChildAdded(query(ref(db, path), limitToLast(20)), (snap) => {
      const key = `${path}/${snap.key}`;
      const v = snap.val() as LiveEvent | null;
      if (!v || seen.has(key)) return;
      seen.add(key);
      if (Number(v._ts) < startedAt) return; // history from before this session
      onEvent(v);
    })
  );
  return () => offs.forEach((off) => off());
}

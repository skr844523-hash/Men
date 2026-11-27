import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

// Server-only. Credentials come from env (never the frontend, never git):
//   FIREBASE_SERVICE_ACCOUNT_JSON   full service account JSON (Vercel env var)
// Local tests use the Firebase emulators (FIREBASE_AUTH_EMULATOR_HOST / FIREBASE_DATABASE_EMULATOR_HOST).
const projectId = process.env.FIREBASE_PROJECT_ID || 'men2-87abd';
const databaseURL =
  process.env.FIREBASE_DATABASE_URL ||
  (process.env.FIREBASE_DATABASE_EMULATOR_HOST
    ? `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${projectId}-default-rtdb`
    : `https://${projectId}-default-rtdb.firebaseio.com`);

function createApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    return initializeApp({ credential: cert(JSON.parse(raw)), databaseURL, projectId });
  }
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
    return initializeApp({ projectId, databaseURL });
  }
  return initializeApp({ credential: applicationDefault(), databaseURL, projectId });
}

export const app = createApp();
export const auth = getAuth(app);
export const rtdb = getDatabase(app);
export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

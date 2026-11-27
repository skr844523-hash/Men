// Firebase client bootstrap for MEEN.
// The web config is public by design (it identifies the project, it does not
// grant access). Real access control lives in firebase/database.rules.json and
// in the backend that sets custom claims. Never put a service account key or
// the ImgBB key here.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase, type Database } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.databaseURL && firebaseConfig.projectId
);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let databaseInstance: Database | null = null;

function requireConfig() {
  if (!isFirebaseConfigured) {
    throw new Error(
      'إعدادات Firebase غير مكتملة على الخادم. تأكد من ضبط VITE_FIREBASE_* في متغيرات البيئة.'
    );
  }
}

export function getFirebaseApp(): FirebaseApp {
  requireConfig();
  if (!app) {
    app = initializeApp(firebaseConfig as Record<string, string>);
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(getFirebaseApp());
    // Local browser tests only: VITE_FIREBASE_EMULATOR=1 (never set in production).
    if (import.meta.env.VITE_FIREBASE_EMULATOR === '1') connectAuthEmulator(authInstance, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  return authInstance;
}

export function getFirebaseDatabase(): Database {
  if (!databaseInstance) {
    databaseInstance = getDatabase(getFirebaseApp());
    if (import.meta.env.VITE_FIREBASE_EMULATOR === '1') connectDatabaseEmulator(databaseInstance, '127.0.0.1', 9000);
  }
  return databaseInstance;
}

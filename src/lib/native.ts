// Bridges to the native Android shell (Capacitor). Everything here is safe to
// import on the plain web: each helper checks the platform first and no-ops or
// falls back when the site runs in a browser. The matching native plugins live
// in the app shell (android-app/), installed with the same major version.
import { Capacitor } from '@capacitor/core';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { apiRequest } from './api';
import { getFirebaseAuth } from './firebase/config';

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// Google sign-in inside the app. Google blocks OAuth in WebViews, so the login
// screen cannot use signInWithPopup there; the native plugin shows the phone's
// own Google account picker and hands us an ID token for Firebase.
export async function nativeGoogleSignIn(): Promise<void> {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result.credential?.idToken;
  if (!idToken) throw new Error('تعذر الحصول على حساب جوجل من الهاتف.');
  await signInWithCredential(getFirebaseAuth(), GoogleAuthProvider.credential(idToken));
}

let registeredToken: string | null = null;

// Ask for the notification permission (Android 13+ shows the prompt here, after
// sign-in, never on the login screen) and register the FCM token on the server.
// In-app realtime notifications already work without this; failure just means
// no system push.
export async function setupNativePush(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    const perm = await FirebaseMessaging.requestPermissions();
    if (perm.receive !== 'granted') return;
    const { token } = await FirebaseMessaging.getToken();
    if (token) {
      registeredToken = token;
      await apiRequest('/push/register', {
        method: 'POST',
        body: { token, platform: Capacitor.getPlatform() },
      });
    }
    await FirebaseMessaging.addListener('tokenReceived', (event) => {
      registeredToken = event.token;
      void apiRequest('/push/register', {
        method: 'POST',
        body: { token: event.token, platform: Capacitor.getPlatform() },
      }).catch(() => {});
    });
  } catch {
    // Push stays off; in-app notifications still work.
  }
}

export async function teardownNativePush(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    if (registeredToken) {
      await apiRequest('/push/unregister', { method: 'POST', body: { token: registeredToken } }).catch(() => {});
    }
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    await FirebaseMessaging.deleteToken().catch(() => {});
  } catch {
    // ignore
  }
  registeredToken = null;
}

export async function nativeSignOut(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    await FirebaseAuthentication.signOut();
  } catch {
    // ignore
  }
}

// System share sheet (WhatsApp etc.). Returns false on the web so callers keep
// their clipboard fallback.
export async function shareNative(opts: { title: string; text: string; url: string }): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title: opts.title, text: opts.text, url: opts.url, dialogTitle: 'مشاركة من مين؟' });
    return true;
  } catch {
    return false;
  }
}

// Foreground/background events from the app shell, for presence.
export async function onNativeAppState(cb: (isActive: boolean) => void): Promise<() => void> {
  if (!isNativeApp()) return () => {};
  try {
    const { App } = await import('@capacitor/app');
    const handle = await App.addListener('appStateChange', ({ isActive }) => cb(isActive));
    return () => {
      void handle.remove();
    };
  } catch {
    return () => {};
  }
}

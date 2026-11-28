# مين؟ MEEN

React + Vite frontend, Express API on Firebase (Auth + Realtime Database), deployed on Vercel.

## Architecture
- **Auth**: Firebase Auth (Google + Email/Password). The API verifies the Firebase ID token on every request (revocation checked). Username/phone login goes through `/api/auth/login`, which returns a custom token.
- **Admin**: only the Google-verified `ADMIN_EMAIL` account becomes admin. It can appoint moderators. No passcode, no bootstrap, no self-promotion.
- **Data**: Realtime Database under `t/<table>/<id>`, written only by the server (Admin SDK). `firebase/database.rules.json` denies all client access except the realtime channels `live/<uid>` (owner only), `live/_all`, `live/_posts` (read-only hints).
- **Realtime**: clients listen to the `live/*` channels (replaces WebSockets).
- **Images**: ImgBB (server-side, `IMGBB_API_KEY`). Voice notes are stored in the database (max ~600 KB) and served by `/api/media/:id`.
- **Hosting**: Vercel. `api/index.js` is the single serverless function (bundle of `server/`), `dist/` is the static site.

## Environment variables (Vercel > Settings > Environment Variables)
See `.env.example`. Server-only: `FIREBASE_SERVICE_ACCOUNT_JSON`, `IMGBB_API_KEY`, `ADMIN_EMAIL`. The `VITE_FIREBASE_*` values are the public web config.

Never commit secrets, and never commit the real `ADMIN_EMAIL` address either: the tests and `scripts/browser/run.sh` read it from the environment (`ADMIN_EMAIL=... npm run test:api`).

## Security model
- **Email confirmation**: an account can browse and edit its own profile, but posting, commenting, messaging, joining and uploading need a confirmed email (`requireActiveAccount`). Google sign-in arrives confirmed; password sign-ups get a link (`POST /api/auth/resend-verification` sends it again, and the app shows a banner until it is confirmed).
- **Login brute force**: `POST /api/auth/login` is limited per IP, and a separate per-account counter locks the account for 15 minutes after 8 failures in 15 minutes. The counter is keyed by the resolved user id, so switching between username, email and phone does not reset it.
- **Passwords**: 10 characters minimum, at least two character classes, not a common password, and it may not contain the username or the email local part.
- **Media**: images go to ImgBB and are public; voice notes stay in the database and `GET /api/media/:id` serves them to the uploader and to the two sides of the conversation they were sent in only. Deleting a message or an account deletes the file.
- **Media URLs**: `sanitizeMediaUrl` only accepts our own paths, `*.ibb.co` and `*.googleusercontent.com`, so a post or an avatar cannot be used as an IP tracking pixel.
- **Read endpoints**: the feed, explore and trending are rate limited per instance, and the anonymous explore/trending payloads are cached for 30 seconds. Guests never receive the member directory.
- **Private communities**: posts *and* the member/moderator roster are visible to members only.
- **Headers**: HSTS, `nosniff`, `DENY` framing, Referrer-Policy, Permissions-Policy and a Content-Security-Policy (see `vercel.json`).

## Firebase console checklist
1. Authentication > Sign-in method: enable Google and Email/Password. Templates > Email address verification: keep the verification template on, the app relies on it.
2. Authentication > Settings > Authorized domains: add the Vercel domain.
3. Realtime Database > Rules: publish `firebase/database.rules.json` (`firebase deploy --only database`).
4. Project settings > Service accounts: generate a key and paste the JSON into Vercel as `FIREBASE_SERVICE_ACCOUNT_JSON`.
5. Authentication > Settings > User actions: turn on email enumeration protection.

## Scripts
- `npm run dev` local server (needs `.env.local` and credentials or the emulators)
- `npm run build` builds `dist/` and regenerates `api/index.js` (commit it)
- `node scripts/gen-rules.mjs` regenerates the database rules (add an `.indexOn` for every new `where()` field)
- `npm run test:api` runs the API/rules suites on the Firebase emulators; `scripts/fb-security.test.mjs` covers the security controls above. A browser test lives in `scripts/browser/`.

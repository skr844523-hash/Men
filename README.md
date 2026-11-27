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
See `.env.example`. Server-only: `FIREBASE_SERVICE_ACCOUNT_JSON`, `IMGBB_API_KEY`, `ADMIN_EMAIL`. The `VITE_FIREBASE_*` values are the public web config. Never commit secrets.

## Firebase console checklist
1. Authentication > Sign-in method: enable Google and Email/Password.
2. Authentication > Settings > Authorized domains: add the Vercel domain.
3. Realtime Database > Rules: publish `firebase/database.rules.json` (`firebase deploy --only database`).
4. Project settings > Service accounts: generate a key and paste the JSON into Vercel as `FIREBASE_SERVICE_ACCOUNT_JSON`.

## Scripts
- `npm run dev` local server (needs `.env.local` and credentials or the emulators)
- `npm run build` builds `dist/` and regenerates `api/index.js` (commit it)
- `node scripts/gen-rules.mjs` regenerates the database rules (add an `.indexOn` for every new `where()` field)
- `npm run test:api` runs the API/rules suites on the Firebase emulators; `bash scripts/browser/run.sh` style browser test is in `scripts/browser/`

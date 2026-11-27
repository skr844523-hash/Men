<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/3d422ac7-33f9-458b-9a87-3035408c086d

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Production environment configuration

Before production deployment, set `APP_URL`, `SESSION_SECRET` (a stable random secret of at least 32 characters), and `ADMIN_EMAIL` in the hosting environment. `ADMIN_PASSCODE` is optional. Do not commit real secrets or personal administrator email addresses. The WebSocket endpoint authenticates using the HttpOnly session cookie; session tokens are not accepted in URL query strings.

In production the server refuses to start if `SESSION_SECRET` is missing or too short. In development, an ephemeral secret fallback is used and sessions will be invalidated after restart. Ensure SQLite and the uploads directory are on persistent storage supplied by the host.

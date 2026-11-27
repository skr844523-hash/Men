// Vercel serverless entry. Bundled into api/index.js by scripts/build-api.mjs.
import { createApi } from './fb/app.ts';

const app = createApi();
export default app;

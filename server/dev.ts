// Local development server: API + Vite. Production runs on Vercel (api/index.js + static dist).
import 'dotenv/config';
import dotenv from 'dotenv';
import { createServer as createVite } from 'vite';
import { createApi } from './fb/app.ts';

dotenv.config({ path: '.env.local' });
const port = Number(process.env.PORT || 3000);
const app = createApi();
const vite = await createVite({ server: { middlewareMode: true }, appType: 'spa' });
app.use(vite.middlewares);
app.listen(port, '0.0.0.0', () => console.log(`MEEN dev server on http://localhost:${port}`));

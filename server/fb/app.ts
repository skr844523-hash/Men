import express from 'express';
import { attachAuth } from './middleware.ts';
import { authRouter } from './routes/authRoutes.ts';
import { socialRouter } from './routes/socialRoutes.ts';
import { communityRouter } from './routes/communityRoutes.ts';
import { messagesRouter } from './routes/messagesRoutes.ts';
import { adminRouter } from './routes/adminRoutes.ts';
import { getMedia } from './media.ts';
import { rtdb } from './admin.ts';

export function createApi() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '6mb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      await rtdb.ref('live/_all').limitToFirst(1).get();
      res.json({ ok: true, service: 'meen-api', database: 'ok' });
    } catch {
      res.status(503).json({ ok: false, database: 'error' });
    }
  });

  // Voice notes are stored in Realtime Database and served here.
  app.get('/api/media/:id', async (req, res) => {
    const m = await getMedia(String(req.params.id));
    if (!m) return void res.status(404).end();
    res.setHeader('Content-Type', m.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(m.data, 'base64'));
  });

  app.use('/api', attachAuth);
  app.use('/api', authRouter);
  app.use('/api', socialRouter);
  app.use('/api', communityRouter);
  app.use('/api', messagesRouter);
  app.use('/api', adminRouter);
  // more routers are mounted by ./routes as they are ported
  app.use('/api', (_req, res) => res.status(404).json({ error: 'المسار غير موجود.' }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[MEEN] unhandled', err?.message || err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع، حاول مرة أخرى.' });
  });
  return app;
}

import express from 'express';
import { attachAuth, requireAuth } from './middleware.ts';
import { authRouter } from './routes/authRoutes.ts';
import { socialRouter } from './routes/socialRoutes.ts';
import { communityRouter } from './routes/communityRoutes.ts';
import { messagesRouter } from './routes/messagesRoutes.ts';
import { adminRouter } from './routes/adminRoutes.ts';
import { pushRouter } from './routes/pushRoutes.ts';
import { getMedia } from './media.ts';
import { rtdb } from './admin.ts';
import { get } from './store.ts';

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

  app.use('/api', attachAuth);

  // Voice notes live in Realtime Database and are served here. Only the person who
  // uploaded the note and the two sides of the conversation it was sent in may fetch
  // it: a forwarded link is no longer enough on its own.
  app.get('/api/media/:id', requireAuth, async (req, res) => {
    const m = await getMedia(String(req.params.id));
    if (!m) return void res.status(404).end();
    const uid = req.user!.id;
    let allowed = Number(m.owner) === uid;
    if (!allowed && m.conversation_id) {
      const conv = await get<any>('conversations', Number(m.conversation_id));
      allowed = Boolean(conv && (conv.user1_id === uid || conv.user2_id === uid));
    }
    if (!allowed) return void res.status(403).json({ error: 'غير مصرح بالوصول لهذا الملف.' });
    res.setHeader('Content-Type', m.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(Buffer.from(m.data, 'base64'));
  });
  app.use('/api', authRouter);
  app.use('/api', socialRouter);
  app.use('/api', communityRouter);
  app.use('/api', messagesRouter);
  app.use('/api', adminRouter);
  app.use('/api', pushRouter);
  // more routers are mounted by ./routes as they are ported
  app.use('/api', (_req, res) => res.status(404).json({ error: 'المسار غير موجود.' }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[MEEN] unhandled', err?.message || err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع، حاول مرة أخرى.' });
  });
  return app;
}

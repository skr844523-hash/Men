import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { initDatabase } from './server/db.ts';
import { attachAuth, verifyCsrfForMutations } from './server/auth.ts';
import { attachWebSocketServer } from './server/realtime.ts';
import { authRouter } from './server/routes/authRoutes.ts';
import { socialRouter } from './server/routes/socialRoutes.ts';
import { communityRouter } from './server/routes/communityRoutes.ts';
import { messagesRouter } from './server/routes/messagesRoutes.ts';
import { adminRouter } from './server/routes/adminRoutes.ts';

async function startServer() {
  initDatabase();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));

  // Safe uploaded assets serving with strict path confinement & nosniff header
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.get('/uploads/:filename', (req, res) => {
    const cleanName = path.basename(String(req.params.filename || ''));
    const resolved = path.resolve(uploadsDir, cleanName);
    if (!resolved.startsWith(uploadsDir + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).end();
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(resolved);
  });

  // API middleware: auth attachment + CSRF protection on mutations
  app.use('/api', attachAuth);
  app.use('/api', verifyCsrfForMutations);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'meen-api' });
  });

  app.use('/api', authRouter);
  app.use('/api', socialRouter);
  app.use('/api', communityRouter);
  app.use('/api', messagesRouter);
  app.use('/api', adminRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'المسار غير موجود.' });
  });

  const server = http.createServer(app);
  attachWebSocketServer(server);

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`MEEN server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start MEEN server:', err);
  process.exit(1);
});

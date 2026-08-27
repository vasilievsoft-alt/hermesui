import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { config, SESSION_COOKIE } from './config.js';
import { authRouter, requireAuth } from './auth.js';
import { isValidSessionToken, readSessionCookie, pruneSessions } from './session-store.js';
import { apiRouter, ensureDirs } from './agents.js';
import { filesRouter } from './files/routes.js';
import { chatRouter } from './chat.js';
import { agentSettingsRouter } from './agent-settings.js';
import { handleTerminalUpgrade } from './terminal-ws.js';
import { bus } from './bus.js';
import { connectionStatus } from './acp.js';

ensureDirs();
pruneSessions();
setInterval(pruneSessions, 24 * 3600 * 1000).unref();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.use('/api/auth', authRouter);

// Everything else under /api is protected.
const protectedApi = express.Router();
protectedApi.use(requireAuth);
protectedApi.use(apiRouter);
app.use('/api', protectedApi);

app.use('/api/files', requireAuth, filesRouter);
app.use('/api/chat', requireAuth, chatRouter);
app.use('/api/agent-settings', requireAuth, agentSettingsRouter);

// Central error mapper: JSON everywhere.
import { SafePathError } from './files/safe-path.js';
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    if (err instanceof SafePathError) {
      res.status(400).json({ error: err.message });
      return;
    }
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      res.status(404).json({ error: 'not found' });
      return;
    }
    console.error('[hermesui]', err);
    res.status(500).json({ error: 'internal error' });
  }
);

// Static web build (production). In dev, Vite serves the frontend.
const webDist =
  process.env.WEB_DIST ?? path.resolve(process.cwd(), '../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
      next();
      return;
    }
    res.sendFile(path.join(webDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(503)
      .send('web build not found — run `npm run build` in web/ or use Vite dev server');
  });
}

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'hello' }));
  socket.on('message', () => {
    /* Phase 2+: protocol grows; chat events are broadcast-only for now */
  });
});

// Broadcast every chat event to all authenticated sockets.
bus.on('chat', (event) => {
  const frame = JSON.stringify({ type: 'chat', event });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(frame);
  }
});

server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (!url.pathname.startsWith('/ws')) {
    socket.destroy();
    return;
  }
  const token = readSessionCookie(req.headers.cookie, SESSION_COOKIE);
  if (!isValidSessionToken(token)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  // Interactive setup terminal for agents (OAuth flows, hermes model …).
  if (url.pathname.startsWith('/ws/terminal')) {
    handleTerminalUpgrade(req, socket, head);
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(config.port, () => {
  console.log(`[hermesui] listening on :${config.port}`);
});

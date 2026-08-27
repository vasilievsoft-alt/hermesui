import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { config, SESSION_COOKIE } from './config.js';
import {
  createSessionToken,
  destroySessionToken,
  isValidSessionToken,
  readSessionCookie,
} from './session-store.js';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function tokenFrom(req: Request): string | undefined {
  return readSessionCookie(req.headers.cookie, SESSION_COOKIE);
}

export function isAuthenticated(req: Request): boolean {
  return isValidSessionToken(tokenFrom(req));
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (isAuthenticated(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
}

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { password } = req.body as { password?: unknown };
  if (typeof password !== 'string' || !safeEqual(password, config.appPassword)) {
    res.status(401).json({ error: 'invalid password' });
    return;
  }
  const token = createSessionToken();
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: 30 * 24 * 3600 * 1000,
    path: '/',
  });
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  destroySessionToken(tokenFrom(req));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

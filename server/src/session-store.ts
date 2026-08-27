import crypto from 'node:crypto';

export interface Session {
  createdAt: number;
}

const sessions = new Map<string, Session>();

const TTL_MS = 30 * 24 * 3600 * 1000;

export function createSessionToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

export function destroySessionToken(token: string | undefined): void {
  if (token) sessions.delete(token);
}

export function isValidSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  return Date.now() - s.createdAt <= TTL_MS;
}

export function pruneSessions(): void {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now - s.createdAt > TTL_MS) sessions.delete(token);
  }
}

export function readSessionCookie(
  cookieHeader: string | undefined,
  cookieName: string
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === cookieName) {
      return part.slice(idx + 1).trim();
    }
  }
  return undefined;
}

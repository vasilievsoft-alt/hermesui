import path from 'node:path';
import crypto from 'node:crypto';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  appPassword: requireEnv('APP_PASSWORD'),
  workspaceDir:
    process.env.WORKSPACE_DIR ?? path.resolve(process.cwd(), 'workspace'),
  configDir: process.env.CONFIG_DIR ?? path.resolve(process.cwd(), 'config'),
  // Stable across restarts when APP_SESSION_SECRET provided; otherwise derived
  // per-process (sessions reset on restart, acceptable for MVP).
  sessionSecret:
    process.env.APP_SESSION_SECRET ??
    crypto.createHash('sha256').update(requireEnv('APP_PASSWORD')).digest('hex'),
  isProd: process.env.NODE_ENV === 'production',
};

export const SESSION_COOKIE = 'hermesui_sid';

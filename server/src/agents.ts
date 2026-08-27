import { Router } from 'express';
import fs from 'node:fs';
import { config } from './config.js';
import { connectionStatus } from './acp.js';

export function ensureDirs(): void {
  for (const dir of [config.workspaceDir, config.configDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const apiRouter = Router();

apiRouter.get('/status', (_req, res) => {
  res.json({ app: 'hermesui', version: '1.1.0-phase2' });
});

apiRouter.get('/agents', async (_req, res, next) => {
  try {
    res.json(await connectionStatus());
  } catch (e) {
    next(e);
  }
});

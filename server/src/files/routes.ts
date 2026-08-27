import express, { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  resolveInWorkspace,
  workspaceRoot,
  looksBinary,
  SafePathError,
} from './safe-path.js';

export const filesRouter = Router();

const TEXT_READ_LIMIT = 1024 * 1024; // 1 MB

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        cb(null, fs.mkdtempSync(path.join(os.tmpdir(), 'ui-upload-')));
      } catch (e) {
        cb(e as Error, os.tmpdir());
      }
    },
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`),
  }),
  limits: { fileSize: 512 * 1024 * 1024 }, // 512 MB hard cap per file
});

filesRouter.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (err instanceof SafePathError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
);

interface Entry {
  name: string;
  type: 'dir' | 'file';
  size: number;
  mtimeMs: number;
}

filesRouter.get('/tree', async (req, res, next) => {
  try {
    const dir = resolveInWorkspace((req.query.path as string) ?? '');
    const names = await fs.promises.readdir(dir);
    const entries: Entry[] = [];
    for (const name of names) {
      if (name === '.gitkeep') continue;
      const st = await fs.promises.lstat(path.join(dir, name));
      entries.push({
        name,
        type: st.isDirectory() ? 'dir' : 'file',
        size: st.size,
        mtimeMs: st.mtimeMs,
      });
    }
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    res.json(entries);
  } catch (e) {
    next(e);
  }
});

filesRouter.get('/read', async (req, res, next) => {
  try {
    const p = resolveInWorkspace(req.query.path as string);
    const st = await fs.promises.stat(p);
    if (!st.isFile()) {
      res.status(400).json({ error: 'not a file' });
      return;
    }
    const fh = await fs.promises.open(p, 'r');
    try {
      const head = Buffer.alloc(Math.min(8000, st.size));
      await fh.read(head, 0, head.length, 0);
      const binary = looksBinary(head);
      if (binary || st.size > TEXT_READ_LIMIT) {
        res.json({ truncated: true, binary, size: st.size, mtimeMs: st.mtimeMs, content: '' });
        return;
      }
      const buf = Buffer.alloc(st.size);
      await fh.read(buf, 0, buf.length, 0);
      res.json({
        truncated: false,
        binary: false,
        size: st.size,
        mtimeMs: st.mtimeMs,
        content: buf.toString('utf8'),
      });
    } finally {
      await fh.close();
    }
  } catch (e) {
    next(e);
  }
});

filesRouter.put('/write', async (req, res, next) => {
  try {
    const { path: p, content } = req.body as { path?: string; content?: string };
    if (typeof p !== 'string' || typeof content !== 'string') {
      res.status(400).json({ error: 'path and content required' });
      return;
    }
    const target = resolveInWorkspace(p);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, content, 'utf8');
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

filesRouter.post('/mkdir', async (req, res, next) => {
  try {
    const { path: p } = req.body as { path?: string };
    if (typeof p !== 'string') {
      res.status(400).json({ error: 'path required' });
      return;
    }
    await fs.promises.mkdir(resolveInWorkspace(p), { recursive: true });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

filesRouter.post('/rename', async (req, res, next) => {
  try {
    const { from, to } = req.body as { from?: string; to?: string };
    if (typeof from !== 'string' || typeof to !== 'string') {
      res.status(400).json({ error: 'from/to required' });
      return;
    }
    await fs.promises.rename(resolveInWorkspace(from), resolveInWorkspace(to));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

filesRouter.post('/delete', async (req, res, next) => {
  try {
    const { path: p } = req.body as { path?: string };
    if (typeof p !== 'string') {
      res.status(400).json({ error: 'path required' });
      return;
    }
    const target = resolveInWorkspace(p);
    if (target === workspaceRoot()) {
      res.status(400).json({ error: 'cannot delete workspace root' });
      return;
    }
    await fs.promises.rm(target, { recursive: true });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

filesRouter.get('/raw', (req, res, next) => {
  try {
    const p = resolveInWorkspace(req.query.path as string);
    res.sendFile(p);
  } catch (e) {
    next(e);
  }
});

filesRouter.get('/download', (req, res, next) => {
  try {
    const p = resolveInWorkspace(req.query.path as string);
    res.download(p);
  } catch (e) {
    next(e);
  }
});

// Multipart upload. Target directory comes as text field 'dir'.
filesRouter.post(
  '/upload',
  upload.single('file'),
  async (req, res, next) => {
    try {
      const f = req.file;
      if (!f) {
        res.status(400).json({ error: 'no file provided' });
        return;
      }
      const dirRaw = (req.body.dir as string | undefined) ?? '';
      const targetDir = resolveInWorkspace(dirRaw);
      // sanitize client filename: keep base name only
      const baseName = path.basename(f.originalname).replace(/[/\\]/g, '_');
      const target = resolveInWorkspace(posixJoin(dirRaw, baseName));
      if (path.dirname(target) !== targetDir) {
        res.status(400).json({ error: 'invalid upload target' });
        return;
      }
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.rename(f.path, target);
      void cleanupTmpDir(f.path);
      res.json({ ok: true, path: posixJoin(dirRaw, baseName) });
    } catch (e) {
      next(e);
    }
  }
);

function posixJoin(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

async function cleanupTmpDir(file: string): Promise<void> {
  await fs.promises.rm(path.dirname(file), { force: true, recursive: true }).catch(() => {});
}

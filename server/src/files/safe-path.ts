import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';

export class SafePathError extends Error {
  constructor(message = 'path outside workspace') {
    super(message);
    this.name = 'SafePathError';
  }
}

function canonicalRoot(): string {
  return fs.realpathSync(config.workspaceDir);
}

/**
 * Resolves a user-supplied relative path against the workspace root and
 * guarantees the result stays inside it (symlink-escape safe).
 * Targets that don't exist yet are validated through their nearest
 * existing ancestor, so creating new files can't escape either.
 */
export function resolveInWorkspace(relPath: string): string {
  if (typeof relPath !== 'string' || relPath.includes('\0')) {
    throw new SafePathError();
  }
  const root = canonicalRoot();
  const abs = path.resolve(root, relPath.replace(/^[/\\]+/, ''));

  let probe = abs;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break; // hit filesystem root; final check below fails
    probe = parent;
  }
  const realProbe = fs.realpathSync(probe);
  const realAbs = realProbe === probe ? abs : path.join(realProbe, path.relative(probe, abs));

  const rel = path.relative(root, realAbs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new SafePathError();
  }
  return realAbs;
}

export function workspaceRoot(): string {
  return canonicalRoot();
}

const BINARY_SNIFF_BYTES = 8000;

export function looksBinary(buf: Buffer): boolean {
  const slice = buf.subarray(0, BINARY_SNIFF_BYTES);
  if (slice.includes(0)) return true;
  // rough UTF-8 validity check on the sample
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(slice);
    return false;
  } catch {
    return true;
  }
}

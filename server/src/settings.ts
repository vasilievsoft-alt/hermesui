import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const FILE = () => path.join(config.configDir, 'hermesui', 'settings.json');

interface Settings {
  envByAgent: Record<string, Record<string, string>>;
}

function load(): Settings {
  try {
    const s = fs.readFileSync(FILE(), 'utf8');
    const parsed = JSON.parse(s);
    return {
      envByAgent: parsed.envByAgent ?? {},
    };
  } catch {
    return { envByAgent: {} };
  }
}

function save(s: Settings): void {
  const dir = path.dirname(FILE());
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${FILE()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, FILE());
}

export function getEnvOverrides(agentId: string): Record<string, string> {
  return load().envByAgent[agentId] ?? {};
}

export function setEnvOverrides(
  agentId: string,
  env: Record<string, string>
): void {
  const s = load();
  // strip empty values
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== '') clean[k] = v;
  }
  s.envByAgent[agentId] = clean;
  save(s);
}

export function envFor(agentId: string): NodeJS.ProcessEnv {
  return { ...process.env, ...getEnvOverrides(agentId) };
}

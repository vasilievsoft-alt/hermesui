import { spawn, type ChildProcess } from 'node:child_process';
import { Writable, Readable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import type {
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { resolveInWorkspace } from './files/safe-path.js';
import { envFor } from './settings.js';

export interface AgentSpec {
  id: string;
  label: string;
  command: string[];
}

/** Errors worth showing to the user verbatim (missing binary, startup crash…). */
export class AgentError extends Error {}

export const AGENT_SPECS: AgentSpec[] = [
  { id: 'claude', label: 'Claude Code', command: ['npx', '-y', '@zed-industries/claude-agent-acp'] },
  { id: 'opencode', label: 'OpenCode', command: ['opencode', 'acp'] },
  { id: 'openclaw', label: 'OpenClaw', command: ['openclaw', 'acp'] },
  { id: 'hermes', label: 'Hermes', command: ['hermes', 'acp'] },
];

export function agentSpec(id: string): AgentSpec | undefined {
  return AGENT_SPECS.find((a) => a.id === id);
}

type UpdateListener = (n: SessionNotification) => void;
type ExitListener = (code: number | null) => void;

interface Conn {
  spec: AgentSpec;
  proc: ChildProcess;
  conn: acp.ClientSideConnection;
  caps: acp.InitializeResponse;
}

const conns = new Map<string, Conn>();
const updateListeners = new Set<UpdateListener>();
const exitListeners = new Map<string, ExitListener>();

export function onUpdate(l: UpdateListener): () => void {
  updateListeners.add(l);
  return () => updateListeners.delete(l);
}
export function onExit(agentId: string, l: ExitListener): void {
  exitListeners.set(agentId, l);
}

function spawnOpts(agentId: string): {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: any[];
  shell?: boolean;
} {
  const o: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: any[];
    shell?: boolean;
  } = {
    cwd: config.workspaceDir,
    env: envFor(agentId),
    stdio: ['pipe', 'pipe', 'pipe'],
  };
  // .cmd shims on Windows require shell mode.
  if (process.platform === 'win32') o.shell = true;
  return o;
}

/** Absolute-path variant that still enforces the workspace sandbox. */
function resolveWorkspaceAny(p: string): string {
  const root = config.workspaceDir;
  const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
  const target = path.resolve(abs);
  if (!fs.existsSync(target)) {
    throw new Error(`file not found: ${target}`);
  }
  const real = fs.realpathSync(target);
  if (path.relative(root, real).startsWith('..')) {
    throw new Error('path outside workspace');
  }
  return real;
}

class UiClient implements acp.Client {
  async requestPermission(
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    // Single-user personal instance: auto-approve the safest allow option.
    console.log(`[acp] permission: ${params.toolCall?.title ?? ''}`);
    const options = params.options ?? [];
    const pick =
      options.find((o) => o.kind === 'allow_once') ??
      options.find((o) => o.kind === 'allow_always');
    if (pick) {
      return { outcome: { outcome: 'selected', optionId: pick.optionId } };
    }
    throw new Error('no allow option available');
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    for (const l of updateListeners) {
      try {
        l(params);
      } catch (e) {
        console.error('[acp] update listener error', e);
      }
    }
  }

  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const p = resolveWorkspaceAny(params.path);
    const content = await fs.promises.readFile(p, 'utf8');
    return { content };
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    const p = resolveInWorkspace(path.relative(config.workspaceDir, params.path));
    await fs.promises.writeFile(p, params.content, 'utf8');
    return {};
  }
}

async function ensureConn(agentId: string): Promise<Conn> {
  const existing = conns.get(agentId);
  if (existing && existing.proc.exitCode === null) return existing;

  const spec = agentSpec(agentId);
  if (!spec) throw new Error(`unknown agent ${agentId}`);

  if (!lookupBinary(spec.command[0])) {
    throw new AgentError(
      `${spec.command[0]} is not installed in this container. ` +
        (agentId === 'hermes'
          ? 'First-boot install may have failed — open Agents → Terminal → ▸ hermes and run: curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash'
          : 'Check the container build/start logs.')
    );
  }

  // Persistent 'error' listener: without it, spawn ENOENT crashes the server.
  const proc = spawn(spec.command[0], spec.command.slice(1), spawnOpts(agentId));
  proc.on('error', (e) => {
    conns.delete(agentId);
    console.error(`[${agentId}] spawn error: ${e.message}`);
  });
  proc.stderr?.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line) console.error(`[${agentId}] ${line}`);
  });

  const conn = new acp.ClientSideConnection(
    (_agent) => new UiClient(),
    acp.ndJsonStream(
      Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>
    )
  );

  // initialize races against early exit / spawn failure so callers get a
  // clean rejection instead of a hang.
  const caps = await new Promise<acp.InitializeResponse>((resolve, reject) => {
    const onExit = (code: number | null) => {
      cleanup();
      conns.delete(agentId);
      reject(
        new AgentError(
          `${spec.command[0]} exited during startup (code ${code}) — see server logs`
        )
      );
    };
    const onError = (e: Error) => {
      cleanup();
      conns.delete(agentId);
      reject(new AgentError(`${spec.command[0]} failed to start: ${e.message}`));
    };
    const cleanup = () => {
      proc.off('exit', onExit);
      proc.off('error', onError);
    };
    proc.once('exit', onExit);
    proc.once('error', onError);
    conn
      .initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      })
      .then(
        (result) => {
          cleanup();
          resolve(result);
        },
        (err: Error) => {
          cleanup();
          conns.delete(agentId);
          reject(err);
        }
      );
  });

  proc.once('exit', (code) => {
    conns.delete(agentId);
    console.warn(`[${agentId}] exited (${code})`);
    exitListeners.get(agentId)?.(code);
  });

  const c: Conn = { spec, proc, conn, caps };
  conns.set(agentId, c);
  return c;
}

export async function connectionStatus(): Promise<
  { id: string; label: string; installed: boolean }[]
> {
  return AGENT_SPECS.map((s) => ({
    id: s.id,
    label: s.label,
    installed: !!lookupBinary(s.command[0]),
  }));
}

function lookupBinary(bin: string): string | null {
  const exe = bin.endsWith('.cmd') ? bin : bin;
  for (const d of (process.env.PATH ?? '').split(path.delimiter)) {
    const p = path.join(d, exe);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

export async function newAcpSession(
  agentId: string
): Promise<{ acpSessionId: string; canLoad: boolean }> {
  const c = await ensureConn(agentId);
  const resp = await c.conn.newSession({
    cwd: config.workspaceDir,
    mcpServers: [],
  });
  return { acpSessionId: resp.sessionId, canLoad: !!c.caps.agentCapabilities?.loadSession };
}

export async function loadAcpSession(
  agentId: string,
  acpSessionId: string
): Promise<void> {
  const c = await ensureConn(agentId);
  await c.conn.loadSession({
    cwd: config.workspaceDir,
    sessionId: acpSessionId,
    mcpServers: [],
  });
}

export function canLoadSessions(agentId: string): boolean {
  return !!conns.get(agentId)?.caps.agentCapabilities?.loadSession;
}

export interface PromptEvents {
  onStop?: (reason: string, err?: Error) => void;
}

/** Passthrough ACP content blocks (text / image / …). */
export async function sendPrompt(
  agentId: string,
  acpSessionId: string,
  blocks: acp.ContentBlock[],
  events: PromptEvents = {}
): Promise<void> {
  const c = await ensureConn(agentId);
  try {
    const resp = await c.conn.prompt({
      sessionId: acpSessionId,
      prompt: blocks,
    });
    events.onStop?.(resp.stopReason);
  } catch (err) {
    events.onStop?.('error', err instanceof Error ? err : new Error(String(err)));
  }
}

export function cancelPrompt(agentId: string, acpSessionId: string): void {
  try {
    conns.get(agentId)?.conn.cancel({ sessionId: acpSessionId });
  } catch (e) {
    console.error('[acp] cancel failed', e);
  }
}

export function isProcAlive(agentId: string): boolean {
  return conns.get(agentId)?.proc.exitCode == null;
}

export function killConnection(agentId: string): void {
  const c = conns.get(agentId);
  if (!c) return;
  conns.delete(agentId);
  try {
    c.proc.kill();
  } catch {
    /* already dead */
  }
}

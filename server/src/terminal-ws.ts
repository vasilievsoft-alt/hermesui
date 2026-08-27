import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { config } from './config.js';
import { envFor } from './settings.js';

// node-pty is a native module; degrade gracefully if it fails to load.
import { createRequire } from 'node:module';
const requireNative = createRequire(import.meta.url);

let pty: typeof import('node-pty') | null = null;
try {
  // CJS module — require keeps interop predictable across runners (tsx etc).
  pty = requireNative('node-pty');
  console.log('[terminal] node-pty ready');
} catch (e) {
  console.warn(
    '[terminal] node-pty unavailable — terminal disabled:',
    (e as Error).message
  );
}

const termWss = new WebSocketServer({ noServer: true });

export function handleTerminalUpgrade(req: IncomingMessage, socket: any, head: Buffer): void {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const agentId = url.searchParams.get('agent') ?? '';

  if (!pty) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    socket.destroy();
    return;
  }

  const isWin = process.platform === 'win32';
  const shell = isWin ? process.env.ComSpec ?? 'powershell.exe' : 'bash';
  const args = isWin ? [] : ['-l'];

  const term = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: Number(url.searchParams.get('cols') ?? 100),
    rows: Number(url.searchParams.get('rows') ?? 30),
    cwd: config.workspaceDir,
    env: {
      ...envFor(agentId),
      TERM: 'xterm-256color',
    } as Record<string, string>,
  });

  termWss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    term.onData((data: string) => {
      try {
        ws.send(JSON.stringify({ type: 'data', data }));
      } catch {
        /* closed */
      }
    });
    term.onExit(() => ws.close());

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'input') term.write(String(msg.data));
        else if (msg.type === 'resize')
          term.resize(Number(msg.cols) | 0 || 80, Number(msg.rows) | 0 || 24);
      } catch {
        /* ignore */
      }
    });

    ws.on('close', () => {
      try {
        term.kill();
      } catch {
        /* already dead */
      }
    });
  });
}

void path;

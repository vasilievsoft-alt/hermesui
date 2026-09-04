import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface Props {
  agentId?: string;
  onClose: () => void;
}

const LAUNCHERS: { cmd: string; label: string }[] = [
  { cmd: 'bash', label: 'bash' },
  { cmd: 'claude', label: 'claude' },
  { cmd: 'opencode', label: 'opencode' },
  { cmd: 'openclaw', label: 'openclaw' },
  { cmd: 'hermes', label: 'hermes' },
];

export default function AgentTerminal({ agentId, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  function launch(cmd: string): void {
    wsRef.current?.send(JSON.stringify({ type: 'input', data: `${cmd}\r` }));
  }

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
      },
      fontSize: 13,
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const params = new URLSearchParams({
      agent: agentId ?? '',
      cols: String(term.cols),
      rows: String(term.rows),
    });
    const ws = new WebSocket(
      `${proto}://${location.host}/ws/terminal?${params}`
    );
    wsRef.current = ws;
    ws.onmessage = (m) => {
      try {
        const f = JSON.parse(m.data);
        if (f.type === 'data') term.write(f.data);
      } catch {
        /* ignore */
      }
    };
    ws.onopen = () => term.focus();
    ws.onclose = () => term.write('\r\n\x1b[90m[session closed]\x1b[0m');

    const inputSub = term.onData((d) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'input', data: d }));
    });
    const ro = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === ws.OPEN)
        ws.send(
          JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })
        );
    });
    ro.observe(host.current);

    return () => {
      ro.disconnect();
      inputSub.dispose();
      ws.close();
      term.dispose();
    };
  }, [agentId]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-0 sm:p-6">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-black sm:h-auto sm:max-h-[85vh] sm:max-w-4xl sm:rounded-xl sm:border sm:border-neutral-700">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-800 px-3 py-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-sm text-neutral-400 sm:px-4 sm:pt-2">
          <span className="hidden md:inline">
            agent terminal{agentId ? ` · ${agentId}` : ''} — workspace shell for
            OAuth / setup flows
          </span>
          <span className="md:hidden">
            terminal{agentId ? ` · ${agentId}` : ''}
          </span>
          <div className="ml-auto flex max-w-full items-center gap-1.5 overflow-x-auto sm:gap-2">
            {LAUNCHERS.map((l) => (
              <button
                key={l.cmd}
                onClick={() => launch(l.cmd)}
                className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 hover:text-white"
                title={`run ${l.cmd} in this terminal`}
              >
                ▸ {l.label}
              </button>
            ))}
            <button
              onClick={onClose}
              className="ml-1 shrink-0 rounded px-2 py-1 hover:bg-neutral-800 hover:text-white"
            >
              ✕ close
            </button>
          </div>
        </div>
        <div ref={host} className="min-h-0 flex-1 p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]" />
      </div>
    </div>
  );
}

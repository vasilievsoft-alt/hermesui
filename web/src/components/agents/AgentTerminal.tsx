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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6">
      <div className="flex h-full max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-neutral-700 bg-black">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2 text-sm text-neutral-400">
          <span>
            agent terminal{agentId ? ` · ${agentId}` : ''} — workspace shell for
            OAuth / setup flows
          </span>
          <div className="flex items-center gap-2">
            {LAUNCHERS.map((l) => (
              <button
                key={l.cmd}
                onClick={() => launch(l.cmd)}
                className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800 hover:text-white"
                title={`run ${l.cmd} in this terminal`}
              >
                ▸ {l.label}
              </button>
            ))}
            <button onClick={onClose} className="ml-2 hover:text-white">
              ✕ close
            </button>
          </div>
        </div>
        <div ref={host} className="min-h-0 flex-1 p-2" />
      </div>
    </div>
  );
}

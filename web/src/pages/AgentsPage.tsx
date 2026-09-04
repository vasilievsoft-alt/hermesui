import { useEffect, useState } from 'react';
import AgentTerminal from '../components/agents/AgentTerminal';
import { api } from '../api';

interface AgentStatus {
  id: string;
  label: string;
  installed: boolean;
}

interface SettingInfo {
  id: string;
  label: string;
  suggestedEnv: string[];
}

export default function AgentsPage() {
  const [status, setStatus] = useState<AgentStatus[]>([]);
  const [settings, setSettings] = useState<SettingInfo[]>([]);
  const [editAgent, setEditAgent] = useState<string | null>(null);
  const [termAgent, setTermAgent] = useState<string | null>(null);

  useEffect(() => {
    api.get<AgentStatus[]>('/api/agents').then(setStatus).catch(() => {});
    api
      .get<SettingInfo[]>('/api/agent-settings')
      .then(setSettings)
      .catch(() => {});
  }, []);

  return (
    <div className="h-full overflow-auto p-4 md:p-8">
      <h1 className="text-lg font-semibold">Agents</h1>
      <p className="mt-1 text-sm text-neutral-500">
        API keys and env vars apply to new agent processes. Use the terminal for
        OAuth flows (<code>claude login</code>, <code>hermes model</code>,{' '}
        <code>opencode auth login</code>…).
      </p>
      <div className="mt-4 grid max-w-2xl gap-3">
        {settings.map((s) => {
          const st = status.find((x) => x.id === s.id);
          return (
            <div
              key={s.id}
              className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-4"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-base font-medium">{s.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    st?.installed
                      ? 'bg-emerald-950 text-emerald-400'
                      : 'bg-red-950 text-red-400'
                  }`}
                >
                  {st ? (st.installed ? 'installed' : 'missing') : '…'}
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => setEditAgent(s.id)}
                  className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
                >
                  Env / keys
                </button>
                <button
                  onClick={() => setTermAgent(s.id)}
                  className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
                >
                  Terminal
                </button>
              </div>
              {s.suggestedEnv.length > 0 && (
                <div className="mt-2 text-xs text-neutral-500">
                  useful env: {s.suggestedEnv.join(', ')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editAgent && (
        <EnvEditor agentId={editAgent} onClose={() => setEditAgent(null)} />
      )}
      {termAgent && (
        <AgentTerminal agentId={termAgent} onClose={() => setTermAgent(null)} />
      )}
    </div>
  );
}

function EnvEditor({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<{ k: string; v: string }[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get<{ env: Record<string, string> }>(
        `/api/agent-settings/${agentId}/env`
      )
      .then((r) =>
        setRows([
          ...Object.entries(r.env).map(([k, v]) => ({ k, v })),
          { k: '', v: '' },
        ])
      )
      .catch(() => setRows([{ k: '', v: '' }]));
  }, [agentId]);

  function update(i: number, field: 'k' | 'v', val: string) {
    setRows((rs) => {
      const next = [...rs];
      next[i] = { ...next[i], [field]: val };
      if (i === rs.length - 1 && (field === 'k' || val)) next.push({ k: '', v: '' });
      return next.filter((r, j) => r.k || r.v || j === rs.length - 1);
    });
    setSaved(false);
  }

  async function save() {
    const env: Record<string, string> = {};
    for (const r of rows) if (r.k) env[r.k] = r.v;
    await api.put(`/api/agent-settings/${agentId}/env`, { env });
    setSaved(true);
  }

  const isSecret = (k: string) => /key|token|secret|password/i.test(k);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4 md:p-6">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 pb-[env(safe-area-inset-bottom)] pt-5 pl-5 pr-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-medium">Environment · {agentId}</span>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-white">
            ✕
          </button>
        </div>
        <div className="max-h-80 space-y-2 overflow-auto overscroll-contain pr-1">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={r.k}
                onChange={(e) => update(i, 'k', e.target.value)}
                placeholder="VAR_NAME"
                spellCheck={false}
                className="w-[40%] shrink-0 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs outline-none focus:border-neutral-500 md:w-56 md:text-xs"
              />
              <input
                type={r.k && isSecret(r.k) ? 'password' : 'text'}
                value={r.v}
                onChange={(e) => update(i, 'v', e.target.value)}
                placeholder="value"
                className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs outline-none focus:border-neutral-500 md:text-xs"
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2 pb-1">
          {saved && <span className="text-sm text-emerald-400">saved</span>}
          <button
            onClick={() => void save()}
            className="rounded-md bg-emerald-700 px-4 py-2.5 text-sm hover:bg-emerald-600 md:py-2"
          >
            Save & restart connection
          </button>
        </div>
      </div>
    </div>
  );
}

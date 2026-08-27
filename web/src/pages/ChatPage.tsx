import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatApi, subscribeChat } from '../chat-ws';
import { api } from '../api';
import { filesApi } from '../files-api';
import type {
  AgentStatus,
  ChatEvent,
  ConversationInfo,
  MessageInfo,
  ToolMeta,
} from '../types-chat';

interface PendingAttach {
  id: string;
  file: globalThis.File;
  isImage: boolean;
}

interface LiveMsg {
  role: 'assistant';
  text: string;
  thoughts: string;
  tools: Map<string, ToolMeta>;
}

export default function ChatPage() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [convs, setConvs] = useState<ConversationInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [history, setHistory] = useState<MessageInfo[]>([]);
  const [live, setLive] = useState<LiveMsg | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingAttach[]>([]);
  const attachInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<AgentStatus[]>('/api/agents').then(setAgents).catch(() => {});
    void reloadConvs();
  }, []);

  const reloadConvs = useCallback(() => {
    return chatApi.conversations().then(setConvs).catch(() => {});
  }, []);

  useEffect(() => {
    return subscribeChat((e: ChatEvent) => handleEvent(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  function handleEvent(e: ChatEvent) {
    if (!activeId || e.conversationId !== activeId) return;
    switch (e.kind) {
      case 'user':
        setHistory((h) => [
          ...h,
          {
            id: -Date.now(),
            conversation_id: e.conversationId,
            role: 'user',
            content: e.text ?? '',
            meta: '{}',
            created_at: Date.now(),
          },
        ]);
        break;
      case 'chunk':
        setLive((l) =>
          l ? { ...l, text: l.text + (e.text ?? '') } : newLive(e.text ?? '')
        );
        break;
      case 'thought':
        if (e.text)
          setLive((l) =>
            l ? { ...l, thoughts: l.thoughts + e.text } : newLive('', e.text ?? '')
          );
        break;
      case 'tool':
        setLive((l) => {
          if (!l) return newLive();
          const tools = new Map(l.tools);
          tools.set(e.toolCallId!, {
            id: e.toolCallId!,
            status: e.status ?? '',
            title: e.title ?? 'tool',
          });
          return { ...l, tools };
        });
        break;
      case 'stop':
      case 'error':
        setBusy(false);
        void reloadConvs();
        // refresh history from server once turn finalizes
        if (activeId && !('message' in e && e.kind === 'stop')) {
          // fallthrough load below
        }
        chatApi
          .messages(activeId)
          .then(setHistory)
          .finally(() => setLive(null));
        break;
    }
    requestAnimationFrame(scrollDown);
  }

  function newLive(text = '', thought = ''): LiveMsg {
    return { role: 'assistant', text, thoughts: thought, tools: new Map() };
  }

  async function openConv(id: string) {
    setActiveId(id);
    setBusy(false);
    setLive(null);
    try {
      setHistory(await chatApi.messages(id));
    } catch {
      setHistory([]);
    }
    requestAnimationFrame(scrollDown);
  }

  async function newConversation(agentId: string) {
    setCreating(true);
    try {
      const r = await chatApi.create(agentId);
      await reloadConvs();
      await openConv(r.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function send() {
    if (!activeId || busy) return;
    if (!input.trim() && !pending.length) return;
    const text = input;
    setInput('');

    // Split attachments: images go as ACP image blocks, other files are
    // uploaded into workspace/attachments and referenced by path.
    const attaches = pending.splice(0, pending.length);
    setPending([]);
    const images: { mimeType: string; data: string }[] = [];
    const filePaths: string[] = [];
    for (const a of attaches) {
      if (a.isImage) {
        try {
          images.push({
            mimeType: a.file.type || 'image/png',
            data: await fileToBase64(a.file),
          });
        } catch (e) {
          alert(`failed to read ${a.file.name}: ${String(e)}`);
        }
      } else {
        try {
          const path = `attachments/${Date.now()}-${a.file.name.replace(/[/\\]/g, '_')}`;
          await filesApi.upload('attachments', a.file).catch(async () => {
            // attachments dir may not exist yet — create and retry once
            await filesApi.mkdir('attachments');
            await filesApi.upload('attachments', a.file);
          });
          filePaths.push(path);
        } catch (e) {
          alert(`failed to upload ${a.file.name}: ${String(e)}`);
        }
      }
    }

    setBusy(true);
    setLive(newLive());
    try {
      await chatApi.send(activeId, text, images, filePaths);
    } catch (e) {
      setBusy(false);
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  function addAttachments(list: globalThis.File[]) {
    for (const f of list) {
      const isImage = /^image\//.test(f.type);
      if (!isImage && f.size > 50 * 1024 * 1024) {
        alert(`${f.name}: too large (50 MB max)`);
        continue;
      }
      setPending((p) => [...p, { id: `${Date.now()}-${f.name}`, file: f, isImage }]);
    }
  }

  function scrollDown() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  const installed = agents.filter((a) => a.installed);

  return (
    <div className="flex h-full">
      {/* conversations */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/40">
        <div className="border-b border-neutral-800 p-2">
          <select
            value=""
            onChange={(e) => e.target.value && void newConversation(e.target.value)}
            disabled={creating}
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm"
          >
            <option value="">+ New chat…</option>
            {(installed.length ? installed : agents).map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
                {!a.installed ? ' (not installed)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 overflow-auto p-1">
          {convs.map((c) => (
            <button
              key={c.id}
              onClick={() => void openConv(c.id)}
              className={`mb-0.5 block w-full rounded-md px-3 py-2 text-left text-sm ${
                c.id === activeId
                  ? 'bg-neutral-800 text-white'
                  : 'text-neutral-400 hover:bg-neutral-800/50'
              }`}
            >
              <span className="block truncate">{c.title || '(untitled)'}</span>
              <span className="text-xs text-neutral-600">{c.agent}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* messages */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 overflow-auto p-4">
          {!activeId && (
            <div className="grid h-full place-items-center text-sm text-neutral-600">
              create a chat with one of the agents
            </div>
          )}
          {history.map((m) => (
            <Bubble key={m.id} msg={m} />
          ))}
          {live && (
            <AssistantBlock
              text={live.text}
              thoughts={live.thoughts}
              tools={[...live.tools.values()]}
            />
          )}
        </div>

        {activeId && (
          <div className="border-t border-neutral-800 p-3">
            {pending.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pending.map((a) => (
                  <span
                    key={a.id}
                    className="flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300"
                  >
                    {a.isImage ? '🖼' : '📄'} {a.file.name.slice(0, 32)}
                    <button
                      onClick={() =>
                        setPending((p) => p.filter((x) => x.id !== a.id))
                      }
                      className="ml-1 text-neutral-500 hover:text-white"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <button
                onClick={() => attachInput.current?.click()}
                title="attach images / files"
                className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800"
              >
                📎
              </button>
              <input
                ref={attachInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  addAttachments(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                onPaste={(e) => {
                  const imgs = Array.from(e.clipboardData.files).filter((f) =>
                    /^image\//.test(f.type)
                  );
                  if (imgs.length) {
                    e.preventDefault();
                    addAttachments(imgs);
                  }
                }}
                rows={Math.min(6, input.split('\n').length)}
                placeholder={
                  busy ? 'agent is working…' : 'message, 📎 images/files — Enter to send'
                }
                className="max-h-40 flex-1 resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
              {busy ? (
                <button
                  onClick={() => activeId && void chatApi.stop(activeId)}
                  className="rounded-lg bg-red-800 px-4 py-2 text-sm hover:bg-red-700"
                >
                  ■ Stop
                </button>
              ) : (
                <button
                  onClick={() => void send()}
                  disabled={!input.trim() && !pending.length}
                  className="rounded-lg bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
                >
                  Send
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Bubble({ msg }: { msg: MessageInfo }) {
  const meta = safeParse(msg.meta);
  return (
    <div className={`mb-4 flex ${msg.role === 'user' ? 'justify-end' : ''}`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
          msg.role === 'user'
            ? 'bg-neutral-800 text-neutral-100'
            : 'bg-neutral-900/70 ring-1 ring-neutral-800'
        }`}
      >
        {msg.role === 'user' ? (
          <span className="whitespace-pre-wrap">{msg.content}</span>
        ) : (
          <>
            {meta?.thoughts && (
              <details className="mb-2 text-xs text-neutral-500">
                <summary className="cursor-pointer">thinking</summary>
                <div className="mt-1 whitespace-pre-wrap">{meta.thoughts}</div>
              </details>
            )}
            <Markdownish text={msg.content} />
            {!!meta?.tools?.length && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-neutral-500">
                  tool calls ({meta.tools.length})
                </summary>
                <ul className="mt-1 space-y-0.5 text-neutral-400">
                  {meta.tools.map((t: ToolMeta) => (
                    <li key={t.id}>
                      {t.status === 'completed' ? '✓' : '•'} {t.title}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AssistantBlock({
  text,
  thoughts,
  tools,
}: {
  text: string;
  thoughts: string;
  tools: ToolMeta[];
}) {
  return (
    <div className="mb-4 flex">
      <div className="max-w-[80%] rounded-xl bg-neutral-900/70 px-4 py-3 text-sm ring-1 ring-neutral-800">
        {thoughts && (
          <div className="mb-2 whitespace-pre-wrap text-xs italic text-neutral-500">
            {thoughts.slice(-400)}
          </div>
        )}
        <Markdownish text={text} />
        <ul className="mt-2 space-y-0.5 text-xs text-neutral-500">
          {tools.map((t) => (
            <li key={t.id}>
              {t.status === 'completed'
                ? '✓'
                : t.status === 'in_progress'
                  ? '⚙'
                  : '•'}{' '}
              {t.title}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Markdownish({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="prose-invert max-w-none break-words [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-neutral-950 [&_pre]:p-2 [&_code]:text-xs">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function fileToBase64(f: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1)); // strip data: prefix
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

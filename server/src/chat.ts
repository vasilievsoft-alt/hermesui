import { Router } from 'express';
import crypto from 'node:crypto';
import * as acp from '@agentclientprotocol/sdk';
import { queries } from './db.js';
import {
  newAcpSession,
  loadAcpSession,
  sendPrompt,
  cancelPrompt,
  isProcAlive,
  canLoadSessions,
  onUpdate,
} from './acp.js';
import { publishChatEvent } from './bus.js';

export const chatRouter = Router();

interface LiveTurn {
  agentId: string;
  acpSessionId: string;
  busy: boolean;
  buffer: string;
  thoughts: string[];
  tools: Map<string, { status: string; title: string }>;
}

const live = new Map<string, LiveTurn>(); // by conversationId
const byAcp = new Map<string, string>(); // acpSessionId -> conversationId

onUpdate((n) => {
  const convId = byAcp.get(n.sessionId);
  if (!convId) return;
  const t = live.get(convId);
  const u = n.update as unknown as Record<string, any>;

  switch (u.sessionUpdate) {
    case 'agent_message_chunk': {
      const text =
        u.content?.type === 'text' ? u.content.text : `[${u.content?.type}]`;
      if (t) t.buffer += text;
      publishChatEvent({ conversationId: convId, kind: 'chunk', text });
      break;
    }
    case 'agent_thought_chunk': {
      const text = u.content?.type === 'text' ? u.content.text : '';
      if (t && text) t.thoughts.push(text);
      publishChatEvent({ conversationId: convId, kind: 'thought', text });
      break;
    }
    case 'tool_call':
    case 'tool_call_update': {
      const entry = {
        status: String(u.status ?? ''),
        title: String(u.title ?? u.toolCallId ?? 'tool'),
      };
      if (t) t.tools.set(String(u.toolCallId), entry);
      publishChatEvent({
        conversationId: convId,
        kind: 'tool',
        toolCallId: String(u.toolCallId),
        status: entry.status,
        title: entry.title,
      });
      break;
    }
    default:
      // plan / available_commands / current_mode / user_message_chunk: ignore
      break;
  }
});

async function ensureLiveFor(
  convId: string
): Promise<LiveTurn> {
  let t = live.get(convId);
  if (!t) {
    const row = queries.conversations.get(convId);
    if (!row) throw new Error('conversation not found');
    t = {
      agentId: row.agent,
      acpSessionId: row.acp_session_id ?? '',
      busy: false,
      buffer: '',
      thoughts: [],
      tools: new Map(),
    };
    live.set(convId, t);
    if (row.acp_session_id) byAcp.set(row.acp_session_id, convId);
  }
  return t;
}

async function restoreOrFreshAcpSession(t: LiveTurn, convId: string): Promise<void> {
  if (isProcAlive(t.agentId) && t.acpSessionId && canLoadSessions(t.agentId)) {
    try {
      await loadAcpSession(t.agentId, t.acpSessionId);
      return;
    } catch (e) {
      console.error(`[chat] resume failed for ${convId}:`, e);
    }
  }
  // Proc died or no resume support: open a fresh agent-side session.
  const s = await newAcpSession(t.agentId);
  if (t.acpSessionId) byAcp.delete(t.acpSessionId);
  t.acpSessionId = s.acpSessionId;
  byAcp.set(s.acpSessionId, convId);
  queries.conversations.touchAcpSession(convId, s.acpSessionId);
}

chatRouter.get('/conversations', (_req, res) => {
  res.json(queries.conversations.list());
});

chatRouter.post('/conversations', async (req, res, next) => {
  try {
    const { agentId } = req.body as { agentId?: string };
    if (!agentId) {
      res.status(400).json({ error: 'agentId required' });
      return;
    }
    const id = crypto.randomUUID();
    queries.conversations.create({ id, agent: agentId, title: '', acp_session_id: null });
    const t = await ensureLiveFor(id);
    await restoreOrFreshAcpSession(t, id); // spawns CLI on first use
    res.json({ id, agentId, acpSessionId: t.acpSessionId });
  } catch (e) {
    next(e);
  }
});

chatRouter.delete('/conversations/:id', (req, res) => {
  queries.conversations.remove(req.params.id);
  live.delete(req.params.id);
  res.json({ ok: true });
});

chatRouter.get('/conversations/:id/messages', (req, res) => {
  res.json(queries.messages.list(req.params.id));
});

chatRouter.post('/conversations/:id/send', async (req, res, next) => {
  try {
    const { text } = req.body as { text?: string };
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text required' });
      return;
    }
    const convId = req.params.id;
    const row = queries.conversations.get(convId);
    if (!row) {
      res.status(404).json({ error: 'conversation not found' });
      return;
    }
    const t = await ensureLiveFor(convId);
    if (t.busy) {
      res.status(409).json({ error: 'agent is busy' });
      return;
    }

    // Attach an agent process/session on demand (covers restarts, first run).
    if (!t.acpSessionId || !isProcAlive(t.agentId)) {
      await restoreOrFreshAcpSession(t, convId);
    }

    queries.messages.add({ conversation_id: convId, role: 'user', content: text });
    queries.conversations.setTitleIfEmpty(convId, text.replace(/\s+/g, ' ').trim());
    publishChatEvent({ conversationId: convId, kind: 'user', text });

    t.busy = true;
    t.buffer = '';
    t.thoughts = [];
    t.tools.clear();

    void sendPrompt(t.agentId, t.acpSessionId, text, {
      onStop(reason, err) {
        t.busy = false;
        const meta = {
          stopReason: reason,
          tools: [...t.tools.entries()].map(([id, v]) => ({ id, ...v })),
          thoughts: t.thoughts.length ? t.thoughts.join('') : undefined,
        };
        if (t.buffer || t.tools.size) {
          queries.messages.add({
            conversation_id: convId,
            role: 'assistant',
            content: t.buffer,
            meta,
          });
        }
        publishChatEvent({
          conversationId: convId,
          kind: err ? 'error' : 'stop',
          stopReason: reason,
          message: err?.message,
        });
      },
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

chatRouter.post('/conversations/:id/stop', (req, res, next) => {
  try {
    const t = live.get(req.params.id);
    if (t && t.acpSessionId) cancelPrompt(t.agentId, t.acpSessionId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

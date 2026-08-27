import { api } from './api';
import type { ChatEvent, ConversationInfo, MessageInfo } from './types-chat';

export const chatApi = {
  conversations: () => api.get<ConversationInfo[]>('/api/chat/conversations'),
  create: (agentId: string) =>
    api.post<{ id: string }>('/api/chat/conversations', { agentId }),
  remove: (id: string) =>
    fetch(`/api/chat/conversations/${id}`, { method: 'DELETE' }).then((r) => {
      if (!r.ok) throw new Error(`delete failed: ${r.status}`);
      return r.json();
    }),
  messages: (id: string) =>
    api.get<MessageInfo[]>(`/api/chat/conversations/${id}/messages`),
  send: (
    id: string,
    text: string,
    images: { mimeType: string; data: string }[] = [],
    files: string[] = []
  ) =>
    api.post<{ ok: boolean }>(`/api/chat/conversations/${id}/send`, {
      text,
      images,
      files,
    }),
  stop: (id: string) =>
    api.post<{ ok: boolean }>(`/api/chat/conversations/${id}/stop`),
};

type Listener = (e: ChatEvent) => void;

let socket: WebSocket | null = null;
let retry = 0;
const listeners = new Set<Listener>();

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onmessage = (m) => {
    try {
      const frame = JSON.parse(m.data);
      if (frame.type === 'chat') {
        listeners.forEach((l) => l(frame.event as ChatEvent));
      }
    } catch {
      /* ignore junk frames */
    }
  };
  socket.onopen = () => (retry = 0);
  socket.onclose = () => {
    const wait = Math.min(5000, 500 * ++retry);
    setTimeout(connect, wait);
  };
}

export function subscribeChat(l: Listener): () => void {
  if (!socket && retry === 0) connect();
  listeners.add(l);
  return () => listeners.delete(l);
}

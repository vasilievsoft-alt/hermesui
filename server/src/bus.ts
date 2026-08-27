import { EventEmitter } from 'node:events';

export interface ChatEvent {
  conversationId: string;
  kind:
    | 'user'
    | 'chunk'
    | 'thought'
    | 'tool'
    | 'stop'
    | 'error'
    | 'busy'
    | 'session';
  text?: string;
  toolCallId?: string;
  status?: string;
  title?: string;
  stopReason?: string;
  message?: string;
}

export const bus = new EventEmitter();
bus.setMaxListeners(50);

export function publishChatEvent(event: ChatEvent): void {
  bus.emit('chat', event);
}

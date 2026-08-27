export interface ConversationInfo {
  id: string;
  agent: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface MessageInfo {
  id: number;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  meta: string;
  created_at: number;
}

export interface ToolMeta {
  id: string;
  status: string;
  title: string;
}

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

export interface AgentStatus {
  id: string;
  label: string;
  installed: boolean;
}

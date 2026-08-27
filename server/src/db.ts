import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';

const dbDir = path.join(config.configDir, 'hermesui');
fs.mkdirSync(dbDir, { recursive: true });

export const db = new DatabaseSync(path.join(dbDir, 'data.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  acp_session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
`);

export interface ConversationRow {
  id: string;
  agent: string;
  title: string;
  acp_session_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: number;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  meta: string;
  created_at: number;
}

export const queries = {
  conversations: {
    list(): ConversationRow[] {
      return db
        .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
        .all() as unknown as ConversationRow[];
    },
    get(id: string): ConversationRow | undefined {
      return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
        | ConversationRow
        | undefined;
    },
    create(row: Omit<ConversationRow, 'created_at' | 'updated_at'>): ConversationRow {
      const now = Date.now();
      db.prepare(
        'INSERT INTO conversations (id, agent, title, acp_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(row.id, row.agent, row.title, row.acp_session_id, now, now);
      return queries.conversations.get(row.id)!;
    },
    touchAcpSession(id: string, acpSessionId: string | null): void {
      db.prepare(
        'UPDATE conversations SET acp_session_id = ?, updated_at = ? WHERE id = ?'
      ).run(acpSessionId, Date.now(), id);
    },
    setTitleIfEmpty(id: string, title: string): void {
      db.prepare(
        "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND title = ''"
      ).run(title.slice(0, 80), Date.now(), id);
    },
    remove(id: string): void {
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    },
  },
  messages: {
    list(conversationId: string): MessageRow[] {
      return db
        .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id')
        .all(conversationId) as unknown as MessageRow[];
    },
    add(row: {
      conversation_id: string;
      role: 'user' | 'assistant';
      content: string;
      meta?: unknown;
    }): void {
      db.prepare(
        'INSERT INTO messages (conversation_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(
        row.conversation_id,
        row.role,
        row.content,
        JSON.stringify(row.meta ?? {}),
        Date.now()
      );
    },
  },
};

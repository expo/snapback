// Chat matrix — SQLite column. A plain local database owned by the gateway;
// clients reach it only through the gateway's HTTP surface and poll for
// freshness. The AI worker shares the same adapter interface as Supabase.

import { Database } from 'bun:sqlite';

export function createSqliteChatAdapter(path: string) {
  const db = new Database(path);
  db.run('PRAGMA journal_mode = WAL');
  db.run(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  db.run('CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages (conversation_id, created_at)');

  const rowToConversation = (row: any) => ({ _id: row.id, title: row.title, model: row.model, createdAt: row.created_at });
  const rowToMessage = (row: any) => ({ _id: row.id, conversationId: row.conversation_id, role: row.role, content: row.content, status: row.status, createdAt: row.created_at });

  return {
    backend: 'sqlite' as const,
    async listConversations() {
      return db.query('SELECT * FROM conversations ORDER BY created_at').all().map(rowToConversation);
    },
    async createConversation(model: string, title: string, createdAt: number) {
      const id = `conv_${crypto.randomUUID()}`;
      db.run('INSERT INTO conversations (id, title, model, created_at) VALUES (?,?,?,?)', [id, title, model, createdAt]);
      return id;
    },
    async listMessages(conversationId: string) {
      return db.query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at').all(conversationId).map(rowToMessage);
    },
    async sendMessage(conversationId: string, content: string, createdAt: number) {
      const assistantId = `msg_${crypto.randomUUID()}`;
      db.run('INSERT INTO messages (id, conversation_id, role, content, status, created_at) VALUES (?,?,?,?,?,?)', [`msg_${crypto.randomUUID()}`, conversationId, 'user', content, 'complete', createdAt]);
      db.run('INSERT INTO messages (id, conversation_id, role, content, status, created_at) VALUES (?,?,?,?,?,?)', [assistantId, conversationId, 'assistant', '', 'pending', createdAt + 1]);
      return assistantId;
    },
    async claimPending() {
      const row = db.query("SELECT id, conversation_id FROM messages WHERE status = 'pending' ORDER BY created_at LIMIT 1").get() as any;
      if (!row) return null;
      db.run("UPDATE messages SET status = 'streaming' WHERE id = ?", [row.id]);
      const conversation = db.query('SELECT model FROM conversations WHERE id = ?').get(row.conversation_id) as any;
      const history = db.query(`SELECT role, content FROM messages
        WHERE conversation_id = ? AND id <> ? AND status = 'complete' ORDER BY created_at`).all(row.conversation_id, row.id)
        .map((message: any) => ({ role: message.role, content: message.content }));
      return { messageId: row.id as string, model: conversation?.model as string, history };
    },
    async applyDelta(messageId: string, content: string, status: string) {
      db.run('UPDATE messages SET content = ?, status = ? WHERE id = ?', [content, status, messageId]);
    },
    async close() { db.close(); },
  };
}

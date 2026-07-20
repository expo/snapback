// Chat matrix — Supabase column. Tables live in the shared hosted project
// (public schema, chat_matrix_* prefix). Browser/Expo clients read and write
// with supabase-js + the publishable key under RLS; the AI worker (this
// process, table owner) claims pending assistant rows and streams deltas in,
// which Realtime fans out to subscribed clients.

import { SQL } from 'bun';

const T = {
  conversations: 'public.chat_matrix_conversations',
  messages: 'public.chat_matrix_messages',
};

export async function createSupabaseChatAdapter(databaseUrl: string) {
  const sql = new SQL(databaseUrl);
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${T.conversations} (
    id text PRIMARY KEY, title text NOT NULL, model text NOT NULL, created_at bigint NOT NULL
  )`);
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${T.messages} (
    id text PRIMARY KEY,
    conversation_id text NOT NULL REFERENCES ${T.conversations}(id) ON DELETE CASCADE,
    role text NOT NULL, content text NOT NULL DEFAULT '',
    status text NOT NULL, created_at bigint NOT NULL
  )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS chat_matrix_messages_by_conversation
    ON ${T.messages} (conversation_id, created_at)`);

  // Same hardening posture as partiful (harden-supabase.ts): RLS on, anon
  // reads/inserts only — assistant rows are patched exclusively by this
  // owner-connected worker, so anon gets no UPDATE policy at all.
  for (const table of ['chat_matrix_conversations', 'chat_matrix_messages']) {
    await sql.unsafe(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    await sql.unsafe(`REVOKE TRUNCATE, DELETE, UPDATE ON public.${table} FROM anon, authenticated`);
    await sql.unsafe(`ALTER TABLE public.${table} REPLICA IDENTITY FULL`);
    await sql.unsafe(`DROP POLICY IF EXISTS ${table}_select ON public.${table}`);
    await sql.unsafe(`CREATE POLICY ${table}_select ON public.${table} FOR SELECT USING (true)`);
    await sql.unsafe(`DROP POLICY IF EXISTS ${table}_insert ON public.${table}`);
    await sql.unsafe(`CREATE POLICY ${table}_insert ON public.${table} FOR INSERT WITH CHECK (true)`);
    const member = await sql`SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = ${table}`;
    if (member.length === 0) {
      await sql.unsafe(`ALTER PUBLICATION supabase_realtime ADD TABLE public.${table}`);
    }
  }

  const rowToConversation = (row: any) => ({ _id: row.id, title: row.title, model: row.model, createdAt: Number(row.created_at) });
  const rowToMessage = (row: any) => ({ _id: row.id, conversationId: row.conversation_id, role: row.role, content: row.content, status: row.status, createdAt: Number(row.created_at) });

  return {
    backend: 'supabase' as const,
    async listConversations() {
      return (await sql.unsafe(`SELECT * FROM ${T.conversations} ORDER BY created_at`)).map(rowToConversation);
    },
    async createConversation(model: string, title: string, createdAt: number) {
      const id = `conv_${crypto.randomUUID()}`;
      await sql.unsafe(`INSERT INTO ${T.conversations} (id, title, model, created_at) VALUES ($1,$2,$3,$4)`, [id, title, model, createdAt]);
      return id;
    },
    async listMessages(conversationId: string) {
      return (await sql.unsafe(`SELECT * FROM ${T.messages} WHERE conversation_id = $1 ORDER BY created_at`, [conversationId])).map(rowToMessage);
    },
    async sendMessage(conversationId: string, content: string, createdAt: number) {
      const assistantId = `msg_${crypto.randomUUID()}`;
      await sql.unsafe(`INSERT INTO ${T.messages} (id, conversation_id, role, content, status, created_at)
        VALUES ($1,$2,'user',$3,'complete',$4)`, [`msg_${crypto.randomUUID()}`, conversationId, content, createdAt]);
      await sql.unsafe(`INSERT INTO ${T.messages} (id, conversation_id, role, content, status, created_at)
        VALUES ($1,$2,'assistant','','pending',$3)`, [assistantId, conversationId, createdAt + 1]);
      return assistantId;
    },
    // --- AI-worker surface -------------------------------------------------
    async claimPending() {
      const rows = await sql.unsafe(`UPDATE ${T.messages} SET status = 'streaming'
        WHERE id = (SELECT id FROM ${T.messages} WHERE status = 'pending' ORDER BY created_at LIMIT 1)
        RETURNING id, conversation_id`);
      if (rows.length === 0) return null;
      const conversation = (await sql.unsafe(`SELECT model FROM ${T.conversations} WHERE id = $1`, [rows[0].conversation_id]))[0];
      const history = (await sql.unsafe(`SELECT role, content FROM ${T.messages}
        WHERE conversation_id = $1 AND id <> $2 AND status = 'complete'
        ORDER BY created_at`, [rows[0].conversation_id, rows[0].id]))
        .map((row: any) => ({ role: row.role, content: row.content }));
      return { messageId: rows[0].id as string, model: conversation?.model as string, history };
    },
    async applyDelta(messageId: string, content: string, status: string) {
      await sql.unsafe(`UPDATE ${T.messages} SET content = $2, status = $3 WHERE id = $1`, [messageId, content, status]);
    },
    async close() { await sql.close(); },
  };
}

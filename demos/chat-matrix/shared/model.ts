// Shared product model for the 2×4 chat matrix (Exact vs Expo × Snapback,
// Convex, Supabase, SQLite). One conversation with an AI: the user picks an
// OpenRouter model, sends messages, and the assistant reply streams into the
// message row as it generates.

export const BACKENDS = ['snapback', 'convex', 'supabase', 'sqlite'] as const;
export type Backend = (typeof BACKENDS)[number];

export type Role = 'user' | 'assistant';
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

export interface ConversationRow {
  _id: string;
  title: string;
  model: string; // OpenRouter model id, e.g. "anthropic/claude-sonnet-4.5"
  createdAt: number;
}

export interface MessageRow {
  _id: string;
  conversationId: string;
  role: Role;
  content: string;
  status: MessageStatus;
  createdAt: number;
}

// The AI reply lifecycle is data, not transport: sendMessage writes the user
// row plus an assistant row with status 'pending'; the AI worker claims it,
// streams OpenRouter output into `content` (status 'streaming'), then marks
// 'complete' or 'error'. Every backend's own subscription primitive delivers
// the progressive updates to its clients.

export interface ChatProvider {
  readonly backend: Backend;
  listConversations(): Promise<ConversationRow[]>;
  createConversation(model: string, title: string): Promise<string>;
  listMessages(conversationId: string): Promise<MessageRow[]>;
  /** Writes the user message and the pending assistant row; returns the assistant row id. */
  sendMessage(conversationId: string, content: string): Promise<string>;
  close?(): Promise<void>;
}

// A curated shortlist keeps the picker useful; the gateway's /models endpoint
// serves the live OpenRouter catalog for anything not listed here.
export const FEATURED_MODELS = [
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-haiku-4.5',
  'openai/gpt-5.2',
  'openai/gpt-5-mini',
  'google/gemini-3-flash',
  'meta-llama/llama-4-maverick',
  'deepseek/deepseek-chat-v3.1',
  'mistralai/mistral-large-2512',
] as const;

export function conversationTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim().replace(/\s+/g, ' ');
  return trimmed.length <= 40 ? trimmed : `${trimmed.slice(0, 39)}…`;
}

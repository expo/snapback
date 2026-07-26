const GATEWAY = 'http://127.0.0.1:4470';

interface MessageRow {
  _id: string;
  role: string;
  content: string;
  status: string;
}

interface ChatResult {
  ok: boolean;
  conversationId: string | null;
  messages: MessageRow[];
  error: string;
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`network request did not settle within ${timeoutMs}ms`));
    }, timeoutMs);
    fetch(url, init).then((response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function rpc<T>(backend: string, op: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetchWithTimeout(`${GATEWAY}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ backend, op, args }),
  }, 10_000);
  const payload = (await response.json()) as { ok: boolean; value?: T; error?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `${backend}.${op} failed (${response.status})`);
  }
  return payload.value as T;
}

function conversationTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim().replace(/\s+/g, ' ');
  return trimmed.length <= 40 ? trimmed : `${trimmed.slice(0, 39)}…`;
}

export async function sendMessage(
  backend: string,
  existingConversationId: string | null,
  model: string,
  content: string,
): Promise<ChatResult> {
  try {
    const conversationId = existingConversationId ?? await rpc<string>(backend, 'createConversation', {
      model,
      title: conversationTitle(content),
    });
    await rpc<string>(backend, 'sendMessage', { conversationId, content });
    const messages = await rpc<MessageRow[]>(backend, 'listMessages', { conversationId });
    return { ok: true, conversationId, messages, error: '' };
  } catch (cause) {
    return {
      ok: false,
      conversationId: existingConversationId,
      messages: [],
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export async function pollConversation(backend: string, conversationId: string): Promise<ChatResult> {
  try {
    const messages = await rpc<MessageRow[]>(backend, 'listMessages', { conversationId });
    return { ok: true, conversationId, messages, error: '' };
  } catch (cause) {
    return {
      ok: false,
      conversationId,
      messages: [],
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export function formatTranscript(messages: MessageRow[], backend: string, sending: boolean): string[] {
  if (messages.length === 0) {
    return [
      `chat-matrix · ${backend}`,
      sending ? 'sending…' : 'Network enabled by Exact LLP 0368. Type a message and press Enter.',
    ];
  }
  return messages.slice(-20).map((message) => {
    const speaker = message.role === 'user' ? 'you' : 'ai ';
    const content = message.content.length === 0 ? '…' : message.content;
    return `${speaker}  ${content}${message.status === 'streaming' ? ' ▍' : ''}`;
  });
}

export function backendTabs(): { id: string; label: string; disabled: boolean }[] {
  return ['snapback', 'convex', 'supabase', 'sqlite'].map((id) => ({
    id,
    label: id,
    disabled: false,
  }));
}

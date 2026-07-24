// chat-matrix OpenTUI cell: React renderer over @opentui/core, same product
// as every other authoring stack, over the gateway's portable /rpc surface.
//
//   bun run cli.tsx [--backend sqlite] [--autodemo] [--gateway http://...]
//
// Keys: Enter send · Tab backend · Ctrl-P model picker · Ctrl-N new chat · Ctrl-C quit
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot, useKeyboard } from '@opentui/react';

const BACKENDS = ['snapback', 'convex', 'supabase', 'sqlite'] as const;
type Backend = (typeof BACKENDS)[number];

interface MessageRow {
  _id: string;
  role: string;
  content: string;
  status: string;
}

const args = process.argv.slice(2);
const flagValue = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const GATEWAY = flagValue('--gateway') ?? process.env.CHAT_GATEWAY_ORIGIN ?? 'http://127.0.0.1:4470';
const AUTODEMO = args.includes('--autodemo') || process.env.CHAT_AUTODEMO === '1';
const INITIAL_BACKEND: Backend = (BACKENDS as readonly string[]).includes(flagValue('--backend') ?? process.env.CHAT_BACKEND ?? '')
  ? ((flagValue('--backend') ?? process.env.CHAT_BACKEND) as Backend)
  : 'sqlite';
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';

async function rpc<T>(backend: Backend, op: string, rpcArgs: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${GATEWAY}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ backend, op, args: rpcArgs }),
  });
  const payload = (await response.json()) as { ok: boolean; value?: T; error?: string };
  if (!payload.ok) throw new Error(payload.error ?? `${backend}.${op} failed`);
  return payload.value as T;
}

function conversationTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim().replace(/\s+/g, ' ');
  return trimmed.length <= 40 ? trimmed : `${trimmed.slice(0, 39)}…`;
}

let transcript: MessageRow[] = [];

function App() {
  const [backend, setBackend] = useState<Backend>(INITIAL_BACKEND);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ query: string; at: number } | null>(null);
  const [catalog, setCatalog] = useState<{ featured: string[]; all: { id: string }[] }>({ featured: [], all: [] });
  const [inputKey, setInputKey] = useState(0);

  useEffect(() => {
    fetch(`${GATEWAY}/models`)
      .then((response) => response.json())
      .then((payload) => setCatalog({ featured: payload.featured, all: payload.models }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    let live = true;
    const timer = setInterval(async () => {
      try {
        const rows = await rpc<MessageRow[]>(backend, 'listMessages', { conversationId });
        if (live) { setMessages(rows); setError(null); }
      } catch (cause) {
        if (live) setError(String((cause as Error).message ?? cause));
      }
    }, 700);
    return () => { live = false; clearInterval(timer); };
  }, [backend, conversationId]);

  const send = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setInputKey((at) => at + 1); // remount input to clear it
    try {
      let target = conversationId;
      if (!target) {
        target = await rpc<string>(backend, 'createConversation', { model, title: conversationTitle(trimmed) });
        setConversationId(target);
      }
      await rpc<string>(backend, 'sendMessage', { conversationId: target, content: trimmed });
      setError(null);
    } catch (cause) {
      setError(String((cause as Error).message ?? cause));
    }
  }, [backend, conversationId, model]);

  const newChat = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setError(null);
  }, []);

  const autoFired = useRef(false);
  useEffect(() => {
    if (!AUTODEMO || autoFired.current) return;
    autoFired.current = true;
    const timer = setTimeout(() => void send(`Reply with one short sentence praising the ${backend} backend.`), 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!AUTODEMO) return;
    const assistant = messages.find((row) => row.role === 'assistant');
    if (assistant?.status === 'complete') {
      transcript = messages;
      const timer = setTimeout(() => process.exit(0), 1200);
      return () => clearTimeout(timer);
    }
  }, [messages]);

  const pickerRows = useMemo(() => {
    if (!picker) return [] as string[];
    const needle = picker.query.trim().toLowerCase();
    if (!needle) {
      return [
        ...catalog.featured,
        ...catalog.all.map((entry) => entry.id).filter((id) => !catalog.featured.includes(id)),
      ];
    }
    return catalog.all.map((entry) => entry.id).filter((id) => id.toLowerCase().includes(needle));
  }, [picker, catalog]);

  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c') process.exit(0);
    if (picker) {
      if (key.name === 'escape') setPicker(null);
      else if (key.name === 'up') setPicker({ ...picker, at: Math.max(0, picker.at - 1) });
      else if (key.name === 'down') setPicker({ ...picker, at: Math.min(pickerRows.length - 1, picker.at + 1) });
      else if (key.name === 'return') {
        const chosen = pickerRows[picker.at];
        if (chosen) { setModel(chosen); newChat(); }
        setPicker(null);
      } else if (key.name === 'backspace') setPicker({ ...picker, query: picker.query.slice(0, -1), at: 0 });
      else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setPicker({ ...picker, query: picker.query + key.sequence, at: 0 });
      }
      return;
    }
    if (key.name === 'tab') {
      setBackend((current) => BACKENDS[(BACKENDS.indexOf(current) + 1) % BACKENDS.length]);
      newChat();
    }
    if (key.ctrl && key.name === 'p') setPicker({ query: '', at: 0 });
    if (key.ctrl && key.name === 'n') newChat();
  });

  const visible = messages.slice(-10);
  return (
    <box style={{ padding: 1, flexDirection: 'column' }}>
      <box style={{ flexDirection: 'row' }}>
        {BACKENDS.map((candidate) => (
          <text key={candidate} style={{ marginRight: 1 }}>
            {candidate === backend ? (
              <span style={{ backgroundColor: 'white', fg: 'black' }}> {candidate} </span>
            ) : (
              <span style={{ fg: 'gray' }}> {candidate} </span>
            )}
          </text>
        ))}
      </box>
      <box style={{ flexDirection: 'row' }}>
        <text style={{ fg: 'cyan', marginRight: 2 }}>{model}</text>
        <text style={{ fg: 'gray' }}>built with OpenTUI</text>
      </box>
      <box style={{ border: true, flexDirection: 'column', minHeight: 10, padding: 1, marginTop: 1 }} title="conversation">
        {visible.length === 0 ? (
          <text style={{ fg: 'gray' }}>Chat via {backend} — say something to start.</text>
        ) : (
          visible.map((message) => (
            <text key={message._id} style={{ wrap: true }}>
              <span style={{ fg: message.role === 'user' ? 'blue' : 'green' }}>
                <b>{message.role === 'user' ? 'you ' : 'ai  '}</b>
              </span>
              {message.content.length === 0 ? '…' : message.content}
              {message.status === 'streaming' ? ' ▍' : ''}
            </text>
          ))
        )}
      </box>
      {error ? <text style={{ fg: 'red' }}>{error}</text> : null}
      {picker ? (
        <box style={{ border: true, flexDirection: 'column', padding: 1 }} title="choose model (Esc closes)">
          <text>search: {picker.query}▍</text>
          {pickerRows.slice(Math.max(0, picker.at - 4), Math.max(0, picker.at - 4) + 8).map((id) => (
            <text key={id}>
              {id === pickerRows[picker.at] ? (
                <span style={{ backgroundColor: 'blue', fg: 'white' }}>{catalog.featured.includes(id) ? '★ ' : '  '}{id}</span>
              ) : (
                <span>{catalog.featured.includes(id) ? '★ ' : '  '}{id}</span>
              )}
            </text>
          ))}
        </box>
      ) : (
        <box style={{ border: true, height: 3 }} title="message">
          <input key={inputKey} placeholder="Message…" focused onSubmit={(value: string) => void send(value)} />
        </box>
      )}
      <text style={{ fg: 'gray' }}>Enter send · Tab backend · Ctrl-P model · Ctrl-N new chat · Ctrl-C quit</text>
    </box>
  );
}

const renderer = await createCliRenderer({ exitOnCtrlC: true });
createRoot(renderer).render(<App />);

process.on('exit', () => {
  if (AUTODEMO) {
    for (const message of transcript) {
      console.log(`${message.role} ${message.status} | ${message.content}`);
    }
  }
});

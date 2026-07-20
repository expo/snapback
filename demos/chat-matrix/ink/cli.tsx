// chat-matrix Ink cell: React for the terminal, same product as every other
// authoring stack, over the gateway's portable /rpc surface.
//
//   bun run cli.tsx [--backend sqlite] [--autodemo] [--gateway http://...]
//
// Keys: Enter send · Tab backend · Ctrl-P model picker · Ctrl-N new chat · Ctrl-C quit
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';

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

function App() {
  const { exit } = useApp();
  const [backend, setBackend] = useState<Backend>(INITIAL_BACKEND);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ query: string; at: number } | null>(null);
  const [catalog, setCatalog] = useState<{ featured: string[]; all: { id: string }[] }>({ featured: [], all: [] });

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
    setDraft('');
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

  // Autodemo: scripted send, exit once the reply completes (so tmux/CI runs
  // are deterministic); the transcript prints from the exit handler below.
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
      const timer = setTimeout(() => exit(), 1200);
      return () => clearTimeout(timer);
    }
  }, [messages, exit]);

  const pickerRows = useMemo(() => {
    if (!picker) return [];
    const needle = picker.query.trim().toLowerCase();
    if (!needle) {
      return [
        ...catalog.featured,
        ...catalog.all.map((entry) => entry.id).filter((id) => !catalog.featured.includes(id)),
      ];
    }
    return catalog.all.map((entry) => entry.id).filter((id) => id.toLowerCase().includes(needle));
  }, [picker, catalog]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') exit();
    if (picker) {
      if (key.escape) setPicker(null);
      else if (key.upArrow) setPicker({ ...picker, at: Math.max(0, picker.at - 1) });
      else if (key.downArrow) setPicker({ ...picker, at: Math.min(pickerRows.length - 1, picker.at + 1) });
      else if (key.return) {
        const chosen = pickerRows[picker.at];
        if (chosen) { setModel(chosen); newChat(); }
        setPicker(null);
      } else if (key.backspace || key.delete) setPicker({ ...picker, query: picker.query.slice(0, -1), at: 0 });
      else if (input && !key.ctrl && !key.meta) setPicker({ ...picker, query: picker.query + input, at: 0 });
      return;
    }
    if (key.tab) {
      const next = BACKENDS[(BACKENDS.indexOf(backend) + 1) % BACKENDS.length];
      setBackend(next);
      newChat();
    }
    if (key.ctrl && input === 'p') setPicker({ query: '', at: 0 });
    if (key.ctrl && input === 'n') newChat();
  });

  const visible = messages.slice(-12);
  return (
    <Box flexDirection="column" padding={1}>
      <Box gap={1}>
        {BACKENDS.map((candidate) => (
          <Text key={candidate} inverse={candidate === backend} dimColor={candidate !== backend}>
            {` ${candidate} `}
          </Text>
        ))}
      </Box>
      <Box gap={2}>
        <Text color="cyan">{model}</Text>
        <Text dimColor>built with Ink</Text>
      </Box>
      <Box flexDirection="column" borderStyle="round" paddingX={1} minHeight={10} marginTop={1}>
        {visible.length === 0 ? (
          <Text dimColor>Chat via {backend} — say something to start.</Text>
        ) : (
          visible.map((message) => (
            <Box key={message._id} flexDirection="row" gap={1}>
              <Text bold color={message.role === 'user' ? 'blue' : 'green'}>
                {message.role === 'user' ? 'you' : 'ai '}
              </Text>
              <Text wrap="wrap">
                {message.content.length === 0 ? '…' : message.content}
                {message.status === 'streaming' ? ' ▍' : ''}
              </Text>
            </Box>
          ))
        )}
      </Box>
      {error ? <Text color="red">{error}</Text> : null}
      {picker ? (
        <Box flexDirection="column" borderStyle="double" paddingX={1}>
          <Text>choose model — search: {picker.query}▍ (Esc closes)</Text>
          {pickerRows.slice(Math.max(0, picker.at - 4), Math.max(0, picker.at - 4) + 9).map((id) => (
            <Text key={id} inverse={id === pickerRows[picker.at]}>
              {catalog.featured.includes(id) ? '★ ' : '  '}{id}
            </Text>
          ))}
        </Box>
      ) : (
        <Box borderStyle="round" paddingX={1}>
          <Text color="blue">▶ </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={(value) => void send(value)} placeholder="Message…" />
        </Box>
      )}
      <Text dimColor>Enter send · Tab backend · Ctrl-P model · Ctrl-N new chat · Ctrl-C quit</Text>
    </Box>
  );
}

let transcript: MessageRow[] = [];
const instance = render(<App />);
await instance.waitUntilExit();
if (AUTODEMO) {
  for (const message of transcript) {
    console.log(`${message.role} ${message.status} | ${message.content}`);
  }
}

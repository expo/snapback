// React DOM baseline for the chat matrix: plain fetch + poll against the
// gateway's /rpc surface, no framework client. This is the reference point the
// Expo/Exact/Flutter/SwiftUI cells are compared against.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  BACKENDS,
  conversationTitle,
  type Backend,
  type MessageRow,
} from '../../shared/model';

const params = new URLSearchParams(window.location.search);
const GATEWAY = params.get('gateway') ?? 'http://127.0.0.1:4470';
const AUTODEMO = params.get('autodemo') === '1';
const INITIAL_BACKEND: Backend = (BACKENDS as readonly string[]).includes(params.get('backend') ?? '')
  ? (params.get('backend') as Backend)
  : 'sqlite';
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';

async function rpc<T>(backend: Backend, op: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${GATEWAY}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ backend, op, args }),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error ?? `${backend}.${op} failed`);
  return payload.value as T;
}

export function App() {
  const [backend, setBackend] = useState<Backend>(INITIAL_BACKEND);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) return;
    let live = true;
    const tick = async () => {
      try {
        const rows = await rpc<MessageRow[]>(backend, 'listMessages', { conversationId });
        if (live) { setMessages(rows); setError(null); }
      } catch (cause) {
        if (live) setError(String((cause as Error).message ?? cause));
      }
    };
    void tick();
    const timer = setInterval(tick, 700);
    return () => { live = false; clearInterval(timer); };
  }, [backend, conversationId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setDraft('');
    try {
      let target = conversationId;
      if (!target) {
        target = await rpc<string>(backend, 'createConversation', {
          model,
          title: conversationTitle(trimmed),
        });
        setConversationId(target);
      }
      await rpc<string>(backend, 'sendMessage', { conversationId: target, content: trimmed });
      setError(null);
    } catch (cause) {
      setError(String((cause as Error).message ?? cause));
      setDraft(trimmed);
    } finally {
      setSending(false);
    }
  }, [backend, conversationId, model, sending]);

  const autoDemoFired = useRef(false);
  useEffect(() => {
    if (!AUTODEMO || autoDemoFired.current) return;
    autoDemoFired.current = true;
    const timer = setTimeout(() => {
      void send(`Reply with one short sentence praising the ${backend} backend.`);
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newChat = () => { setConversationId(null); setMessages([]); setError(null); };
  const switchBackend = (next: Backend) => { setBackend(next); newChat(); };

  return (
    <div style={styles.root} data-testid="chat-root">
      <header style={styles.header}>
        <div style={styles.chipRow}>
          {BACKENDS.map((candidate) => (
            <button
              key={candidate}
              data-testid={`backend-${candidate}`}
              onClick={() => switchBackend(candidate)}
              style={{ ...styles.chip, ...(backend === candidate ? styles.chipActive : null) }}
            >
              {candidate}
            </button>
          ))}
        </div>
        <div style={styles.modelRow}>
          <button data-testid="model-button" style={styles.modelButton} onClick={() => setPickerOpen(true)}>
            {model}
          </button>
          <span style={styles.badge} data-testid="stack-badge">built with React (web baseline)</span>
          <button data-testid="new-chat" style={styles.newChat} onClick={newChat}>＋ New</button>
        </div>
      </header>
      <div ref={listRef} style={styles.list} data-testid="thread">
        {messages.length === 0 ? (
          <div style={styles.empty}>
            <strong>{conversationId ? 'No messages yet' : `Chat via ${backend}`}</strong>
            <span style={{ color: '#8a8a92', fontSize: 13 }}>
              Model: {model} — say something to start the conversation.
            </span>
          </div>
        ) : (
          messages.map((message) => <Bubble key={message._id} message={message} />)
        )}
        {error ? <div style={{ color: '#b3261e', fontSize: 12 }}>{error}</div> : null}
      </div>
      <Composer draft={draft} onDraft={setDraft} onSend={() => void send(draft)} sending={sending} />
      {pickerOpen ? (
        <ModelPicker
          current={model}
          onClose={() => setPickerOpen(false)}
          onSelect={(next) => { setModel(next); setPickerOpen(false); newChat(); }}
        />
      ) : null}
    </div>
  );
}

function Bubble({ message }: { message: MessageRow }) {
  const isUser = message.role === 'user';
  const busy = message.status === 'pending' || message.status === 'streaming';
  return (
    <div
      data-testid={`message-${message._id}`}
      style={{
        ...styles.bubble,
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        background: message.status === 'error' ? '#fdecec' : isUser ? '#3478f6' : '#fff',
        color: isUser ? '#fff' : '#1f1f24',
      }}
    >
      {message.content.length === 0 && busy
        ? '…'
        : message.content + (message.status === 'streaming' ? ' ▍' : '')}
    </div>
  );
}

function Composer(props: { draft: string; onDraft: (v: string) => void; onSend: () => void; sending: boolean }) {
  const canSend = props.draft.trim().length > 0 && !props.sending;
  return (
    <div style={styles.composer}>
      <textarea
        data-testid="composer-input"
        style={styles.input}
        rows={1}
        value={props.draft}
        placeholder="Message…"
        onChange={(event) => props.onDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            props.onSend();
          }
        }}
      />
      <button data-testid="send" style={{ ...styles.send, opacity: canSend ? 1 : 0.4 }} disabled={!canSend} onClick={props.onSend}>
        ↑
      </button>
    </div>
  );
}

function ModelPicker(props: { current: string; onClose: () => void; onSelect: (model: string) => void }) {
  const [featured, setFeatured] = useState<string[]>([]);
  const [all, setAll] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${GATEWAY}/models`)
      .then((response) => response.json())
      .then((catalog) => { setFeatured(catalog.featured); setAll(catalog.models); })
      .catch((cause) => setLoadError(String(cause)));
  }, []);

  const rows = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return [...featured.map((id) => ({ id, name: id })), ...all.filter((entry) => !featured.includes(entry.id))];
    }
    return all.filter((entry) => entry.id.toLowerCase().includes(trimmed) || entry.name.toLowerCase().includes(trimmed));
  }, [featured, all, query]);

  return (
    <div style={styles.pickerOverlay} onClick={props.onClose}>
      <div style={styles.pickerSheet} onClick={(event) => event.stopPropagation()}>
        <div style={styles.pickerHeader}>
          <strong>Choose a model</strong>
          <button style={styles.newChat} onClick={props.onClose}>Done</button>
        </div>
        <input
          style={styles.pickerSearch}
          value={query}
          placeholder="Search models…"
          onChange={(event) => setQuery(event.target.value)}
        />
        {loadError ? <div style={{ color: '#b3261e', fontSize: 13, padding: '0 16px' }}>Model catalog unavailable: {loadError}</div> : null}
        <div style={styles.pickerList}>
          {rows.map((entry) => (
            <button
              key={entry.id}
              style={{ ...styles.pickerRow, background: entry.id === props.current ? '#e9f0fe' : 'transparent' }}
              onClick={() => props.onSelect(entry.id)}
            >
              <span>{entry.id}</span>
              {featured.includes(entry.id) ? <span style={{ color: '#e8a13a' }}>★</span> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 640, margin: '0 auto' },
  header: { display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 12px 8px' },
  chipRow: { display: 'flex', gap: 6 },
  chip: { border: 'none', borderRadius: 16, padding: '6px 12px', fontSize: 13, background: '#e4e4ea', color: '#4a4a52', cursor: 'pointer' },
  chipActive: { background: '#1f1f24', color: '#fff', fontWeight: 600 },
  modelRow: { display: 'flex', alignItems: 'center', gap: 8 },
  modelButton: { flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: '#fff', border: '1px solid #d9d9e0', borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer' },
  badge: { fontSize: 11, color: '#8a8a92' },
  newChat: { marginLeft: 'auto', border: 'none', background: 'none', color: '#3478f6', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
  list: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 24, textAlign: 'center' },
  bubble: { maxWidth: '84%', borderRadius: 16, padding: '9px 12px', fontSize: 15, lineHeight: '21px', whiteSpace: 'pre-wrap' },
  composer: { display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 12px calc(8px + env(safe-area-inset-bottom))' },
  input: { flex: 1, resize: 'none', minHeight: 40, maxHeight: 120, borderRadius: 20, border: '1px solid #d9d9e0', padding: '10px 14px', fontSize: 15, fontFamily: 'inherit', outline: 'none' },
  send: { width: 40, height: 40, borderRadius: 20, border: 'none', background: '#3478f6', color: '#fff', fontSize: 18, fontWeight: 700, cursor: 'pointer' },
  pickerOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  pickerSheet: { background: '#f4f4f6', borderRadius: '14px 14px 0 0', width: 'min(640px, 100%)', height: '85%', display: 'flex', flexDirection: 'column' },
  pickerHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 8px' },
  pickerSearch: { margin: '0 16px 8px', borderRadius: 10, border: '1px solid #d9d9e0', padding: '9px 12px', fontSize: 15 },
  pickerList: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  pickerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', border: 'none', borderBottom: '1px solid #e2e2e8', background: 'transparent', fontSize: 14, cursor: 'pointer', textAlign: 'left' },
};

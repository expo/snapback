// LLP 0137 A2 sweep — neutral shell with the chat (A2) view wired to a live
// Snapback backend via the first-party React arm. The other five contract
// views remain the frozen static shell.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  skip,
  useSnapbackConnection,
  useSnapbackMutation,
  useSnapbackPresence,
  useSnapbackQueries,
  useSnapbackQuery,
} from '@expo/snapback-react';
import api from '../snapback/generated/api.mjs';

// Structural twin of the generated branded id (api.d.ts `Id<'channels'>`);
// the api.mjs module maps its types through the generated package exports,
// which relative-file imports do not traverse.
type ChannelId = string & { readonly __snapbackIdTable: 'channels' };

const contracts = ["notebook", "chat", "board", "event", "research", "ops"] as const;
type ContractName = (typeof contracts)[number];

function Shell({
  contract,
  title,
  eyebrow,
  children,
  onNavigate,
  identity,
}: {
  contract: ContractName;
  title: string;
  eyebrow: string;
  children: ReactNode;
  onNavigate: (contract: ContractName) => void;
  identity: string;
}) {
  const connection = useSnapbackConnection();
  const live = connection.status === 'live';
  const fresh = live || connection.status === 'polling';
  return (
    <div className="app-frame" data-testid={`${contract}-shell`}>
      <aside className="rail" aria-label="Sweep applications">
        <div className="mark" aria-hidden="true">SB</div>
        {contracts.map((name) => (
          <button
            className={name === contract ? "rail-button active" : "rail-button"}
            data-testid={`navigate-${name}`}
            key={name}
            onClick={() => onNavigate(name)}
            type="button"
          >
            {name}
          </button>
        ))}
      </aside>
      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
          </div>
          <div className="status-row">
            <span className="status" data-testid="connection-state">
              {live ? 'Online' : connection.status}
            </span>
            <span className="status stale" data-testid="freshness-state">
              {fresh ? 'Fresh' : 'Stale'}
            </span>
            <button className="avatar" aria-label="Open account menu" data-testid="account-menu">
              {identity.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function Chat({ displayName }: { displayName: string }) {
  const channels = useSnapbackQueries({
    publicChannels: { ref: api.listPublicChannels, args: {} },
    myPrivate: { ref: api.listMyPrivateChannels, args: {} },
  });
  const publicRows =
    channels.queries.publicChannels.status === 'ready'
      || channels.queries.publicChannels.status === 'refreshing'
      ? channels.queries.publicChannels.data
      : [];
  const privateRows =
    channels.queries.myPrivate.status === 'ready'
      || channels.queries.myPrivate.status === 'refreshing'
      ? channels.queries.myPrivate.data
      : [];

  const [selectedId, setSelectedId] = useState<ChannelId | null>(null);
  const generalId = publicRows.find((row) => row.name === 'general')?._id ?? null;
  const channelId = selectedId ?? generalId;
  const publicSelected = publicRows.find((row) => row._id === channelId);
  const selectedName = publicSelected?.name
    ?? privateRows.find((row) => row.channelId === channelId)?.name
    ?? '…';
  const selectedVisibility = publicSelected ? 'public' : 'private';

  const messagesQuery = useSnapbackQuery(
    api.listMessages,
    channelId ? { channelId } : skip,
  );
  const unreadQuery = useSnapbackQuery(
    api.unreadCount,
    channelId ? { channelId } : skip,
  );
  const messages =
    messagesQuery.status === 'ready' || messagesQuery.status === 'refreshing'
      ? messagesQuery.data
      : [];
  const unread =
    unreadQuery.status === 'ready' || unreadQuery.status === 'refreshing'
      ? unreadQuery.data[0]?.unread ?? 0
      : 0;

  const sendMessage = useSnapbackMutation(api.sendMessage);
  const markRead = useSnapbackMutation(api.markChannelRead);
  const createPrivateChannel = useSnapbackMutation(api.createPrivateChannel);

  // presence: managed value while the view is mounted on this channel
  const presence = useSnapbackPresence(api.ephemeral.chatPresence, {
    scope: { channelId: channelId ?? 'lobby' },
    value: { name: displayName },
    ttlMs: 8_000,
  });
  const online = new Map<string, true>();
  if (presence.status === 'ready' || presence.status === 'stale') {
    for (const entry of presence.entries) online.set(entry.value.name, true);
  }

  // typing: managed value only while recent keystrokes exist
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingState = useSnapbackPresence(api.ephemeral.chatTyping, {
    scope: { channelId: channelId ?? 'lobby' },
    value: typing ? { name: displayName } : skip,
    ttlMs: 2_000,
  });
  const typers = (typingState.status === 'ready' || typingState.status === 'stale')
    ? typingState.entries
        .filter((entry) => entry.key !== typingState.selfKey)
        .map((entry) => entry.value.name)
    : [];

  // mark the channel read when opened and when new messages arrive while open
  const lastMarked = useRef<string>('');
  const headVersion = messages.length > 0 ? String(messages[messages.length - 1]?._version ?? 0) : '0';
  useEffect(() => {
    if (!channelId || messagesQuery.status !== 'ready') return;
    const key = `${channelId}:${headVersion}`;
    if (lastMarked.current === key) return;
    lastMarked.current = key;
    void markRead({ channelId }).catch(() => undefined);
  }, [channelId, messagesQuery.status, headVersion, markRead]);

  const submit = () => {
    const body = draft.trim();
    if (!body || !channelId) return;
    setDraft('');
    setTyping(false);
    void sendMessage({
      channelId,
      body,
      clientKey: crypto.randomUUID(),
      authorName: displayName,
    }).catch((error: unknown) => {
      console.error('send failed', error);
    });
  };

  return (
    <section className="workspace chat-grid" aria-label="Group chat">
      <nav className="panel list-nav" aria-label="Channels">
        <button
          className="primary"
          data-testid="chat-new-channel"
          onClick={() => {
            const name = window.prompt('Private channel name');
            if (name) void createPrivateChannel({ name }).then((id) => setSelectedId(id));
          }}
        >
          + Channel
        </button>
        <p className="section-label">Public</p>
        {publicRows.map((row) => (
          <button
            className={row._id === channelId ? 'nav-row selected' : 'nav-row'}
            key={row._id}
            onClick={() => setSelectedId(row._id)}
          >
            # {row.name}
          </button>
        ))}
        <p className="section-label">Private</p>
        {privateRows.map((row) => (
          <button
            className={row.channelId === channelId ? 'nav-row selected' : 'nav-row'}
            key={row.channelId}
            onClick={() => setSelectedId(row.channelId)}
          >
            🔒 {row.name}{row.status === 'invited' ? ' (invited)' : ''}
          </button>
        ))}
      </nav>
      <div className="panel content-panel chat-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{selectedVisibility === 'private' ? 'Private channel' : 'Public channel'}</p>
            <h2># {selectedName}</h2>
          </div>
          <span data-testid="chat-unread">{unread} unread</span>
        </div>
        <div className="messages" data-testid="chat-message-list">
          {messages.map((message) => (
            <article key={message._id}>
              <div className="mini-avatar">
                {(message.authorName || message.authorId).slice(0, 1).toUpperCase()}
              </div>
              <p>
                <strong>
                  {message.authorName || `${message.authorId.slice(0, 8)}…`}{' '}
                  <time>{new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                </strong>
                {message.body}
              </p>
            </article>
          ))}
          {typers.length > 0 && (
            <div className="typing" data-testid="chat-typing">
              {typers.join(', ')} {typers.length === 1 ? 'is' : 'are'} typing…
            </div>
          )}
        </div>
        <label className="composer">
          Message #{selectedName}
          <input
            data-testid="chat-composer"
            placeholder="Write a message…"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setTyping(true);
              if (typingTimer.current) clearTimeout(typingTimer.current);
              typingTimer.current = setTimeout(() => setTyping(false), 1_500);
            }}
            onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
          />
        </label>
      </div>
      <aside className="panel member-panel" aria-label="Channel members">
        <p className="section-label">Online — {online.size}</p>
        <span data-testid="chat-presence">
          {[...online.keys()].map((name) => `● ${name}`).join(' ') || '○ nobody here'}
        </span>
      </aside>
    </section>
  );
}

function StaticView({ label }: { label: string }) {
  return (
    <section className="workspace two-column" aria-label={label}>
      <div className="panel content-panel">
        <p className="eyebrow">Static shell — not part of the A2 arm</p>
      </div>
    </section>
  );
}

export function App({ displayName }: { displayName: string }) {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("contract");
  const initial = contracts.includes(requested as ContractName) ? requested as ContractName : "chat";
  const [contract, setContract] = useState<ContractName>(initial);
  const titles: Record<ContractName, [string, string]> = {
    notebook: ["Offline field notebook", "A1"],
    chat: ["Group chat and presence", "A2"],
    board: ["Issue and planning board", "A3"],
    event: ["Event and invitation", "A4"],
    research: ["Collaborative AI research room", "A5"],
    ops: ["Operations and workflow ledger", "A6"],
  };
  const navigate = (next: ContractName) => {
    setContract(next);
    window.history.replaceState(null, "", `?contract=${next}`);
  };
  return (
    <Shell
      contract={contract}
      title={titles[contract][0]}
      eyebrow={titles[contract][1]}
      onNavigate={navigate}
      identity={displayName}
    >
      {contract === "notebook" && <StaticView label="Field notebook" />}
      {contract === "chat" && <Chat displayName={displayName} />}
      {contract === "board" && <StaticView label="Issue board" />}
      {contract === "event" && <StaticView label="Event application" />}
      {contract === "research" && <StaticView label="Research room" />}
      {contract === "ops" && <StaticView label="Operations ledger" />}
    </Shell>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';

import { useSnapbackQuery } from '../../../../../../../packages/snapback-react/index.mjs';
import api from '../snapback/generated/api.mjs';
import {
  snapbackProvider,
  type Persona,
} from './provider';

type Channel = {
  _id: string;
  slug: string;
  name: string;
  visibility: 'public' | 'private';
};

type Message = {
  _id: string;
  sequence: number;
  authorId: string;
  authorName: string;
  body: string;
  sentAt: number;
};

type Marker = {
  channelId: string;
  lastReadSequence: number;
};

export function App({ personas }: { personas: Persona[] }) {
  const [personaId, setPersonaId] = useState<Persona['id']>('alice');
  const persona = personas.find((item) => item.id === personaId) ?? personas[0];
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [presenceNames, setPresenceNames] = useState<string[]>([]);
  const activityRef = useRef<{ typing(active: boolean): Promise<unknown>; dispose(): Promise<void> } | null>(null);

  const channels = useSnapbackQuery<Channel>({
    provider: snapbackProvider,
    query: api.listChannels as any,
    args: {},
    userId: persona.id,
    authority: persona.id,
  });
  const selected = channels.rows.find((row: Channel) => row._id === selectedChannelId)
    ?? channels.rows[0];
  const messages = useSnapbackQuery<Message>({
    provider: snapbackProvider,
    query: api.listMessages as any,
    args: { channelId: selected?._id ?? 'pending-channel' },
    userId: persona.id,
    authority: `${persona.id}:${selected?._id ?? 'pending'}`,
    enabled: Boolean(selected?._id),
  } as any);
  const markers = useSnapbackQuery<Marker>({
    provider: snapbackProvider,
    query: api.listReadMarkers as any,
    args: {},
    userId: persona.id,
    authority: persona.id,
  });

  const visibleMessages = useMemo(
    () => [...messages.rows]
      .sort((a: Message, b: Message) => b.sequence - a.sequence)
      .slice(0, 25)
      .reverse(),
    [messages.rows],
  );
  const latestSequence = messages.rows.reduce(
    (maximum: number, row: Message) => Math.max(maximum, row.sequence),
    0,
  );
  const marker = markers.rows.find((row: Marker) => row.channelId === selected?._id);
  const unread = Math.max(0, latestSequence - (marker?.lastReadSequence ?? 0));

  useEffect(() => {
    let disposed = false;
    setTypingNames([]);
    setPresenceNames([]);
    void activityRef.current?.dispose();
    activityRef.current = null;
    if (!selected || selected.visibility !== 'public') return () => {};
    void snapbackProvider.subscribeActivity(
      persona.id,
      selected._id,
      (typing, presence) => {
        if (disposed) return;
        setTypingNames(typing.filter((entry) => entry.value.active).map((entry) => entry.value.name));
        setPresenceNames(presence.map((entry) => entry.value.name));
      },
    ).then((activity) => {
      if (disposed) void activity.dispose();
      else activityRef.current = activity;
    });
    return () => {
      disposed = true;
      const activity = activityRef.current;
      activityRef.current = null;
      if (activity) void activity.dispose();
    };
  }, [persona.id, selected?._id, selected?.visibility]);

  const mutate = async (name: string, args: Record<string, unknown>) => {
    setBusy(true);
    try {
      return await snapbackProvider.mutate(name, args, persona.id);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !selected) return;
    await mutate('sendMessage', { channelId: selected._id, body });
    setDraft('');
    await activityRef.current?.typing(false);
  };

  const connection = messages.connection ?? channels.connection;
  const error = messages.error ?? channels.error;

  return (
    <div className="app-frame" data-testid="chat-shell">
      <aside className="rail" aria-label="Bakeoff applications">
        <div className="mark" aria-hidden="true">SB</div>
        <button className="rail-button active" type="button">chat</button>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Calibration app · Snapback</p>
            <h1>Realtime group chat</h1>
          </div>
          <div className="status-row">
            <span className={`status ${connection}`} data-testid="connection-state">
              {connection}
            </span>
            <label>
              Persona
              <select
                data-testid="persona-switcher"
                value={persona.id}
                onChange={(event) => {
                  setPersonaId(event.target.value as Persona['id']);
                  setSelectedChannelId('');
                }}
              >
                {personas.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          </div>
        </header>
        <section className="workspace chat-grid" aria-label="Group chat">
          <nav className="panel list-nav" aria-label="Channels">
            <p className="section-label">Channels</p>
            {channels.rows.map((room: Channel) => (
              <button
                className={room._id === selected?._id ? 'nav-row selected' : 'nav-row'}
                key={room._id}
                onClick={() => setSelectedChannelId(room._id)}
                type="button"
              >
                {room.visibility === 'private' ? '🔒' : '#'} {room.name}
              </button>
            ))}
          </nav>
          <div className="panel content-panel chat-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{selected?.visibility ?? 'channel'} · {persona.name}</p>
                <h2>{selected ? `# ${selected.name}` : 'Loading channels…'}</h2>
              </div>
              <div className="channel-facts">
                <span data-testid="chat-unread">{unread} unread</span>
                <span data-testid="chat-presence">{presenceNames.length} online</span>
                <button
                  disabled={!selected || unread === 0}
                  onClick={() => selected && mutate('markRead', {
                    channelId: selected._id,
                    sequence: latestSequence,
                  })}
                  type="button"
                >
                  Mark read
                </button>
              </div>
            </div>
            {error
              ? <div className="error" data-testid="chat-access-denied">{String((error as any)?.diagnostic?.code ?? error)}</div>
              : (
                <div className="messages" data-testid="chat-message-list">
                  {visibleMessages.map((message: Message) => (
                    <article key={message._id} data-testid={`chat-message-${message._id}`}>
                      <div className={message.authorName === 'Alice' ? 'mini-avatar' : 'mini-avatar blue'}>
                        {message.authorName[0]}
                      </div>
                      <p>
                        <strong>{message.authorName} <time>#{message.sequence}</time></strong>
                        {message.body}
                      </p>
                    </article>
                  ))}
                  <div className="typing" data-testid="chat-typing">
                    {typingNames.length > 0
                      ? `${typingNames.join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing…`
                      : selected?.visibility === 'private'
                        ? 'Private transient room authorization is not claimed by this arm.'
                        : 'Native ephemeral typing ready'}
                  </div>
                </div>
              )}
            <label className="composer">
              Message {selected ? `#${selected.slug}` : ''}
              <input
                data-testid="chat-composer"
                disabled={!selected || busy}
                onChange={(event) => {
                  setDraft(event.target.value);
                  void activityRef.current?.typing(Boolean(event.target.value.trim()));
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void send();
                }}
                placeholder="Write a message…"
                value={draft}
              />
            </label>
          </div>
          <aside className="panel member-panel" aria-label="Channel members">
            <p className="section-label">Native presence</p>
            {presenceNames.map((name) => <span key={name}>● {name}</span>)}
            {presenceNames.length === 0 && <span className="muted">No active public-room leases</span>}
            <p className="section-label">History</p>
            <span>25-message page</span>
            <span className="muted">Server sequence ordering</span>
          </aside>
        </section>
      </main>
    </div>
  );
}

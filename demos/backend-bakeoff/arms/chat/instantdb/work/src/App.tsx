import { FormEvent, useMemo, useState } from 'react';
import { id, init } from '@instantdb/react';
import schema from '../instant.schema';

const appId = import.meta.env.VITE_INSTANT_APP_ID;
if (!appId) throw new Error('VITE_INSTANT_APP_ID is required');
const db = init({ appId, schema });

function Chat() {
  const { user } = db.useAuth();
  const { data, isLoading, error } = db.useQuery(
    user
      ? {
          channels: {
            $: { order: { serverCreatedAt: 'asc' } },
          },
          messages: {
            $: {
              first: 25,
              order: { serverCreatedAt: 'desc' },
            },
            channel: {},
          },
        }
      : null,
  );
  const channels = data?.channels ?? [];
  const [selectedId, setSelectedId] = useState<string>();
  const selected = channels.find((channel) => channel.id === selectedId) ??
    channels[0];
  const room = db.room('channel', selected?.id ?? 'waiting');
  db.rooms.useSyncPresence(
    room,
    user
      ? {
          actorId: user.id,
          displayName: 'Guest',
          state: 'online',
        }
      : {},
    [user?.id],
  );
  const { peers } = db.rooms.usePresence(room);
  const typing = db.rooms.useTypingIndicator(room, 'chat-composer');
  const [body, setBody] = useState('');
  const messages = useMemo(
    () =>
      [...(data?.messages ?? [])]
        .filter((message) => message.channel?.id === selected?.id)
        .reverse(),
    [data?.messages, selected?.id],
  );

  if (!user) {
    return (
      <main className="signin" data-testid="chat-shell">
        <p className="eyebrow">InstantDB native guest auth</p>
        <h1>Realtime group chat</h1>
        <button
          className="primary"
          data-testid="chat-sign-in"
          onClick={() => db.auth.signInAsGuest()}
        >
          Enter as guest
        </button>
      </main>
    );
  }
  if (error) return <main>Query error: {error.message}</main>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || !body.trim()) return;
    const messageId = id();
    await db.transact(
      db.tx.messages[messageId]
        .update({
          authorId: user!.id,
          body: body.trim(),
          clientNonce: crypto.randomUUID(),
          clientSentAt: new Date(),
        })
        .link({ channel: selected.id }),
    );
    setBody('');
    typing.setActive(false);
  }

  return (
    <div className="frame" data-testid="chat-shell">
      <aside className="rail">
        <div className="mark">SB</div>
        <strong>Chat</strong>
        <span>InstantDB arm</span>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">Calibration app</p>
            <h1>Realtime group chat</h1>
          </div>
          <span data-testid="connection-state">{isLoading ? 'Syncing' : 'Online'}</span>
        </header>
        <section className="workspace">
          <nav className="panel channels" aria-label="Channels">
            <p className="eyebrow">Channels</p>
            {channels.map((channel) => (
              <button
                className={channel.id === selected?.id ? 'selected' : ''}
                key={channel.id}
                onClick={() => setSelectedId(channel.id)}
              >
                {channel.visibility === 'private' ? '🔒' : '#'} {channel.name}
              </button>
            ))}
          </nav>
          <div className="panel conversation">
            <div className="heading">
              <div>
                <p className="eyebrow">{selected?.visibility ?? 'Channel'}</p>
                <h2># {selected?.name ?? 'loading'}</h2>
              </div>
              <span>{Object.keys(peers).length + 1} online</span>
            </div>
            <div className="messages" data-testid="chat-message-list">
              {messages.map((message) => (
                <article key={message.id}>
                  <div className="avatar">•</div>
                  <p>
                    <strong>{message.authorId === user.id ? 'You' : 'Member'}</strong>
                    {message.body}
                  </p>
                </article>
              ))}
              {typing.active?.length ? (
                <div className="typing" data-testid="chat-typing">
                  Someone is typing…
                </div>
              ) : null}
            </div>
            <form className="composer" onSubmit={submit}>
              <label htmlFor="message">Message #{selected?.name}</label>
              <input
                {...typing.inputProps}
                data-testid="chat-composer"
                id="message"
                onChange={(event) => {
                  typing.setActive(event.target.value.length > 0);
                  setBody(event.target.value);
                }}
                placeholder="Write a message…"
                value={body}
              />
            </form>
          </div>
          <aside className="panel members">
            <p className="eyebrow">Online</p>
            <span>● You</span>
            {Object.values(peers).map((peer, index) => (
              <span key={index}>● {peer.displayName ?? 'Guest'}</span>
            ))}
          </aside>
        </section>
      </main>
    </div>
  );
}

export function App() {
  return <Chat />;
}

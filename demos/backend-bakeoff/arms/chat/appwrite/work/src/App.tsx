import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Channel,
  ID,
  Permission,
  Query,
  Role,
  type Models,
  type RealtimeSubscription,
} from "appwrite";
import {
  account,
  channelsTableId,
  databaseId,
  presences,
  privateMessagesTableId,
  privateTeamId,
  publicMessagesTableId,
  realtime,
  tables,
  unreadTableId,
} from "./appwrite";
import "./App.css";

type ChannelRow = Models.Row & {
  name: string;
  visibility: "public" | "private";
  ordinal: number;
};
type MessageRow = Models.Row & {
  channel_id: string;
  body: string;
  author_label: string;
  seed_ordinal?: number;
};
type UnreadRow = Models.Row & {
  channel_id: string;
  last_seen_message_id: string;
  revision: number;
};

function authoritativeAuthor(message: MessageRow) {
  const actor = message.$permissions
    .map((permission) => permission.match(/^update\("user:([^"]+)"\)$/)?.[1])
    .find(Boolean);
  if (actor === "alice") return "Alice";
  if (actor === "bob") return "Bob";
  return actor ?? "Unknown actor";
}

function Login({ onLogin }: { onLogin: (user: Models.User<Models.Preferences>) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <main className="login-card">
      <p className="eyebrow">Appwrite Auth</p>
      <h1>Signal Room</h1>
      <form onSubmit={(event) => {
        event.preventDefault();
        setError("");
        void account.createEmailPasswordSession({ email, password })
          .then(async () => {
            await realtime.disconnect();
            onLogin(await account.get());
          })
          .catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : "Sign in failed");
          });
      }}>
        <label>Email<input aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input aria-label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button className="primary" type="submit">Sign in</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}

function Chat({
  user,
  onLogout,
}: {
  user: Models.User<Models.Preferences>;
  onLogout: () => void;
}) {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [selectedId, setSelectedId] = useState("private-alpha");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [unread, setUnread] = useState<UnreadRow[]>([]);
  const [presenceRows, setPresenceRows] = useState<Models.Presence[]>([]);
  const [presenceState, setPresenceState] = useState("probing");
  const [draft, setDraft] = useState("");
  const [lastSentBody, setLastSentBody] = useState("");
  const [ready, setReady] = useState(false);
  const [socketState, setSocketState] = useState("connecting");
  const [error, setError] = useState("");
  const presenceTimer = useRef<number | null>(null);
  const loadSequence = useRef(0);

  const selected = channels.find((channel) => channel.$id === selectedId);
  const selectedVisibility = selected?.visibility;
  const messageTableId =
    selectedVisibility === "private" ? privateMessagesTableId : publicMessagesTableId;

  const loadChannels = useCallback(async () => {
    const [channelResult, unreadResult] = await Promise.all([
      tables.listRows<ChannelRow>({
        databaseId,
        tableId: channelsTableId,
        queries: [Query.orderAsc("ordinal"), Query.limit(10)],
        ttl: 0,
      }),
      tables.listRows<UnreadRow>({
        databaseId,
        tableId: unreadTableId,
        queries: [Query.limit(100)],
        ttl: 0,
      }),
    ]);
    setChannels(channelResult.rows);
    setUnread(unreadResult.rows);
  }, []);

  const loadMessages = useCallback(async () => {
    if (!selectedVisibility) return;
    const sequence = ++loadSequence.current;
    const result = await tables.listRows<MessageRow>({
      databaseId,
      tableId: messageTableId,
      queries: [
        Query.equal("channel_id", [selectedId]),
        Query.orderDesc("$createdAt"),
        Query.limit(25),
      ],
      ttl: 0,
    });
    if (sequence === loadSequence.current) setMessages(result.rows);
  }, [messageTableId, selectedId, selectedVisibility]);

  const refreshPresence = useCallback(async (status = "online") => {
    if (!selectedVisibility) return;
    const expiry = new Date(Date.now() + 10_000).toISOString();
    const permissions =
      selectedVisibility === "private"
        ? [Permission.read(Role.team(privateTeamId))]
        : [Permission.read(Role.users())];
    try {
      await presences.upsert({
        presenceId: `chat-${user.$id}`,
        status,
        permissions,
        expiresAt: expiry,
        metadata: { channelId: selectedId },
      });
      const result = await presences.list({ ttl: 0 });
      setPresenceRows(result.presences);
      setPresenceState("supported");
    } catch {
      setPresenceRows([]);
      setPresenceState("unavailable");
    }
  }, [selectedId, selectedVisibility, user.$id]);

  useEffect(() => {
    setReady(false);
    setError("");
    void loadChannels()
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Channel query failed");
      })
      .finally(() => setReady(true));
  }, [loadChannels, user.$id]);

  useEffect(() => {
    if (!selectedVisibility) return;
    let active = true;
    let subscription: RealtimeSubscription | undefined;
    realtime.onOpen(() => {
      if (active) setSocketState("subscribed");
    });
    realtime.onClose(() => {
      if (active) setSocketState("closed");
    });
    realtime.onError(() => {
      if (active) setSocketState("error");
    });
    const channelsToWatch = [
      Channel.tablesdb(databaseId).table(messageTableId).row(),
      Channel.tablesdb(databaseId).table(unreadTableId).row(),
      Channel.team(privateTeamId),
      Channel.presences(),
    ];
    void Promise.all([
      loadMessages(),
      refreshPresence(),
      realtime.subscribe(channelsToWatch, (event) => {
        if (event.channels.some((channel) => channel.startsWith("presences"))) {
          void presences.list({ ttl: 0 }).then((result) => {
            if (active) setPresenceRows(result.presences);
          });
        } else {
          const reloadChannels = event.channels.some((channel) =>
            channel.startsWith("teams.") || channel.includes(`tables.${unreadTableId}`));
          void Promise.all([
            loadMessages(),
            ...(reloadChannels ? [loadChannels()] : []),
          ]).catch(() => {
            if (active) setMessages([]);
          });
        }
      }).then((value) => {
        subscription = value;
      }),
    ]).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Realtime setup failed");
    });
    presenceTimer.current = window.setInterval(() => {
      void refreshPresence().catch(() => {});
    }, 3_000);
    return () => {
      active = false;
      if (presenceTimer.current !== null) window.clearInterval(presenceTimer.current);
      void subscription?.unsubscribe();
    };
  }, [loadChannels, loadMessages, messageTableId, refreshPresence, selectedVisibility]);

  const visiblePresence = useMemo(
    () => presenceRows.filter((presence) => {
      const metadata = presence.metadata as { channelId?: string } | undefined;
      return metadata?.channelId === selectedId;
    }),
    [presenceRows, selectedId],
  );
  const lastRead = unread.find((marker) => marker.channel_id === selectedId);
  const unreadCount = lastRead
    ? messages.findIndex((message) => message.$id === lastRead.last_seen_message_id)
    : messages.length;

  async function markRead(messageId: string) {
    await tables.upsertRow({
      databaseId,
      tableId: unreadTableId,
      rowId: `${user.$id}-${selectedId}`.slice(0, 36),
      data: {
        channel_id: selectedId,
        last_seen_message_id: messageId,
        revision: (lastRead?.revision ?? 0) + 1,
      },
      permissions: [
        Permission.read(Role.user(user.$id)),
        Permission.update(Role.user(user.$id)),
        Permission.delete(Role.user(user.$id)),
      ],
    });
    await loadChannels();
  }

  async function sendMessage() {
    const body = draft.trim();
    if (!body || !selected) return;
    setDraft("");
    setError("");
    try {
      const readPermission =
        selected.visibility === "private"
          ? Permission.read(Role.team(privateTeamId))
          : Permission.read(Role.users());
      await tables.createRow({
        databaseId,
        tableId: messageTableId,
        rowId: ID.unique(),
        data: {
          channel_id: selected.$id,
          body,
          author_label: user.name || user.email,
        },
        permissions: [
          readPermission,
          Permission.update(Role.user(user.$id)),
          Permission.delete(Role.user(user.$id)),
        ],
      });
      await loadMessages();
      setLastSentBody(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Send failed");
    }
  }

  async function logout() {
    if (presenceTimer.current !== null) window.clearInterval(presenceTimer.current);
    await presences.delete({ presenceId: `chat-${user.$id}` }).catch(() => {});
    await account.deleteSession({ sessionId: "current" });
    await realtime.disconnect();
    onLogout();
  }

  return (
    <main
      className="chat-shell"
      data-ready={ready}
      data-user-id={user.$id}
      data-channel-state={socketState}
      data-message-count={messages.length}
      data-selected-channel={selectedId}
      data-presence-count={visiblePresence.length}
      data-presence-state={presenceState}
      data-unread-count={Math.max(0, unreadCount)}
      data-last-sent={lastSentBody}
    >
      <aside>
        <p className="eyebrow">Realtime group chat</p>
        <h1>Signal Room</h1>
        <p className="signed-in">{user.name || user.email}</p>
        <nav aria-label="Channels">
          {channels.map((channel) => (
            <button
              key={channel.$id}
              className={channel.$id === selectedId ? "selected" : ""}
              onClick={() => setSelectedId(channel.$id)}
              type="button"
            >
              <span>{channel.visibility === "private" ? "◆" : "#"}</span>
              {channel.name}
            </button>
          ))}
        </nav>
        <button aria-label="Log out" className="quiet" onClick={() => void logout()} type="button">Log out</button>
      </aside>
      <section className="conversation">
        <header>
          <div>
            <p className="eyebrow">{selected?.visibility ?? "channel"}</p>
            <h2>{selected?.name ?? "Loading…"}</h2>
          </div>
          <div className="presence" aria-label="Presence">
            {visiblePresence.length} online · {Math.max(0, unreadCount)} unread
          </div>
        </header>
        {error ? <p role="alert">{error}</p> : null}
        <ol className="messages">
          {[...messages].reverse().map((message) => (
            <li key={message.$id} data-message-id={message.$id} data-created-at={message.$createdAt}>
              <div>
                <strong>{authoritativeAuthor(message)}</strong>
                <time>{new Date(message.$createdAt).toLocaleTimeString()}</time>
              </div>
              <p>{message.body}</p>
              <button aria-label={`Mark read ${message.body}`} onClick={() => void markRead(message.$id)} type="button">Mark read</button>
            </li>
          ))}
        </ol>
        <form className="composer" onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}>
          <input
            aria-label="Message"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              void refreshPresence("typing").catch(() => {});
            }}
            placeholder="Write a message"
          />
          <button className="primary" type="submit">Send</button>
        </form>
      </section>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<Models.User<Models.Preferences> | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    void account.get().then(setUser).catch(() => {}).finally(() => setChecked(true));
  }, []);
  if (!checked) return <main className="login-card"><p>Connecting…</p></main>;
  if (!user) return <Login onLogin={setUser} />;
  return <Chat user={user} onLogout={() => setUser(null)} />;
}

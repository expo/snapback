import { FormEvent, useEffect, useMemo, useState } from "react";
import type { RealtimeChannel, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type Channel = {
  id: string;
  slug: string;
  name: string;
  visibility: "public" | "private";
};

type Message = {
  id: string;
  channel_id: string;
  author_id: string;
  body: string;
  seq: number;
  created_at: string;
};

const PAGE_SIZE = 25;

export function ChatApp() {
  const [user, setUser] = useState<User | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [composer, setComposer] = useState("");
  const [typing, setTyping] = useState<string[]>([]);
  const [online, setOnline] = useState<string[]>([]);
  const [connection, setConnection] = useState("Connecting");
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session) {
        setMessages([]);
        setChannels([]);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("channels")
      .select("id,slug,name,visibility")
      .order("sort_key")
      .then(({ data, error: queryError }) => {
        if (queryError) setError(queryError.message);
        const next = (data ?? []) as Channel[];
        setChannels(next);
        setChannel((current) => current ?? next[0] ?? null);
      });
  }, [user]);

  useEffect(() => {
    if (!user || !channel) return;
    let durable: RealtimeChannel | undefined;
    let ephemeral: RealtimeChannel | undefined;
    let cancelled = false;

    async function connect() {
      setConnection("Connecting");
      const { data, error: queryError } = await supabase
        .from("messages")
        .select("id,channel_id,author_id,body,seq,created_at")
        .eq("channel_id", channel!.id)
        .order("seq", { ascending: false })
        .limit(PAGE_SIZE);
      if (cancelled) return;
      if (queryError) {
        setError(queryError.message);
        return;
      }
      setMessages(((data ?? []) as Message[]).reverse());

      durable = supabase
        .channel(`messages:${channel!.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `channel_id=eq.${channel!.id}`
          },
          ({ new: row }) => {
            const next = row as Message;
            setMessages((current) =>
              current.some((message) => message.id === next.id)
                ? current
                : [...current, next].sort((left, right) => left.seq - right.seq)
            );
          }
        )
        .subscribe((status) => setConnection(status === "SUBSCRIBED" ? "Online" : status));

      if (channel!.visibility === "public") {
        ephemeral = supabase.channel(`chat:${channel!.id}`, {
          config: {
            private: true,
            presence: { key: user!.id },
            broadcast: { self: false }
          }
        });
        ephemeral
          .on("broadcast", { event: "typing" }, ({ payload }) => {
            const actor = String(payload.actor);
            setTyping((current) => [...new Set([...current, actor])]);
            window.setTimeout(() => setTyping((current) => current.filter((id) => id !== actor)), 1_500);
          })
          .on("presence", { event: "sync" }, () => {
            setOnline(Object.keys(ephemeral!.presenceState()));
          })
          .subscribe(async (status) => {
            if (status === "SUBSCRIBED") {
              await ephemeral!.track({ actor: user!.id, online_at: new Date().toISOString() });
            }
          });
      } else {
        setTyping([]);
        setOnline([]);
      }
    }

    void connect();
    return () => {
      cancelled = true;
      if (durable) void supabase.removeChannel(durable);
      if (ephemeral) void supabase.removeChannel(ephemeral);
    };
  }, [channel, user]);

  const unread = useMemo(() => messages.filter((message) => message.author_id !== user?.id).length, [messages, user]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!channel || !composer.trim()) return;
    const body = composer.trim();
    setComposer("");
    const { error: insertError } = await supabase.from("messages").insert({ channel_id: channel.id, body });
    if (insertError) setError(insertError.message);
  }

  async function notifyTyping(value: string) {
    setComposer(value);
    if (!channel || !value) return;
    const ephemeral = supabase.getChannels().find((candidate) => candidate.topic.endsWith(`chat:${channel.id}`));
    await ephemeral?.send({ type: "broadcast", event: "typing", payload: { actor: user?.id } });
  }

  if (!user) return <SignIn error={error} setError={setError} />;

  return (
    <div className="app-frame" data-testid="chat-shell">
      <aside className="rail" aria-label="Bakeoff application">
        <div className="mark" aria-hidden="true">SB</div>
        <button className="rail-button active" type="button">chat</button>
      </aside>
      <main>
        <header className="topbar">
          <div><p className="eyebrow">Calibration app · Supabase</p><h1>Realtime group chat</h1></div>
          <div className="status-row">
            <span className="status" data-testid="connection-state">{connection}</span>
            <button className="avatar" aria-label="Log out" data-testid="account-menu" onClick={() => void supabase.auth.signOut()}>
              {user.email?.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <section className="workspace chat-grid" aria-label="Group chat">
          <nav className="panel list-nav" aria-label="Channels">
            <button className="primary" data-testid="chat-new-channel" disabled>+ Channel</button>
            {channels.map((item) => (
              <button
                className={item.id === channel?.id ? "nav-row selected" : "nav-row"}
                key={item.id}
                onClick={() => setChannel(item)}
                type="button"
              >
                {item.visibility === "private" ? "🔒 " : "# "}{item.name}
              </button>
            ))}
          </nav>
          <div className="panel content-panel chat-panel">
            <div className="section-heading">
              <div><p className="eyebrow">{channel?.visibility ?? "Channel"}</p><h2># {channel?.name}</h2></div>
              <span>{online.length} online · {unread} unread</span>
            </div>
            <div className="messages" data-testid="chat-message-list">
              {messages.map((message) => (
                <article key={message.id}>
                  <div className="mini-avatar">{message.author_id === user.id ? "Y" : "M"}</div>
                  <p><strong>{message.author_id === user.id ? "You" : "Member"} <time>#{message.seq}</time></strong>{message.body}</p>
                </article>
              ))}
              {typing.length > 0 && <div className="typing" data-testid="chat-typing">{typing.length} member typing…</div>}
            </div>
            <form className="composer" onSubmit={send}>
              <label>Message #{channel?.name}</label>
              <input data-testid="chat-composer" value={composer} onChange={(event) => void notifyTyping(event.target.value)} placeholder="Write a message…" />
              <button className="primary" type="submit">Send</button>
            </form>
            {error && <p className="error">{error}</p>}
          </div>
          <aside className="panel member-panel" aria-label="Channel members">
            <p className="section-label">Online — {online.length}</p>
            {online.map((id) => <span key={id}>● {id === user.id ? "You" : "Member"}</span>)}
          </aside>
        </section>
      </main>
    </div>
  );
}

function SignIn({ error, setError }: { error: string; setError: (value: string) => void }) {
  const [email, setEmail] = useState("alice@llp0102.local");
  const [passphrase, setPassphrase] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: passphrase });
    if (signInError) setError(signInError.message);
  }

  return (
    <main className="auth-card panel">
      <p className="eyebrow">Supabase Auth</p>
      <h1>Realtime group chat</h1>
      <form onSubmit={submit}>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Passphrase<input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label>
        <button className="primary" type="submit">Sign in</button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  );
}

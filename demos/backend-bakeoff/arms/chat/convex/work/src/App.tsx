import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

export function App() {
  const channels = useQuery(api.chat.listChannels, {});
  const [channelId, setChannelId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const history = useQuery(
    api.chat.latestMessages,
    channelId ? { channelId: channelId as never, limit: 25 } : "skip",
  );
  const send = useMutation(api.chat.sendMessage);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!channelId || !body.trim()) return;
    await send({ channelId: channelId as never, body: body.trim() });
    setBody("");
  }

  return (
    <main>
      <header>
        <p className="eyebrow">LLP 0102 · Convex</p>
        <h1>Realtime group chat</h1>
        <p>Native reactive queries, cursor history, and server-authoritative sends.</p>
      </header>
      <section className="layout">
        <nav aria-label="Channels">
          <h2>Channels</h2>
          {channels?.map((channel) => (
            <button
              data-testid={`channel-${channel.slug}`}
              className={channelId === channel._id ? "selected" : ""}
              key={channel._id}
              onClick={() => setChannelId(channel._id)}
            >
              <span>{channel.visibility === "private" ? "🔒" : "#"}</span>
              {channel.name}
            </button>
          ))}
        </nav>
        <section className="conversation" aria-live="polite">
          <div className="messages" data-testid="message-list">
            {history?.map((message) => (
              <article key={message._id} data-testid={`message-${message.sequence}`}>
                <strong>{message.authorName}</strong>
                <p>{message.body}</p>
                <small>#{message.sequence}</small>
              </article>
            ))}
            {!channelId && <p className="empty">Choose a channel.</p>}
          </div>
          <form onSubmit={submit}>
            <label htmlFor="message">Message</label>
            <input
              id="message"
              data-testid="message-input"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write a message"
            />
            <button data-testid="send-message" type="submit">Send</button>
          </form>
        </section>
      </section>
    </main>
  );
}

import { useMemo, useState, type ReactNode } from "react";
import { DbConnection } from "./module_bindings";

const apps = ["todo", "chat", "linear", "partiful", "research-room"] as const;
type AppName = (typeof apps)[number];

function Shell({
  app,
  title,
  eyebrow,
  children,
  onNavigate,
}: {
  app: AppName;
  title: string;
  eyebrow: string;
  children: ReactNode;
  onNavigate: (app: AppName) => void;
}) {
  return (
    <div className="app-frame" data-testid={`${app}-shell`}>
      <aside className="rail" aria-label="Bakeoff applications">
        <div className="mark" aria-hidden="true">SB</div>
        {apps.map((name) => (
          <button
            className={name === app ? "rail-button active" : "rail-button"}
            data-testid={`navigate-${name}`}
            key={name}
            onClick={() => onNavigate(name)}
            type="button"
          >
            {name === "research-room" ? "Research" : name}
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
            <span className="status" data-testid="connection-state">Online</span>
            <button className="avatar" aria-label="Open account menu" data-testid="account-menu">A</button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function Todo() {
  const tasks = [
    ["Freeze acceptance IDs", "Alice", "Today", true],
    ["Verify second-client delivery", "Bob", "Tomorrow", false],
    ["Capture cleanup receipt", "Alice", "Friday", false],
  ] as const;
  return (
    <section className="workspace two-column" aria-label="Todo workspace">
      <nav className="panel list-nav" aria-label="Task lists">
        <button className="primary" data-testid="todo-new-list">+ New list</button>
        {["Inbox 12", "Bakeoff 25", "Operations 8", "Done 55"].map((list, index) => (
          <button className={index === 1 ? "nav-row selected" : "nav-row"} key={list}>{list}</button>
        ))}
      </nav>
      <div className="panel content-panel">
        <div className="section-heading">
          <div><p className="eyebrow">Shared workspace</p><h2>Bakeoff</h2></div>
          <button className="primary" data-testid="todo-add-task">Add task</button>
        </div>
        <div className="task-table" role="table" aria-label="Tasks">
          {tasks.map(([title, owner, due, complete], index) => (
            <div className="task-row" role="row" key={title} data-testid={`todo-task-${index}`}>
              <button className={complete ? "check checked" : "check"} aria-label={`${complete ? "Reopen" : "Complete"} ${title}`} />
              <div><strong>{title}</strong><span>{owner} · {due}</span></div>
              <button className="grab" aria-label={`Reorder ${title}`}>⠿</button>
            </div>
          ))}
        </div>
        <div className="offline-note" data-testid="todo-offline-state">All changes settled</div>
      </div>
    </section>
  );
}

const spacetimeUri = "ws://127.0.0.1:3312";
const spacetimeDatabase = "llp0102-chat-spacetimedb-w1";

function Chat() {
  const [connection, setConnection] = useState<DbConnection | null>(null);
  const [persona, setPersona] = useState<string>("");
  const [selectedChannel, setSelectedChannel] = useState("public-general");
  const [composer, setComposer] = useState("");
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const refresh = () => setRevision(value => value + 1);
  const channels = useMemo(
    () => connection ? Array.from(connection.db.myChannels.iter()) : [],
    [connection, revision]
  );
  const messages = useMemo(
    () => connection
      ? Array.from(connection.db.myMessages.iter())
        .filter(row => row.channelId === selectedChannel)
        .sort((left, right) => left.id < right.id ? -1 : 1)
        .slice(-25)
      : [],
    [connection, selectedChannel, revision]
  );
  const typing = useMemo(
    () => connection
      ? Array.from(connection.db.myTyping.iter())
        .filter(row => row.channelId === selectedChannel && row.actorName !== persona)
      : [],
    [connection, selectedChannel, persona, revision]
  );
  const present = useMemo(
    () => connection ? Array.from(connection.db.visiblePresence.iter()) : [],
    [connection, revision]
  );

  const connectAs = (name: string) => {
    connection?.disconnect();
    setReady(false);
    setError("");
    const tokenKey = `llp0102-spacetimedb-${name.toLowerCase()}-token`;
    const savedToken = window.localStorage.getItem(tokenKey);
    let builder = DbConnection.builder()
      .withUri(spacetimeUri)
      .withDatabaseName(spacetimeDatabase)
      .onConnect(async (conn, _identity, returnedToken) => {
        window.localStorage.setItem(tokenKey, savedToken ?? returnedToken);
        setConnection(conn);
        setPersona(name);
        try {
          await conn.reducers.registerPersona({ name });
          for (const table of [
            conn.db.myChannels,
            conn.db.myMessages,
            conn.db.myTyping,
            conn.db.visiblePresence,
            conn.db.myReadMarkers,
          ]) {
            table.onInsert(refresh);
            table.onDelete(refresh);
            table.onUpdate?.(refresh);
          }
          conn.subscriptionBuilder()
            .onApplied(() => {
              setReady(true);
              refresh();
            })
            .onError((ctx) => setError(String(ctx.event)))
            .subscribe([
              "SELECT * FROM my_channels",
              "SELECT * FROM my_messages",
              "SELECT * FROM my_typing",
              "SELECT * FROM visible_presence",
              "SELECT * FROM my_read_markers",
            ]);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .onConnectError((_ctx, cause) => setError(cause.message));
    if (savedToken) builder = builder.withToken(savedToken);
    builder.build();
  };

  const send = async () => {
    if (!connection || !composer.trim()) return;
    await connection.reducers.sendMessage({
      channelId: selectedChannel,
      body: composer.trim(),
    });
    setComposer("");
    await connection.reducers.clearTyping({ channelId: selectedChannel });
  };

  const setDraft = async (value: string) => {
    setComposer(value);
    if (!connection) return;
    if (value) {
      await connection.reducers.setTyping({
        channelId: selectedChannel,
        generation: BigInt(Date.now()),
      });
    } else {
      await connection.reducers.clearTyping({ channelId: selectedChannel });
    }
  };

  return (
    <section className="workspace chat-grid" aria-label="Group chat">
      <nav className="panel list-nav" aria-label="Channels">
        <p className="section-label">Identity</p>
        <div className="persona-row">
          {["Alice", "Bob", "Mallory"].map(name => (
            <button
              className={persona === name ? "persona active" : "persona"}
              key={name}
              onClick={() => connectAs(name)}
              type="button"
            >
              {name}
            </button>
          ))}
        </div>
        <p className="provider-note">SpacetimeDB 2.7 · native views + reducers</p>
        <p className="section-label">Channels</p>
        {channels.map(target => (
          <button
            className={target.id === selectedChannel ? "nav-row selected" : "nav-row"}
            key={target.id}
            onClick={() => setSelectedChannel(target.id)}
            type="button"
          >
            {target.isPrivate ? "🔒" : "#"} {target.name}
          </button>
        ))}
        {persona === "Alice" && channels.length === 0 && (
          <button
            className="primary"
            onClick={() => connection?.reducers.seedFixtures({}).catch(cause => setError(String(cause)))}
            type="button"
          >
            Seed frozen fixture
          </button>
        )}
      </nav>
      <div className="panel content-panel chat-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{ready ? "Native subscription live" : "Choose an identity"}</p>
            <h2>{channels.find(row => row.id === selectedChannel)?.name ?? "Realtime group chat"}</h2>
          </div>
          <span>{present.length} online</span>
        </div>
        <div className="messages" data-testid="chat-message-list">
          {error && <div className="error-note">{error}</div>}
          {messages.map(row => (
            <article key={row.id.toString()}>
              <div className={row.authorName === "Bob" ? "mini-avatar blue" : "mini-avatar"}>
                {row.authorName.slice(0, 1)}
              </div>
              <p>
                <strong>{row.authorName} <time>#{row.id.toString()}</time></strong>
                {row.body}
              </p>
            </article>
          ))}
          <div className="typing" data-testid="chat-typing">
            {typing.length ? `${typing.map(row => row.actorName).join(", ")} typing…` : "\u00a0"}
          </div>
        </div>
        <label className="composer">
          Message {selectedChannel}
          <input
            data-testid="chat-composer"
            disabled={!ready}
            onChange={event => void setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") void send();
            }}
            placeholder="Write a message…"
            value={composer}
          />
        </label>
      </div>
      <aside className="panel member-panel" aria-label="Channel members">
        <p className="section-label">Online — {present.length}</p>
        {present.map(row => <span key={row.identity.toHexString()}>● {row.actorName}</span>)}
        <p className="section-label">Authority</p>
        <span className="muted">Private tables never subscribe directly.</span>
      </aside>
    </section>
  );
}

function Linear() {
  const issues = [
    ["LIN-142", "Stable cursor pagination", "In progress", "Alice"],
    ["LIN-141", "Schema evolution receipt", "Todo", "Bob"],
    ["LIN-140", "Concurrent board movement", "Review", "Alice"],
  ];
  return (
    <section className="workspace two-column" aria-label="Issue tracker">
      <nav className="panel list-nav" aria-label="Issue views">
        <button className="primary" data-testid="linear-new-issue">+ New issue</button>
        {["My issues", "Inbox", "Active", "Backlog", "Projects", "Teams"].map((item, index) => (
          <button className={index === 2 ? "nav-row selected" : "nav-row"} key={item}>{item}</button>
        ))}
      </nav>
      <div className="panel content-panel">
        <div className="section-heading"><div><p className="eyebrow">Platform team</p><h2>Active issues</h2></div><input aria-label="Search issues" data-testid="linear-search" placeholder="Search" /></div>
        <div className="issue-list" data-testid="linear-issue-list">
          {issues.map(([id, title, status, owner]) => (
            <button className="issue-row" key={id} data-testid={`linear-issue-${id}`}>
              <span className="muted">{id}</span><strong>{title}</strong><span className="pill">{status}</span><span>{owner}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Partiful() {
  return (
    <section className="workspace event-grid" aria-label="Event application">
      <article className="event-card panel">
        <div className="event-art" data-testid="partiful-event-art"><span>SUMMER<br />SUPPER</span></div>
        <div className="event-copy"><p className="eyebrow">Saturday · 6:30 PM</p><h2>Summer Supper Club</h2><p>Oakland, California · address for guests</p><div className="rsvp-row" data-testid="partiful-rsvp-controls"><button>Going</button><button>Maybe</button><button>Can’t go</button></div></div>
      </article>
      <aside className="panel event-side">
        <p className="section-label">49 / 50 attending</p>
        <div className="capacity"><span style={{ width: "98%" }} /></div>
        <h3>Guest list</h3><p>Alice +1 · Bob · 46 others</p>
        <button className="primary" data-testid="partiful-invite">Invite guests</button>
        <h3>Event wall</h3><p><strong>Bob</strong> Bringing dessert!</p>
      </aside>
    </section>
  );
}

function ResearchRoom() {
  return (
    <section className="workspace research-grid" aria-label="Research room">
      <nav className="panel list-nav" aria-label="Sources">
        <button className="primary" data-testid="research-upload">Upload source</button>
        <p className="section-label">20 sources</p>
        {["Architecture.pdf", "Interview notes.md", "Benchmarks.csv", "Roadmap.txt"].map((source) => <button className="nav-row" key={source}>{source}</button>)}
      </nav>
      <div className="panel content-panel research-panel">
        <div className="section-heading"><div><p className="eyebrow">Shared research room</p><h2>Backend architecture</h2></div><span>2 members</span></div>
        <article className="question"><strong>Alice</strong><p>Which backend properties matter most for cancellation safety?</p></article>
        <article className="answer" data-testid="research-answer">
          <p className="eyebrow">Answer · complete</p>
          <p>Durable attempt identity and an authoritative cancellation fence keep late work from becoming a successful patch.</p>
          <div className="citations"><button>[1] Architecture.pdf</button><button>[2] Interview notes.md</button></div>
        </article>
        <div className="progress" data-testid="research-progress"><span className="complete" /><span className="complete" /><span className="complete" /><span className="complete" /></div>
        <label className="composer">Ask the room<input data-testid="research-question" placeholder="Ask a cited question…" /></label>
      </div>
    </section>
  );
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("app");
  const initial = apps.includes(requested as AppName) ? requested as AppName : "todo";
  const [app, setApp] = useState<AppName>(initial);
  const titles: Record<AppName, [string, string]> = {
    todo: ["Offline shared Todo", "Calibration app"],
    chat: ["Realtime group chat", "Calibration app"],
    linear: ["Issue tracker", "Deep app"],
    partiful: ["Event workspace", "Deep app"],
    "research-room": ["Collaborative research", "Deep app"],
  };
  const navigate = (next: AppName) => {
    setApp(next);
    window.history.replaceState(null, "", `?app=${next}`);
  };
  return (
    <Shell app={app} title={titles[app][0]} eyebrow={titles[app][1]} onNavigate={navigate}>
      {app === "todo" && <Todo />}
      {app === "chat" && <Chat />}
      {app === "linear" && <Linear />}
      {app === "partiful" && <Partiful />}
      {app === "research-room" && <ResearchRoom />}
    </Shell>
  );
}

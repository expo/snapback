import { useState, type ReactNode } from "react";

const contracts = ["notebook", "chat", "board", "event", "research", "ops"] as const;
type ContractName = (typeof contracts)[number];

function Shell({
  contract,
  title,
  eyebrow,
  children,
  onNavigate,
}: {
  contract: ContractName;
  title: string;
  eyebrow: string;
  children: ReactNode;
  onNavigate: (contract: ContractName) => void;
}) {
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
            <span className="status" data-testid="connection-state">Online</span>
            <span className="status stale" data-testid="freshness-state">Fresh</span>
            <button className="avatar" aria-label="Open account menu" data-testid="account-menu">A</button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function Notebook() {
  const records = [
    ["Transformer vault reading", "Alice", "Today", true],
    ["North fence corrosion pass", "Bob", "Tomorrow", false],
    ["Pump house vibration log", "Alice", "Friday", false],
  ] as const;
  return (
    <section className="workspace two-column" aria-label="Field notebook">
      <nav className="panel list-nav" aria-label="Notebooks">
        <button className="primary" data-testid="notebook-new-record">+ New record</button>
        {["Site A 12", "Substation 25", "Pump house 8", "Archive 55"].map((list, index) => (
          <button className={index === 1 ? "nav-row selected" : "nav-row"} key={list}>{list}</button>
        ))}
      </nav>
      <div className="panel content-panel">
        <div className="section-heading">
          <div><p className="eyebrow">Team workspace</p><h2>Substation</h2></div>
          <button className="primary" data-testid="notebook-add-record">Add record</button>
        </div>
        <div className="task-table" role="table" aria-label="Records">
          {records.map(([title, owner, due, done], index) => (
            <div className="task-row" role="row" key={title} data-testid={`notebook-record-${index}`}>
              <button className={done ? "check checked" : "check"} aria-label={`${done ? "Reopen" : "Complete"} ${title}`} />
              <div><strong>{title}</strong><span>{owner} · {due} · 1 attachment</span></div>
              <button className="grab" aria-label={`Reorder ${title}`}>⠿</button>
            </div>
          ))}
        </div>
        <div className="offline-note" data-testid="notebook-queue-state">All changes settled</div>
      </div>
    </section>
  );
}

function Chat() {
  return (
    <section className="workspace chat-grid" aria-label="Group chat">
      <nav className="panel list-nav" aria-label="Channels">
        <button className="primary" data-testid="chat-new-channel">+ Channel</button>
        <p className="section-label">Public</p>
        <button className="nav-row selected"># general</button>
        <button className="nav-row"># field-notes</button>
        <p className="section-label">Private</p>
        <button className="nav-row">🔒 sweep</button>
        <button className="nav-row">🔒 fix-loop</button>
      </nav>
      <div className="panel content-panel chat-panel">
        <div className="section-heading"><div><p className="eyebrow">Public channel</p><h2># general</h2></div><span data-testid="chat-unread">2 unread</span></div>
        <div className="messages" data-testid="chat-message-list">
          <article><div className="mini-avatar">A</div><p><strong>Alice <time>10:41</time></strong>Acceptance IDs are frozen.</p></article>
          <article><div className="mini-avatar blue">B</div><p><strong>Bob <time>10:42</time></strong>I can see the authoritative update.</p></article>
          <div className="typing" data-testid="chat-typing">Bob is typing…</div>
        </div>
        <label className="composer">Message #general<input data-testid="chat-composer" placeholder="Write a message…" /></label>
      </div>
      <aside className="panel member-panel" aria-label="Channel members">
        <p className="section-label">Online — 2</p>
        <span data-testid="chat-presence">● Alice ● Bob</span>
        <p className="section-label">Offline — 1</p><span className="muted">○ Mallory</span>
      </aside>
    </section>
  );
}

function Board() {
  const issues = [
    ["ISS-142", "Stable cursor pagination", "In progress", "Alice"],
    ["ISS-141", "Schema evolution receipt", "Todo", "Bob"],
    ["ISS-140", "Concurrent board movement", "Review", "Alice"],
  ];
  return (
    <section className="workspace two-column" aria-label="Issue board">
      <nav className="panel list-nav" aria-label="Issue views">
        <button className="primary" data-testid="board-new-issue">+ New issue</button>
        {["My issues", "Inbox", "Active", "Backlog", "Projects", "Teams"].map((item, index) => (
          <button className={index === 2 ? "nav-row selected" : "nav-row"} key={item}>{item}</button>
        ))}
      </nav>
      <div className="panel content-panel">
        <div className="section-heading"><div><p className="eyebrow">Platform team</p><h2>Active issues</h2></div><input aria-label="Search issues" data-testid="board-search" placeholder="Search" /></div>
        <div className="issue-list" data-testid="board-issue-list">
          {issues.map(([id, title, status, owner]) => (
            <button className="issue-row" key={id} data-testid={`board-issue-${id}`}>
              <span className="muted">{id}</span><strong>{title}</strong><span className="pill">{status}</span><span>{owner}</span>
            </button>
          ))}
        </div>
        <div className="offline-note" data-testid="board-aggregates">12 active · 4 in review · 55 done</div>
      </div>
    </section>
  );
}

function Event() {
  return (
    <section className="workspace event-grid" aria-label="Event application">
      <article className="event-card panel">
        <div className="event-art" data-testid="event-art"><span>SUMMER<br />SUPPER</span></div>
        <div className="event-copy"><p className="eyebrow">Saturday · 6:30 PM</p><h2>Summer Supper Club</h2><p>Oakland, California · address for guests</p><div className="rsvp-row" data-testid="event-rsvp-controls"><button>Going</button><button>Maybe</button><button>Can’t go</button></div></div>
      </article>
      <aside className="panel event-side">
        <p className="section-label" data-testid="event-guest-count">49 / 50 attending</p>
        <div className="capacity"><span style={{ width: "98%" }} /></div>
        <h3>Guest list</h3><p>Alice +1 · Bob · 46 others</p>
        <button className="primary" data-testid="event-invite">Invite guests</button>
        <h3>Event wall</h3><p data-testid="event-wall"><strong>Bob</strong> Bringing dessert!</p>
      </aside>
    </section>
  );
}

function Research() {
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

function Ops() {
  const jobs = [
    ["JOB-1042", "Install: Meridian Foods", "Claimed", "Alice"],
    ["JOB-1041", "Repair: Delta Freight", "Dispatched", "Bob"],
    ["JOB-1040", "Survey: North Yard", "Settled", "Alice"],
  ];
  return (
    <section className="workspace two-column" aria-label="Operations ledger">
      <nav className="panel list-nav" aria-label="Ledger views">
        <button className="primary" data-testid="ops-new-job">+ New job</button>
        {["Dashboard", "Customers", "Jobs", "Schedules", "Attempts", "Exports"].map((item, index) => (
          <button className={index === 2 ? "nav-row selected" : "nav-row"} key={item}>{item}</button>
        ))}
      </nav>
      <div className="panel content-panel">
        <div className="section-heading"><div><p className="eyebrow">Operations</p><h2>Jobs</h2></div><input aria-label="Filter range" data-testid="ops-range-filter" placeholder="This week" /></div>
        <div className="issue-list" data-testid="ops-job-list">
          {jobs.map(([seq, title, status, owner]) => (
            <button className="issue-row" key={seq} data-testid={`ops-job-${seq}`}>
              <span className="muted">{seq}</span><strong>{title}</strong><span className="pill">{status}</span><span>{owner}</span>
            </button>
          ))}
        </div>
        <div className="offline-note" data-testid="ops-dashboard-counts">3 open · 1 claimed · 12 settled this week</div>
      </div>
    </section>
  );
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("contract");
  const initial = contracts.includes(requested as ContractName) ? requested as ContractName : "notebook";
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
    <Shell contract={contract} title={titles[contract][0]} eyebrow={titles[contract][1]} onNavigate={navigate}>
      {contract === "notebook" && <Notebook />}
      {contract === "chat" && <Chat />}
      {contract === "board" && <Board />}
      {contract === "event" && <Event />}
      {contract === "research" && <Research />}
      {contract === "ops" && <Ops />}
    </Shell>
  );
}

// LLP 0137 frozen neutral web shell (demos/improvement-sweep/neutral-web),
// A3 arm: the board view is wired live through the shared BoardView module
// (src/board-view.mjs — six live queries in one provider-owned group); the
// other five contract views stay static shell placeholders.
import { useState, type ReactNode } from "react";
import { useSnapbackConnection } from "@expo/snapback-react";
import { BoardView } from "./board-view.mjs";

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
  const connection = useSnapbackConnection();
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
            <span className="status" data-testid="connection-state">{connection.status}</span>
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
  return (
    <section className="workspace" aria-label="Field notebook">
      <div className="panel content-panel"><p>Static shell (A1 contract; not wired in this arm).</p></div>
    </section>
  );
}

function Chat() {
  return (
    <section className="workspace" aria-label="Group chat">
      <div className="panel content-panel"><p>Static shell (A2 contract; not wired in this arm).</p></div>
    </section>
  );
}

function Event() {
  return (
    <section className="workspace" aria-label="Event application">
      <div className="panel content-panel"><p>Static shell (A4 contract; not wired in this arm).</p></div>
    </section>
  );
}

function Research() {
  return (
    <section className="workspace" aria-label="Research room">
      <div className="panel content-panel"><p>Static shell (A5 contract; not wired in this arm).</p></div>
    </section>
  );
}

function Ops() {
  return (
    <section className="workspace" aria-label="Operations ledger">
      <div className="panel content-panel"><p>Static shell (A6 contract; not wired in this arm).</p></div>
    </section>
  );
}

export function App({ orgId = "org_relay" }: { orgId?: string }) {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("contract");
  const initial = contracts.includes(requested as ContractName) ? requested as ContractName : "board";
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
      {contract === "board" && <BoardView orgId={orgId} />}
      {contract === "event" && <Event />}
      {contract === "research" && <Research />}
      {contract === "ops" && <Ops />}
    </Shell>
  );
}

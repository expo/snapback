// The frozen neutral-web shell (demos/improvement-sweep/neutral-web) with
// the A5 research view wired live; the other five contract views stay
// static placeholders exactly as the shell renders them.
import { useState, type ReactNode } from "react";
import { ResearchView } from "./research-view.mjs";

const contracts = ["notebook", "chat", "board", "event", "research", "ops"] as const;
type ContractName = (typeof contracts)[number];

const ROOM_ID = "room_arch";

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

function Placeholder({ label }: { label: string }) {
  return (
    <section className="workspace" aria-label={label}>
      <div className="panel content-panel"><p>{label} — static placeholder (A5 arm)</p></div>
    </section>
  );
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("contract");
  const initial = contracts.includes(requested as ContractName) ? requested as ContractName : "research";
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
      {contract === "research" && <ResearchView roomId={ROOM_ID} />}
      {contract !== "research" && <Placeholder label={titles[contract][0]} />}
    </Shell>
  );
}

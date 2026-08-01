// The frozen neutral-web shell (LLP 0137 G0) with the A6 operations view
// wired live; the other five contract views stay static placeholders.
import { useState, type ReactNode } from "react";
import { OpsView } from "./ops-view.mjs";

const ORG_ID = "org_meridian";

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

function Placeholder({ label }: { label: string }) {
  return (
    <section className="workspace" aria-label={label}>
      <div className="panel content-panel">
        <p className="section-label">{label} — static placeholder (the A6 arm wires the ops view live)</p>
      </div>
    </section>
  );
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("contract");
  const initial = contracts.includes(requested as ContractName) ? requested as ContractName : "ops";
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
      {contract === "notebook" && <Placeholder label="Offline field notebook" />}
      {contract === "chat" && <Placeholder label="Group chat and presence" />}
      {contract === "board" && <Placeholder label="Issue and planning board" />}
      {contract === "event" && <Placeholder label="Event and invitation" />}
      {contract === "research" && <Placeholder label="Collaborative AI research room" />}
      {contract === "ops" && <OpsView orgId={ORG_ID} />}
    </Shell>
  );
}

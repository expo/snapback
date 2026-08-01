// LLP 0137 A1 sweep — neutral shell with the notebook (A1) view wired to a
// live Snapback backend via the first-party React arm. The other five
// contract views remain the frozen static shell.
//
// Offline honesty note (arm finding): @expo/snapback-react 0.1.7 exposes NO
// freshness/retention/outbox surface — useSnapbackConnection carries only
// the connection axis. The shell's freshness-state chip is therefore derived
// from connection status alone; the documented 'retained' freshness fact is
// unreachable from the first-party React arm.
import { useState, type ReactNode } from 'react';
import {
  skip,
  useSnapbackConnection,
  useSnapbackMutation,
  useSnapbackQuery,
} from '@expo/snapback-react';
import api from '../snapback/generated/api.mjs';

// The generated api types flow through the hooks exactly (readonly rows,
// branded ids/principals), so the view infers row types instead of declaring
// structural twins. The two casts below exist because the branded Id and
// Principal types are declared in the generated api.d.ts but are NOT
// importable through the relative api.mjs specifier (TS2614) — the same
// rough edge the A2 arm recorded.

const contracts = ["notebook", "chat", "board", "event", "research", "ops"] as const;
type ContractName = (typeof contracts)[number];

function Shell({
  contract,
  title,
  eyebrow,
  children,
  onNavigate,
  identity,
}: {
  contract: ContractName;
  title: string;
  eyebrow: string;
  children: ReactNode;
  onNavigate: (contract: ContractName) => void;
  identity: string;
}) {
  const connection = useSnapbackConnection();
  const live = connection.status === 'live';
  const fresh = live || connection.status === 'polling';
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
            <span className="status" data-testid="connection-state">{live ? 'Online' : connection.status}</span>
            <span className="status stale" data-testid="freshness-state">{fresh ? 'Fresh' : 'Stale'}</span>
            <button className="avatar" aria-label="Open account menu" data-testid="account-menu">{identity.slice(0, 1)}</button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function Notebook({ displayName, userId }: { displayName: string; userId: string }) {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  const sitesQuery = useSnapbackQuery(api.listSites, {});
  const recordsQuery = useSnapbackQuery(
    api.listRecords,
    workspaceId === null ? skip : ({ workspaceId } as never),
  );
  const createWorkspace = useSnapbackMutation(api.createWorkspace);
  const createRecord = useSnapbackMutation(api.createRecord);
  const updateRecord = useSnapbackMutation(api.updateRecord);

  const sites = sitesQuery.data ?? [];
  const records = recordsQuery.data ?? [];

  const openWorkspace = async () => {
    const created = await createWorkspace({ name: `Field survey — ${displayName}` });
    setWorkspaceId(String(created));
  };

  const addRecord = async () => {
    if (workspaceId === null || draftTitle.trim().length === 0) return;
    const clientKey = `ui-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    await createRecord({
      workspaceId,
      title: draftTitle.trim(),
      assigneeId: userId,
      assigneeName: displayName,
      dueAt: Date.now() + 86_400_000,
      position: (records.at(-1)?.position ?? 0) + 1000,
      clientKey,
    } as never);
    setDraftTitle('');
  };

  const toggle = async (row: (typeof records)[number]) => {
    await updateRecord({
      recordId: row._id,
      state: row.state === 'done' ? 'open' : 'done',
    });
  };

  return (
    <section className="workspace two-column" aria-label="Field notebook">
      <nav className="panel list-nav" aria-label="Notebooks">
        {workspaceId === null ? (
          <button className="primary" data-testid="notebook-new-record" onClick={() => void openWorkspace()}>
            + New workspace
          </button>
        ) : (
          <label className="composer">
            New record
            <input
              data-testid="notebook-new-record-title"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void addRecord(); }}
              placeholder="Transformer vault reading"
            />
          </label>
        )}
        <p className="section-label">Site directory</p>
        {sites.map((site) => (
          <button className="nav-row" key={site._id} data-testid={`site-${site._id}`}>
            {site.name} · {site.hazardClass}
          </button>
        ))}
      </nav>
      <div className="panel content-panel">
        <div className="section-heading">
          <div><p className="eyebrow">Team workspace</p><h2>Field survey</h2></div>
          <button
            className="primary"
            data-testid="notebook-add-record"
            onClick={() => void addRecord()}
            disabled={workspaceId === null}
          >
            Add record
          </button>
        </div>
        <div className="task-table" role="table" aria-label="Records">
          {records.map((row, index) => (
            <div className="task-row" role="row" key={row._id} data-testid={`notebook-record-${index}`}>
              <button
                className={row.state === 'done' ? "check checked" : "check"}
                aria-label={`${row.state === 'done' ? "Reopen" : "Complete"} ${row.title}`}
                onClick={() => void toggle(row)}
              />
              <div>
                <strong>{row.title}</strong>
                <span>{row.assigneeName} · due {new Date(row.dueAt).toLocaleDateString()} · rev {row.revision}</span>
              </div>
              <button className="grab" aria-label={`Reorder ${row.title}`}>⠿</button>
            </div>
          ))}
          {workspaceId === null && (
            <p className="offline-note">Create a workspace to start recording.</p>
          )}
        </div>
        <div className="offline-note" data-testid="notebook-queue-state">
          {recordsQuery.error !== undefined && recordsQuery.error !== null
            ? String((recordsQuery.error as { code?: string }).code ?? 'query error')
            : 'All changes settled'}
        </div>
      </div>
    </section>
  );
}

function StaticView({ label }: { label: string }) {
  return (
    <section className="workspace" aria-label={label}>
      <div className="panel content-panel"><p className="offline-note">{label} — static shell (not wired in the A1 arm)</p></div>
    </section>
  );
}

export function App({ displayName, userId }: { displayName: string; userId: string }) {
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
    <Shell
      contract={contract}
      title={titles[contract][0]}
      eyebrow={titles[contract][1]}
      onNavigate={navigate}
      identity={displayName}
    >
      {contract === "notebook" && <Notebook displayName={displayName} userId={userId} />}
      {contract === "chat" && <StaticView label="Group chat" />}
      {contract === "board" && <StaticView label="Issue board" />}
      {contract === "event" && <StaticView label="Event" />}
      {contract === "research" && <StaticView label="Research room" />}
      {contract === "ops" && <StaticView label="Operations ledger" />}
    </Shell>
  );
}

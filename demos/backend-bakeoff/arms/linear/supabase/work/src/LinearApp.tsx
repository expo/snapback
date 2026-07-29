import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

type Issue = {
  id: string;
  issue_number: number;
  title: string;
  status: string;
  priority: number;
  board_position: number;
};

const pageSize = 50;

export function LinearApp() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [query, setQuery] = useState("");
  const [connection, setConnection] = useState("Sign in required");
  const [message, setMessage] = useState("Online-only provider client; no native offline queue");

  const loadIssues = useCallback(async () => {
    const organization = await supabase.from("organizations").select("id").eq("slug", "acme").single();
    if (organization.error) {
      setConnection("Sign in required");
      return;
    }
    const result = query.trim()
      ? await supabase.rpc("linear_search_issues", {
          requested_organization: organization.data.id,
          search_query: query.trim(),
          requested_limit: pageSize
        })
      : await supabase.rpc("linear_issue_page", {
          requested_organization: organization.data.id,
          before_created_at: null,
          before_id: null,
          requested_limit: pageSize
        });
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    setIssues(result.data as Issue[]);
    setConnection("Online · authoritative");
  }, [query]);

  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);

  useEffect(() => {
    const channel = supabase
      .channel("linear-client-activity")
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, () => void loadIssues())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadIssues]);

  const grouped = useMemo(() => {
    const result = new Map<string, Issue[]>();
    for (const issue of issues) {
      const rows = result.get(issue.status) ?? [];
      rows.push(issue);
      result.set(issue.status, rows);
    }
    return result;
  }, [issues]);

  return (
    <div className="app-frame" data-testid="linear-shell">
      <aside className="rail">
        <div className="mark">SB</div>
        <button className="rail-button active">Linear</button>
        <button className="rail-button">My issues</button>
        <button className="rail-button">Projects</button>
        <button className="rail-button">Teams</button>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Deep app · Supabase</p>
            <h1>Issue tracker</h1>
          </div>
          <span className="status" data-testid="connection-state">{connection}</span>
        </header>
        <section className="workspace">
          <nav className="panel list-nav">
            <button className="primary" data-testid="linear-new-issue">+ New issue</button>
            {["Active", "Backlog", "Board", "Search", "Operations"].map((item, index) => (
              <button className={index === 0 ? "nav-row selected" : "nav-row"} key={item}>{item}</button>
            ))}
            <p className="client-note">{message}</p>
          </nav>
          <div className="panel content-panel">
            <div className="section-heading">
              <div><p className="eyebrow">Platform team</p><h2>Active issues</h2></div>
              <input
                aria-label="Search issues"
                data-testid="linear-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Postgres full-text search"
                value={query}
              />
            </div>
            <div className="board" data-testid="linear-issue-list">
              {["backlog", "todo", "in_progress", "review", "done"].map((status) => (
                <section className="column" key={status}>
                  <h3>{status.replace("_", " ")}</h3>
                  {(grouped.get(status) ?? []).slice(0, 10).map((issue) => (
                    <article className="issue-card" key={issue.id} data-testid={`linear-issue-${issue.issue_number}`}>
                      <span>LIN-{issue.issue_number}</span>
                      <strong>{issue.title}</strong>
                      <small>P{issue.priority} · position {issue.board_position}</small>
                    </article>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { account, databaseId, issueChannel, Query, realtime, tables } from "./appwrite";

type Issue = {
  $id: string;
  identifier: string;
  title: string;
  status: string;
  priority: number;
  sequence: number;
  revision: number;
};

export default function App() {
  const [user, setUser] = useState<{ $id: string; email: string } | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [realtimeEvents, setRealtimeEvents] = useState(0);

  const refresh = useCallback(async () => {
    const result = await tables.listRows({
      databaseId,
      tableId: "issues",
      queries: [
        Query.equal("org_id", ["org-primary"]),
        Query.orderDesc("sequence"),
        Query.limit(50),
      ],
      total: true,
    });
    setIssues(result.rows as unknown as Issue[]);
  }, []);

  useEffect(() => {
    account.get().then((next) => setUser({ $id: next.$id, email: next.email })).catch(() => {});
  }, []);
  useEffect(() => {
    if (!user) {
      setIssues([]);
      return;
    }
    refresh().catch((cause) => setError(cause.message));
    let subscription: Awaited<ReturnType<typeof realtime.subscribe>> | undefined;
    realtime.subscribe(issueChannel, () => {
      setRealtimeEvents((count) => count + 1);
      refresh().catch((cause) => setError(cause.message));
    }).then((value) => { subscription = value; }).catch((cause) => setError(cause.message));
    return () => { subscription?.unsubscribe(); };
  }, [refresh, user]);

  async function signIn() {
    setError("");
    await account.createEmailPasswordSession({ email, password });
    const next = await account.get();
    setUser({ $id: next.$id, email: next.email });
  }

  async function editFirst() {
    const issue = issues[0];
    if (!issue || !title.trim()) return;
    const nextTitle = title.trim();
    setPending(true);
    setIssues((current) => current.map((item) =>
      item.$id === issue.$id
        ? { ...item, title: nextTitle, revision: item.revision + 1 }
        : item));
    try {
      await tables.updateRow({
        databaseId,
        tableId: "issues",
        rowId: issue.$id,
        data: {
          title: nextTitle,
          search_text: `${nextTitle} Production-shaped Appwrite issue body ${issue.sequence}`,
          revision: issue.revision + 1,
        },
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh().catch(() => {});
    } finally {
      setPending(false);
    }
  }

  async function logout() {
    await realtime.disconnect();
    await account.deleteSession({ sessionId: "current" });
    setUser(null);
    setIssues([]);
  }

  return (
    <div
      className="shell"
      data-testid="linear-shell"
      data-ready={user ? "true" : "false"}
      data-issue-count={issues.length}
      data-pending={pending}
      data-realtime-events={realtimeEvents}
    >
      <aside>
        <div className="logo">AW</div>
        <button>Inbox</button>
        <button className="active">Active issues</button>
        <button>Projects</button>
        <button>Teams</button>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">Appwrite deep arm</p>
            <h1>Issue tracker</h1>
          </div>
          {user && <button aria-label="Log out" onClick={() => void logout()}>Log out</button>}
        </header>
        {!user ? (
          <section className="card login">
            <h2>Sign in</h2>
            <label>Email<input aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Password<input aria-label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button onClick={() => void signIn()}>Sign in</button>
          </section>
        ) : (
          <section className="card">
            <div className="heading">
              <h2>Primary organization</h2>
              <span data-testid="issue-count">{issues.length}</span>
            </div>
            <div className="edit">
              <input aria-label="Issue title" value={title} onChange={(event) => setTitle(event.target.value)} />
              <button onClick={() => void editFirst()}>Edit first issue</button>
            </div>
            {error && <p data-testid="error">{error}</p>}
            <div className="issues">
              {issues.map((issue) => (
                <article key={issue.$id} data-issue-id={issue.$id}>
                  <span>{issue.identifier}</span>
                  <strong>{issue.title}</strong>
                  <span className="pill">{issue.status}</span>
                  <span>P{issue.priority}</span>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

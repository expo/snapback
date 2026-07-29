import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import {
  collection,
  disableNetwork,
  enableNetwork,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { auth, db } from "./firebase";

type Issue = {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: number;
  sequence: number;
};

export function App() {
  const offline = useMemo(() => new URLSearchParams(location.search).get("offline") === "1", []);
  const [user, setUser] = useState<User | null>(null);
  const [networkReady, setNetworkReady] = useState(!offline);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [source, setSource] = useState("none");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [offlineTitle, setOfflineTitle] = useState("");

  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useEffect(() => {
    if (!offline) return;
    void disableNetwork(db).then(() => setNetworkReady(true));
  }, [offline]);
  useEffect(() => {
    if (!user || !networkReady) {
      setIssues([]);
      return;
    }
    const list = query(
      collection(db, "issues"),
      where("orgId", "==", "org-primary"),
      orderBy("sequence", "desc"),
      limit(50),
    );
    return onSnapshot(list, { includeMetadataChanges: true }, (snapshot) => {
      setSource(snapshot.metadata.fromCache ? "cache" : "server");
      setPending(snapshot.metadata.hasPendingWrites);
      setIssues(snapshot.docs.map((item: QueryDocumentSnapshot<DocumentData>) => ({
        id: item.id,
        ...(item.data() as Omit<Issue, "id">),
      })));
    }, (cause) => {
      setError(cause.code);
      setIssues([]);
    });
  }, [user, networkReady]);

  async function login() {
    setError("");
    await signInWithEmailAndPassword(auth, "bob@example.test", "CorrectHorseBattery1!");
  }
  async function editOffline() {
    const issue = issues[0];
    if (!issue || !offlineTitle.trim()) return;
    await updateDoc(
      (await import("firebase/firestore")).doc(db, "issues", issue.id),
      {
        title: offlineTitle.trim(),
        revision: increment(1),
        updatedAt: serverTimestamp(),
      },
    );
  }
  async function reconnect() {
    await enableNetwork(db);
  }

  return (
    <div
      className="app-frame"
      data-testid="linear-shell"
      data-issue-count={issues.length}
      data-from-cache={source === "cache"}
      data-pending-writes={pending}
    >
      <aside className="rail">
        <div className="mark">FB</div>
        <button className="rail-button active">Active</button>
        <button className="rail-button">Backlog</button>
        <button className="rail-button">Projects</button>
        <button className="rail-button">Teams</button>
      </aside>
      <main>
        <header className="topbar">
          <div><p className="eyebrow">Firebase deep arm</p><h1>Issue tracker</h1></div>
          <div className="status-row">
            <span className="status" data-testid="auth-state">{user?.email ?? "signed-out"}</span>
            <span className="status" data-testid="snapshot-source">{source}</span>
            <span className="status" data-testid="pending-writes">{String(pending)}</span>
            {user
              ? <button data-testid="logout" onClick={() => signOut(auth)}>Log out</button>
              : <button data-testid="login" onClick={login}>Sign in as Bob</button>}
          </div>
        </header>
        <section className="workspace">
          <div className="panel content-panel">
            <div className="section-heading">
              <div><p className="eyebrow">Platform team</p><h2>Active issues</h2></div>
              <span data-testid="issue-count">{issues.length}</span>
            </div>
            <div className="offline-controls">
              <input
                aria-label="Offline issue title"
                data-testid="offline-title"
                value={offlineTitle}
                onChange={(event) => setOfflineTitle(event.target.value)}
              />
              <button data-testid="offline-edit" onClick={() => void editOffline()}>Edit first issue</button>
              <button data-testid="reconnect" onClick={() => void reconnect()}>Reconnect</button>
            </div>
            {error && <p data-testid="error">{error}</p>}
            <div className="issue-list" data-testid="linear-issue-list">
              {issues.map((issue) => (
                <article
                  className="issue-row"
                  key={issue.id}
                  data-testid={`issue-${issue.id}`}
                  data-issue-id={issue.id}
                >
                  <span className="muted">{issue.identifier}</span>
                  <strong>{issue.title}</strong>
                  <span className="pill">{issue.status}</span>
                  <span>P{issue.priority}</span>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

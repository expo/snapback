import { useEffect, useState } from "react";
import {
  account,
  databaseId,
  progressChannel,
  Query,
  realtime,
  tables,
} from "./appwrite";
import "./styles.css";

type SourceRow = {
  $id: string;
  filename: string;
  sequence: number;
};

export function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [progress, setProgress] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const result = await tables.listRows({
      databaseId,
      tableId: "sources",
      queries: [
        Query.equal("room_id", ["research-main"]),
        Query.orderAsc("sequence"),
        Query.limit(20),
      ],
      total: true,
    });
    setSources(result.rows as unknown as SourceRow[]);
    setReady(true);
  }

  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe(): void } | undefined;
    account.get()
      .then(async () => {
        if (!active) return;
        await load();
        subscription = await realtime.subscribe(progressChannel, (message) => {
          const label = String(message.payload?.label ?? "");
          if (label) setProgress((current) => [...current, label]);
        });
      })
      .catch(() => {});
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  async function signIn() {
    setError("");
    try {
      await account.createEmailPasswordSession({ email, password });
      await load();
      await realtime.subscribe(progressChannel, (message) => {
        const label = String(message.payload?.label ?? "");
        if (label) setProgress((current) => [...current, label]);
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed");
    }
  }

  if (!ready) {
    return (
      <main className="login-card">
        <p className="eyebrow">Appwrite native Auth</p>
        <h1>Research Room</h1>
        <label>Email<input aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input aria-label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button onClick={signIn}>Sign in</button>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  }

  return (
    <div className="shell" data-testid="research-room-shell" data-ready="true">
      <aside>
        <p className="eyebrow">20 sources</p>
        <h2>Backend architecture</h2>
        <ul>{sources.slice(0, 6).map((source) => <li key={source.$id}>{source.filename}</li>)}</ul>
      </aside>
      <main>
        <p className="eyebrow">Shared research room · Appwrite</p>
        <h1>Cancellation safety</h1>
        <article data-testid="research-answer">
          Durable attempt identity and an authoritative cancellation fence prevent late successful patches.
        </article>
        <div data-testid="research-progress" className="progress">
          {progress.length ? progress.join(" → ") : "Waiting for the next authoritative run"}
        </div>
        <p className="citations">[1] Architecture.pdf · [2] Interview notes.md</p>
      </main>
    </div>
  );
}

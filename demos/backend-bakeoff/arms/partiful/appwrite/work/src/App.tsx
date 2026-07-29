import { useCallback, useEffect, useState } from "react";
import {
  account,
  databaseId,
  eventChannel,
  guestChannel,
  Query,
  realtime,
  tables,
  wallChannel,
} from "./appwrite";

type EventRow = { $id: string; title: string; public: boolean; yes_count: number; capacity: number };
type WallRow = { $id: string; body: string; event_id: string };

export default function App() {
  const [user, setUser] = useState<{ $id: string; email: string } | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [walls, setWalls] = useState<WallRow[]>([]);
  const [guestCount, setGuestCount] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [live, setLive] = useState({ events: 0, guests: 0, walls: 0 });

  const refresh = useCallback(async () => {
    const eventResult = await tables.listRows({
      databaseId,
      tableId: "events",
      queries: [Query.orderAsc("sequence"), Query.limit(50)],
      total: true,
    });
    setEvents(eventResult.rows as unknown as EventRow[]);
    if (user) {
      const [guestResult, wallResult] = await Promise.all([
        tables.listRows({
          databaseId,
          tableId: "guests",
          queries: [Query.equal("event_id", ["event-20"]), Query.limit(100)],
          total: true,
        }),
        tables.listRows({
          databaseId,
          tableId: "wall_posts",
          queries: [Query.equal("event_id", ["event-02"]), Query.orderAsc("sequence"), Query.limit(100)],
          total: true,
        }),
      ]);
      setGuestCount(guestResult.total);
      setWalls(wallResult.rows as unknown as WallRow[]);
    }
  }, [user]);

  useEffect(() => {
    account.get().then((next) => setUser({ $id: next.$id, email: next.email })).catch(() => {
      refresh().catch((cause) => setError(cause.message));
    });
  }, []);
  useEffect(() => {
    refresh().catch((cause) => setError(cause.message));
    if (!user) return;
    let subscriptions: Array<{ unsubscribe(): void }> = [];
    (async () => {
      subscriptions.push(await realtime.subscribe(eventChannel, () => {
        setLive((value) => ({ ...value, events: value.events + 1 }));
        refresh().catch(() => {});
      }));
      subscriptions.push(await realtime.subscribe(guestChannel, () => {
        setLive((value) => ({ ...value, guests: value.guests + 1 }));
        refresh().catch(() => {});
      }));
      subscriptions.push(await realtime.subscribe(wallChannel, (message) => {
        setLive((value) => ({ ...value, walls: value.walls + 1 }));
        const payload = message.payload as unknown as WallRow;
        if (payload?.event_id === "event-02") {
          setWalls((value) => value.some((row) => row.$id === payload.$id) ? value : [...value, payload]);
        }
      }));
    })().catch((cause) => setError(cause.message));
    return () => { subscriptions.forEach((subscription) => subscription.unsubscribe()); };
  }, [refresh, user]);

  async function signIn() {
    setError("");
    await account.createEmailPasswordSession({ email, password });
    const next = await account.get();
    setUser({ $id: next.$id, email: next.email });
  }

  async function logout() {
    await realtime.disconnect();
    await account.deleteSession({ sessionId: "current" });
    setUser(null);
    setWalls([]);
    setGuestCount(0);
  }

  const contended = events.find((event) => event.$id === "event-20");
  return (
    <div
      className="shell"
      data-testid="partiful-shell"
      data-ready={user ? "true" : "false"}
      data-event-count={events.length}
      data-guest-count={guestCount}
      data-wall-count={walls.length}
      data-realtime-events={live.events}
      data-realtime-guests={live.guests}
      data-realtime-walls={live.walls}
      data-retained-wall-ids={walls.map((wall) => wall.$id).join(",")}
    >
      <aside>
        <div className="logo">P</div>
        <button className="active">Discover</button>
        <button>My events</button>
        <button>Invitations</button>
      </aside>
      <main>
        <header>
          <div><p className="eyebrow">Appwrite deep arm</p><h1>Party planner</h1></div>
          {user && <button aria-label="Log out" onClick={() => void logout()}>Log out</button>}
        </header>
        {!user ? (
          <>
            <section className="card login">
              <h2>Public events</h2>
              <p data-testid="public-count">{events.length} previews; private controls are never loaded.</p>
              <label>Email<input aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>Password<input aria-label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <button onClick={() => void signIn()}>Sign in</button>
            </section>
          </>
        ) : (
          <section className="card">
            <div className="heading">
              <h2>Summer Roof Party</h2>
              <span data-testid="capacity">{contended?.yes_count ?? 0}/{contended?.capacity ?? 0}</span>
            </div>
            <p data-testid="guest-count">{guestCount} visible guests</p>
            <div className="issues">
              {walls.map((wall) => <article key={wall.$id} data-wall-id={wall.$id}><strong>{wall.body}</strong></article>)}
            </div>
            {error && <p data-testid="error">{error}</p>}
          </section>
        )}
      </main>
    </div>
  );
}

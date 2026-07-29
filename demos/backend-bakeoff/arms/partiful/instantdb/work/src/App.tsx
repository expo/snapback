import { useMemo, useState } from 'react';
import { db } from './db';

function Login() {
  const [token, setToken] = useState('');
  return (
    <section className="login-card">
      <p className="eyebrow">Private invitation</p>
      <h2>Sign in with an arm-issued token</h2>
      <p className="muted">The test target uses Instant’s native refresh-token auth path.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (token.trim()) void db.auth.signInWithToken(token.trim());
        }}
      >
        <input
          aria-label="Instant refresh token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Paste refresh token"
        />
        <button type="submit">Open invitation</button>
      </form>
    </section>
  );
}

function EventCard({ event }: { event: any }) {
  const attending = event.seatClaims?.filter((claim: any) => claim.occupied).length ?? 0;
  return (
    <article className="event-card">
      <div className="art">
        <span>Summer series</span>
        <strong>{new Date(event.startsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong>
      </div>
      <div className="event-body">
        <p className="eyebrow">You’re invited</p>
        <h1>{event.title}</h1>
        <p className="muted">A small rooftop dinner with friends, long-table food, and sunset music.</p>
        <div className="stats">
          <span><b>{attending}</b> going</span>
          <span><b>{Math.max(0, event.capacity - attending)}</b> spots left</span>
        </div>
        {event.privateHostNote && <aside>Host note: {event.privateHostNote}</aside>}
        <div className="wall">
          <h3>Event wall</h3>
          {(event.wallPosts ?? []).slice(-4).map((post: any) => (
            <p key={post.id}><span>Guest</span>{post.body}</p>
          ))}
          {!event.wallPosts?.length && <p className="muted">The wall is quiet for now.</p>}
        </div>
      </div>
    </article>
  );
}

function SignedIn({ user }: { user: any }) {
  const query = useMemo(
    () => ({
      events: {
        $: { where: { slug: 'llp0102-partiful-instantdb-w3-a3-event-01' } },
        seatClaims: {},
        wallPosts: { $: { order: { createdAt: 'asc' as const } } },
        invitations: {},
      },
    }),
    [],
  );
  const { isLoading, error, data } = db.useQuery(query);
  if (isLoading) return <div className="center">Joining the party…</div>;
  if (error) return <div className="center error">{error.message}</div>;
  const event = data?.events?.[0];
  return (
    <>
      <header>
        <div className="brand">gather<span>●</span></div>
        <div className="identity">{user.email}<button onClick={() => db.auth.signOut()}>Sign out</button></div>
      </header>
      <main>{event ? <EventCard event={event} /> : <div className="center">This invitation is not available.</div>}</main>
    </>
  );
}

export default function App() {
  const auth = db.useAuth();
  if (auth.isLoading) return <div className="center">Opening Gather…</div>;
  if (auth.error) return <div className="center error">{auth.error.message}</div>;
  if (!auth.user) {
    return (
      <>
        <header><div className="brand">gather<span>●</span></div><div className="muted">InstantDB bakeoff</div></header>
        <main><Login /></main>
      </>
    );
  }
  return <SignedIn user={auth.user} />;
}

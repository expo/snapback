import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';

const namespace = 'llp0102-partiful-convex-w2';

export function App() {
  const event = useQuery(api.party.publicPreview, { namespace });
  if (event === undefined) return <main className="loading">Finding the party…</main>;
  if (event === null) return <main className="loading">This event isn’t available.</main>;

  return (
    <main>
      <section className="hero">
        <nav>
          <span className="brand">gather</span>
          <span className="badge">Live on Convex</span>
        </nav>
        <div className="art" aria-label="Abstract sunset">
          <div className="sun" />
          <div className="skyline" />
          <p>15 · 08 · 26</p>
        </div>
        <div className="copy">
          <p className="eyebrow">You’re invited</p>
          <h1>{event.title}</h1>
          <p className="lede">{event.publicDescription}</p>
          <div className="facts">
            <article>
              <span>When</span>
              <strong>Saturday, August 15</strong>
              <small>7:00 PM · Pacific time</small>
            </article>
            <article>
              <span>Where</span>
              <strong>{event.venue}</strong>
              <small>Full address after RSVP</small>
            </article>
          </div>
          <button>RSVP to see details</button>
          <p className="privacy">Private notes and the guest list stay protected.</p>
        </div>
      </section>
    </main>
  );
}

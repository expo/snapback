import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DbConnection } from './module_bindings';
import './styles.css';

type Preview = {
  title: string;
  publicDescription: string;
  startsAt: string;
  venue: string;
};

const fallback: Preview = {
  title: 'Summer Rooftop Supper',
  publicDescription: 'Dinner, music, and sunset above the city.',
  startsAt: '2026-08-15T19:00:00-07:00',
  venue: 'Mission Rooftop',
};

function App() {
  const [preview, setPreview] = useState<Preview>(fallback);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const date = useMemo(
    () => new Date(preview.startsAt).toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
    [preview.startsAt],
  );

  useEffect(() => {
    let disposed = false;
    const conn = DbConnection.builder()
      .withUri('ws://127.0.0.1:3332')
      .withDatabaseName('llp0102-partiful-spacetimedb-w2')
      .onConnect((active) => {
        active.subscriptionBuilder()
          .onApplied(() => {
            if (disposed) return;
            const row = Array.from(active.db.publicPreview.iter())[0];
            if (row) setPreview(row);
            setConnection('live');
          })
          .onError(() => !disposed && setConnection('offline'))
          .subscribe(['SELECT * FROM public_preview']);
      })
      .onConnectError(() => !disposed && setConnection('offline'))
      .build();
    return () => {
      disposed = true;
      conn.disconnect();
    };
  }, []);

  return (
    <main>
      <nav>
        <span className="wordmark">gather</span>
        <span className={`status ${connection}`}>
          <i /> {connection === 'live' ? 'Live on SpacetimeDB' : connection}
        </span>
      </nav>
      <section className="hero">
        <div className="sun" />
        <div className="city">
          <span /><span /><span /><span /><span /><span />
        </div>
        <p className="eyebrow">YOU’RE INVITED</p>
        <h1>{preview.title}</h1>
        <p className="lede">{preview.publicDescription}</p>
      </section>
      <section className="details">
        <div className="when">
          <span className="calendar">15</span>
          <div><small>WHEN</small><strong>{date}</strong></div>
        </div>
        <div className="where">
          <span className="pin">⌖</span>
          <div><small>WHERE</small><strong>{preview.venue}</strong><em>San Francisco, California</em></div>
        </div>
        <div className="host">
          <span className="avatar">A</span>
          <div><small>HOSTED BY</small><strong>Alice</strong><em>Sunset enthusiast</em></div>
        </div>
      </section>
      <aside>
        <p>Can you make it?</p>
        <div className="rsvp"><button>Going</button><button>Maybe</button><button>Can’t go</button></div>
        <small>Sign in to RSVP · 3 invited guests</small>
      </aside>
      <footer>
        <span>Private event</span>
        <span>Native identity-aware views · realtime subscriptions</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);

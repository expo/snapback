import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const namespace = 'llp0102-partiful-snapback-w1';
const fallback = {
  title: 'Snapback Summer Night',
  description: 'Music, food, and friends by the bay.',
  startsAt: 1_800_000_000_000,
};

async function publicPreview() {
  const response = await fetch('http://127.0.0.1:3335/query/publicEvents', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-auth-client-protocol': '1',
    },
    body: JSON.stringify({ args: { namespace }, read_set: [] }),
  });
  if (!response.ok) throw new Error(`Snapback public query returned ${response.status}`);
  return (await response.json()).rows;
}

function App() {
  const [events, setEvents] = useState([fallback]);
  const [connection, setConnection] = useState('preview');
  useEffect(() => {
    publicPreview().then((rows) => {
      setEvents(rows);
      setConnection('local target');
    }).catch(() => setConnection('design preview'));
  }, []);
  const event = events[0] ?? fallback;
  const date = new Date(event.startsAt);

  return (
    <main>
      <nav aria-label="Primary">
        <a className="wordmark" href="/">gather<span>✦</span></a>
        <div className="nav-actions">
          <span className="connection"><i />{connection}</span>
          <button className="quiet">My events</button>
          <button className="avatar" aria-label="Open profile">A</button>
        </div>
      </nav>

      <section className="hero" aria-labelledby="event-title">
        <div className="art" aria-label="Event artwork placeholder">
          <div className="sun" />
          <p>SUMMER<br />NIGHT</p>
          <span className="art-note">event art: product GAP</span>
        </div>
        <div className="details">
          <p className="eyebrow">YOU’RE INVITED</p>
          <h1 id="event-title">{event.title}</h1>
          <p className="lede">{event.description}</p>
          <dl>
            <div><dt>When</dt><dd>{date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}<small>7:00 PM · doors at 6:30</small></dd></div>
            <div><dt>Where</dt><dd>San Francisco waterfront<small>Exact location after RSVP</small></dd></div>
            <div><dt>Hosted by</dt><dd><span className="mini-avatar">A</span> Alice &amp; friends</dd></div>
          </dl>
          <div className="rsvp-card">
            <div><strong>Are you going?</strong><span>Reply to see who else is in.</span></div>
            <div className="rsvp-actions">
              <button>Can’t go</button>
              <button>Maybe</button>
              <button className="primary">I’m in</button>
            </div>
          </div>
        </div>
      </section>

      <section className="lower">
        <article>
          <p className="eyebrow">THE PLAN</p>
          <h2>A long-table dinner, two live sets, and a very good sunset.</h2>
        </article>
        <div className="guest-stack" aria-label="Guest preview">
          {['B', 'C', 'D', 'E'].map((letter) => <span key={letter}>{letter}</span>)}
          <strong>+46</strong>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);

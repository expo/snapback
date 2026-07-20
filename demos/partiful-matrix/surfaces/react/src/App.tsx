import { useEffect, useMemo, useState } from 'react';

import {
  PERSONAS,
  formatWhen,
  statusLabel,
  type EventRow,
  type MatrixProvider,
  type Persona,
  type PostRow,
  type QueryName,
  type RsvpRow,
  type RsvpStatus,
} from '../../../shared/model';
import { configuredBackend } from './provider';

type Connection = 'connecting' | 'live' | 'polling' | 'disconnected';
type View = { kind: 'feed' } | { kind: 'event'; id: string };

function useRows<Row>(provider: MatrixProvider, name: QueryName, args: Record<string, unknown>, persona: Persona) {
  const [rows, setRows] = useState<Row[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  const key = JSON.stringify(args);
  useEffect(() => {
    let disposed = false;
    let handle: { dispose(): void } | undefined;
    provider.subscribe<Row>(name, args, persona.userId, (next, state) => {
      if (!disposed) { setRows(next); setConnection(state); }
    }).then((next) => { if (disposed) next.dispose(); else handle = next; });
    return () => { disposed = true; handle?.dispose(); };
  }, [provider, name, key, persona.userId]);
  return { rows, connection };
}

export function App({ provider, initialPersona }: { provider: MatrixProvider; initialPersona: Persona }) {
  const [persona, setPersona] = useState<Persona>(initialPersona);
  const [view, setView] = useState<View>({ kind: 'feed' });
  return (
    <div className="app-shell">
      <header className="nav">
        <button className="brand" data-testid="home" onClick={() => setView({ kind: 'feed' })}>
          <span className="brand-mark">p</span><span>parti<span>time</span></span>
        </button>
        <div className="experiment-badge"><strong>REACT</strong><i />{configuredBackend}</div>
        <div className="persona-switcher" data-testid="persona-switcher">
          {PERSONAS.map((item) => (
            <button key={item.id} data-testid={`persona-${item.id}`} className={persona.id === item.id ? 'persona active' : 'persona'}
              onClick={() => { setPersona(item); setView({ kind: 'feed' }); }} title={`Browse as ${item.name}`}>
              {item.initials}
            </button>
          ))}
        </div>
      </header>
      <main key={`${persona.id}:${view.kind}:${view.kind === 'event' ? view.id : ''}`}>
        {view.kind === 'feed'
          ? <Feed provider={provider} persona={persona} onOpen={(id) => setView({ kind: 'event', id })} />
          : <EventPage provider={provider} persona={persona} eventId={view.id} onBack={() => setView({ kind: 'feed' })} />}
      </main>
    </div>
  );
}

function ConnectionBadge({ value }: { value: Connection }) {
  return <span className={`connection ${value}`} data-testid="connection"><b />{value === 'polling' ? 'polling · 1s' : value}</span>;
}

function Feed({ provider, persona, onOpen }: { provider: MatrixProvider; persona: Persona; onOpen(id: string): void }) {
  const { rows: events, connection } = useRows<EventRow>(provider, 'listEvents', {}, persona);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: '', emoji: '🪩', location: '', description: '' });
  const submit = async () => {
    if (!draft.title.trim() || !draft.location.trim()) return;
    setBusy(true);
    try {
      const id = await provider.mutate<string>('createEvent', {
        ...draft,
        title: draft.title.trim(),
        location: draft.location.trim(),
        startsAt: Date.now() + 3 * 24 * 60 * 60 * 1000,
        hostName: persona.name,
        accent: ['tangerine', 'cobalt', 'orchid'][events.length % 3],
      }, persona.userId);
      onOpen(id);
    } finally { setBusy(false); }
  };
  return (
    <>
      <section className="hero">
        <div className="eyebrow">SAN FRANCISCO · YOUR WEEK AHEAD</div>
        <h1>Make a plan worth<br /><em>leaving the chat for.</em></h1>
        <p>Small gatherings, good people, no algorithmic sludge.</p>
        <div className="hero-actions">
          <button className="primary" data-testid="new-event" onClick={() => setCreating(!creating)}>{creating ? 'Never mind' : '+ Make something happen'}</button>
          <ConnectionBadge value={connection} />
        </div>
      </section>
      {creating && (
        <section className="create-panel" data-testid="create-panel">
          <div><span className="step">01</span><h2>What’s the plan?</h2><p>Keep it loose. You can fill in the poetry later.</p></div>
          <div className="create-grid">
            <input aria-label="Emoji" data-testid="create-emoji" className="emoji-input" value={draft.emoji} onChange={(e) => setDraft({ ...draft, emoji: e.target.value })} />
            <input aria-label="Event title" data-testid="create-title" placeholder="Sunday noodles" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <input aria-label="Location" data-testid="create-location" placeholder="Where are we meeting?" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
            <input aria-label="Description" data-testid="create-description" placeholder="A sentence to set the mood" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            <button className="primary submit" data-testid="create-submit" disabled={busy || !draft.title.trim() || !draft.location.trim()} onClick={submit}>{busy ? 'Making it…' : 'Send the invite ↗'}</button>
          </div>
        </section>
      )}
      <section className="feed-section">
        <div className="section-heading"><div><span className="step">02</span><h2>On the horizon</h2></div><span>{events.length} PLANS</span></div>
        <div className="event-grid" data-testid="feed">
          {events.map((event, index) => <EventCard key={event._id} event={event} index={index} onOpen={() => onOpen(event._id)} />)}
        </div>
      </section>
    </>
  );
}

function EventCard({ event, index, onOpen }: { event: EventRow; index: number; onOpen(): void }) {
  const palette = event.accent || ['tangerine', 'cobalt', 'orchid'][index % 3];
  return (
    <article className={`event-card ${palette}`} data-testid={`event-card-${event._id}`} onClick={onOpen}>
      <div className="card-art"><span>{event.emoji}</span><b>{String(index + 1).padStart(2, '0')}</b><i /></div>
      <div className="card-copy">
        <div className="card-time">{formatWhen(event.startsAt)}</div>
        <h3>{event.title}</h3>
        <p>{event.location}</p>
        <div className="card-footer"><span>HOSTED BY {event.hostName.toUpperCase()}</span><button data-testid={`open-${event._id}`}>View plan →</button></div>
      </div>
    </article>
  );
}

function EventPage({ provider, persona, eventId, onBack }: { provider: MatrixProvider; persona: Persona; eventId: string; onBack(): void }) {
  const { rows: events, connection } = useRows<EventRow>(provider, 'eventDetails', { eventId }, persona);
  const { rows: guests } = useRows<RsvpRow>(provider, 'guestList', { eventId }, persona);
  const { rows: posts } = useRows<PostRow>(provider, 'eventWall', { eventId }, persona);
  const event = events[0];
  const mine = guests.find((guest) => guest.userId === persona.userId);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const respond = async (status: Exclude<RsvpStatus, 'host'>) => {
    setBusy(true);
    try { await provider.mutate('rsvp', { eventId, guestName: persona.name, status }, persona.userId); }
    finally { setBusy(false); }
  };
  const post = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await provider.mutate('postMessage', { eventId, authorName: persona.name, message: draft.trim(), createdAt: Date.now() }, persona.userId);
      setDraft('');
    } finally { setBusy(false); }
  };
  if (!event) return <section className="event-page"><button className="back" onClick={onBack}>← All plans</button><p>Loading the plan…</p></section>;
  const going = guests.filter((guest) => ['host', 'going'].includes(guest.status)).length;
  return (
    <section className="event-page" data-testid="event-page">
      <button className="back" data-testid="back" onClick={onBack}>← All plans</button>
      <div className={`event-hero ${event.accent}`}>
        <div className="event-glyph">{event.emoji}</div>
        <div><div className="eyebrow">{formatWhen(event.startsAt)} · HOSTED BY {event.hostName.toUpperCase()}</div><h1>{event.title}</h1><p>{event.description}</p></div>
        <ConnectionBadge value={connection} />
      </div>
      <div className="event-columns">
        <div className="event-main">
          <div className="where"><span>MEET HERE</span><h2>{event.location}</h2><div className="map-lines" /></div>
          <div className="wall" data-testid="wall"><div className="block-heading"><span>THE WALL</span><strong>{String(posts.length).padStart(2, '0')}</strong></div>
            {posts.map((post) => <div className="post" key={post._id}><b>{post.authorName.slice(0, 1)}</b><p><strong>{post.authorName}</strong>{post.message}</p></div>)}
            <div className="composer"><input data-testid="wall-input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void post(); }} placeholder={`Say something as ${persona.name}…`} /><button data-testid="wall-send" disabled={busy || !draft.trim()} onClick={post}>Send ↗</button></div>
          </div>
        </div>
        <aside className="guest-panel" data-testid="guest-list">
          <div className="block-heading"><span>WHO’S IN</span><strong>{going}</strong></div>
          <div className="rsvp-actions" data-testid="rsvp-actions">
            {mine?.status === 'host' ? <div className="host-note">You’re hosting this one ✦</div> : ['going', 'maybe', 'cant'].map((status) => <button key={status} disabled={busy} className={mine?.status === status ? 'selected' : ''} data-testid={`rsvp-${status}`} onClick={() => respond(status as Exclude<RsvpStatus, 'host'>)}>{statusLabel(status)}</button>)}
          </div>
          <div className="guest-list">{guests.map((guest) => <div className="guest" key={guest._id} data-testid={`guest-${guest.userId}`}><b>{guest.guestName.slice(0, 2).toUpperCase()}</b><span>{guest.guestName}</span><em>{statusLabel(guest.status)}</em></div>)}</div>
          <div className="provider-note"><span>{configuredBackend}</span>{provider.transport === 'push' ? 'streamed live' : 'refreshed every second'}</div>
        </aside>
      </div>
    </section>
  );
}

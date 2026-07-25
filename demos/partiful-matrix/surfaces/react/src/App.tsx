import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useSnapbackQuery } from '../../../../../packages/snapback-react/index.mjs';

import {
  PERSONAS,
  formatWhen,
  statusLabel,
  type Connection,
  type EventRow,
  type MatrixProvider,
  type Persona,
  type PostRow,
  type QueryName,
  type RsvpRow,
  type RsvpStatus,
} from '../../../shared/model';
import { configuredBackend } from './provider';

type View = { kind: 'feed' } | { kind: 'event'; id: string };

function viewFromLocation(): View {
  const eventId = new URLSearchParams(location.search).get('event');
  return eventId ? { kind: 'event', id: eventId } : { kind: 'feed' };
}

function useBrowserView() {
  const [view, setView] = useState<View>(viewFromLocation);
  useEffect(() => {
    const onPopState = () => setView(viewFromLocation());
    addEventListener('popstate', onPopState);
    return () => removeEventListener('popstate', onPopState);
  }, []);
  const navigate = (next: View) => {
    const params = new URLSearchParams(location.search);
    if (next.kind === 'event') params.set('event', next.id);
    else params.delete('event');
    const search = params.toString();
    history.pushState({}, '', `${location.pathname}${search ? `?${search}` : ''}${location.hash}`);
    setView(next);
  };
  return [view, navigate] as const;
}

function useRows<Row>(provider: MatrixProvider, name: QueryName, args: Record<string, unknown>, persona: Persona) {
  const snapshot = useSnapbackQuery<Row>({
    provider,
    name,
    args,
    userId: persona.userId,
    authority: persona.userId,
  });
  return { rows: snapshot.rows, connection: snapshot.connection as Connection };
}

export function App({ provider, initialPersona }: { provider: MatrixProvider; initialPersona: Persona }) {
  const [persona, setPersona] = useState<Persona>(initialPersona);
  const [view, navigate] = useBrowserView();
  const [variant, setVariant] = useState<'warm' | 'night'>(() => new URLSearchParams(location.search).get('theme') === 'night' ? 'night' : 'warm');
  return (
    <div className={`app-shell variant-${variant}`} data-testid="product-shell">
      <header className="nav">
        <button className="brand" data-testid="home" onClick={() => navigate({ kind: 'feed' })}>
          <span className="brand-mark">p</span><span>parti<span>time</span></span>
        </button>
        <div className="experiment-badge"><strong>REACT</strong><i />{configuredBackend}</div>
        <button className="theme-toggle" data-testid="theme-toggle" aria-label="Toggle color theme" onClick={() => setVariant((current) => current === 'warm' ? 'night' : 'warm')}>
          {variant === 'warm' ? 'Night' : 'Warm'}
        </button>
        <div className="persona-switcher" data-testid="persona-switcher">
          {PERSONAS.map((item) => (
            <button key={item.id} data-testid={`persona-${item.id}`} className={persona.id === item.id ? 'persona active' : 'persona'}
              onClick={() => { setPersona(item); navigate({ kind: 'feed' }); }} title={`Browse as ${item.name}`}>
              {item.initials}
            </button>
          ))}
        </div>
      </header>
      <main key={`${persona.id}:${view.kind}:${view.kind === 'event' ? view.id : ''}`}>
        {view.kind === 'feed'
          ? <Feed provider={provider} persona={persona} onOpen={(id) => navigate({ kind: 'event', id })} />
          : <EventPage provider={provider} persona={persona} eventId={view.id} onBack={() => navigate({ kind: 'feed' })} />}
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
  const closeCreating = useCallback(() => setCreating(false), []);
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
      <CreateEventDialog open={creating} busy={busy} draft={draft} setDraft={setDraft} onClose={closeCreating} onSubmit={submit} />
      <section className="feed-section">
        <div className="section-heading"><div><span className="step">02</span><h2>On the horizon</h2></div><span>{events.length} PLANS</span></div>
        <div className="event-grid" data-testid="feed">
          {events.map((event, index) => <EventCard key={event._id} event={event} index={index} onOpen={() => onOpen(event._id)} />)}
        </div>
      </section>
    </>
  );
}

function CreateEventDialog({ open, busy, draft, setDraft, onClose, onSubmit }: {
  open: boolean;
  busy: boolean;
  draft: { title: string; emoji: string; location: string; description: string };
  setDraft(value: { title: string; emoji: string; location: string; description: string }): void;
  onClose(): void;
  onSubmit(): Promise<void>;
}) {
  const panel = useRef<HTMLElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const locationInput = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState({ title: false, location: false });
  const titleError = !draft.title.trim() ? 'Event title is required.' : '';
  const locationError = !draft.location.trim() ? 'Location is required.' : '';
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => titleInput.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    addEventListener('keydown', onKeyDown);
    return () => {
      removeEventListener('keydown', onKeyDown);
      queueMicrotask(() => { if (opener?.isConnected) opener.focus(); });
    };
  }, [open, onClose]);
  if (!open) return null;
  const submit = async () => {
    setTouched({ title: true, location: true });
    if (titleError) { titleInput.current?.focus(); return; }
    if (locationError) { locationInput.current?.focus(); return; }
    await onSubmit();
  };
  return createPortal(
    <div className="create-overlay" data-testid="create-overlay">
      <button className="create-backdrop" aria-label="Close create event" data-testid="create-backdrop" onClick={onClose} />
      <section ref={panel} className="create-panel" data-testid="create-panel" role="dialog" aria-modal="true" aria-labelledby="create-title-heading" aria-describedby="create-description-copy">
        <div><span className="step">01</span><h2 id="create-title-heading">What’s the plan?</h2><p id="create-description-copy">A title and location are required.</p></div>
        <button className="dialog-close" data-testid="create-close" aria-label="Close create event" onClick={onClose}>Close</button>
        <div className="create-grid">
          <input aria-label="Emoji" data-testid="create-emoji" className="emoji-input" value={draft.emoji} onChange={(e) => setDraft({ ...draft, emoji: e.target.value })} />
          <label>Event title<input ref={titleInput} aria-invalid={Boolean(touched.title && titleError)} aria-describedby={touched.title && titleError ? 'create-title-error' : undefined} data-testid="create-title" placeholder="Sunday noodles" value={draft.title} onBlur={() => setTouched({ ...touched, title: true })} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          {touched.title && titleError && <span id="create-title-error" role="alert" data-testid="create-title-error">{titleError}</span>}
          <label>Location<input ref={locationInput} aria-invalid={Boolean(touched.location && locationError)} aria-describedby={touched.location && locationError ? 'create-location-error' : undefined} data-testid="create-location" placeholder="Where are we meeting?" value={draft.location} onBlur={() => setTouched({ ...touched, location: true })} onChange={(e) => setDraft({ ...draft, location: e.target.value })} /></label>
          {touched.location && locationError && <span id="create-location-error" role="alert" data-testid="create-location-error">{locationError}</span>}
          <label className="description-field">Description<textarea aria-label="Description" data-testid="create-description" rows={4} placeholder="A sentence to set the mood" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
          <button className="primary submit" data-testid="create-submit" disabled={busy} aria-disabled={busy} onClick={() => void submit()}>{busy ? 'Making it…' : 'Send the invite ↗'}</button>
        </div>
      </section>
    </div>, document.body,
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
      await provider.mutate('postMessage', { eventId, authorName: persona.name, message: draft.trim() }, persona.userId);
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
          <VirtualGuestList guests={guests} />
          <div className="provider-note"><span>{configuredBackend}</span>{provider.transport === 'push' ? 'streamed live' : 'refreshed every second'}</div>
        </aside>
      </div>
    </section>
  );
}

function VirtualGuestList({ guests }: { guests: readonly RsvpRow[] }) {
  const itemHeight = 52;
  const viewportHeight = 300;
  const [scrollTop, setScrollTop] = useState(0);
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - 1);
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + 2;
  const visible = guests.slice(start, start + visibleCount);
  return <div className="guest-list virtual-guests" data-testid="virtual-guest-list" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
    <div style={{ height: guests.length * itemHeight, position: 'relative' }}>
      {visible.map((guest, index) => <div className="guest" key={guest._id} data-testid={`guest-${guest.userId}`} style={{ position: 'absolute', top: (start + index) * itemHeight, left: 0, right: 0, height: itemHeight }}><b>{guest.guestName.slice(0, 2).toUpperCase()}</b><span>{guest.guestName}</span><em>{statusLabel(guest.status)}</em></div>)}
    </div>
  </div>;
}

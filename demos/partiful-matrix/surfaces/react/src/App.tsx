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

type View = { kind: 'feed' } | { kind: 'create' } | { kind: 'event'; id: string };

function basePathFromLocation(): string {
  const marker = '/events/';
  const at = location.pathname.indexOf(marker);
  const base = at >= 0 ? location.pathname.slice(0, at + 1) : location.pathname;
  return base.endsWith('/') ? base : `${base}/`;
}

function viewFromLocation(): View {
  const base = basePathFromLocation();
  const relative = location.pathname.startsWith(base)
    ? location.pathname.slice(base.length)
    : location.pathname.replace(/^\//, '');
  const route = relative.match(/^events\/([^/]+)\/?$/);
  if (route?.[1] === 'new') return { kind: 'create' };
  if (route?.[1]) return { kind: 'event', id: decodeURIComponent(route[1]) };
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
    params.delete('event');
    params.delete('uiState');
    const search = params.toString();
    const base = basePathFromLocation();
    const pathname = next.kind === 'event'
      ? `${base}events/${encodeURIComponent(next.id)}/`
      : next.kind === 'create'
        ? `${base}events/new/`
        : base;
    history.pushState({}, '', `${pathname}${search ? `?${search}` : ''}${location.hash}`);
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
  useEffect(() => {
    document.body.dataset.partitimeTheme = variant;
    return () => { delete document.body.dataset.partitimeTheme; };
  }, [variant]);
  const returnToFeed = () => {
    navigate({ kind: 'feed' });
    setTimeout(() => document.querySelector<HTMLElement>('[data-testid="create-event"]')?.focus(), 0);
  };
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
      <main key={`${persona.id}:${view.kind === 'event' ? `event:${view.id}` : 'feed'}`}>
        {view.kind !== 'event'
          ? <Feed provider={provider} persona={persona} creating={view.kind === 'create'} onCreateOpen={() => navigate({ kind: 'create' })} onCreateClose={() => navigate({ kind: 'feed' })} onOpen={(id) => navigate({ kind: 'event', id })} />
          : <EventPage provider={provider} persona={persona} eventId={view.id} onBack={returnToFeed} />}
      </main>
    </div>
  );
}

function ConnectionBadge({ value }: { value: Connection }) {
  return <span className={`connection ${value}`} data-testid="connection"><b />{value === 'polling' ? 'polling · 1s' : value}</span>;
}

function Feed({ provider, persona, creating, onCreateOpen, onCreateClose, onOpen }: {
  provider: MatrixProvider;
  persona: Persona;
  creating: boolean;
  onCreateOpen(): void;
  onCreateClose(): void;
  onOpen(id: string): void;
}) {
  const { rows: events, connection } = useRows<EventRow>(provider, 'listEvents', {}, persona);
  const uiState = new URLSearchParams(location.search).get('uiState');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: '', emoji: '🪩', when: 'Next Saturday, 6:00 PM', location: '', description: '' });
  const closeCreating = useCallback(() => onCreateClose(), [onCreateClose]);
  const submit = async () => {
    if (!draft.title.trim() || !draft.location.trim()) return;
    setBusy(true);
    try {
      const id = await provider.mutate<string>('createEvent', {
        emoji: draft.emoji,
        description: draft.description,
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
          <button className="primary" data-testid="create-event" onClick={creating ? onCreateClose : onCreateOpen}>{creating ? 'Never mind' : '+ Make something happen'}</button>
          <ConnectionBadge value={connection} />
        </div>
      </section>
      <CreateEventDialog open={creating} busy={busy} draft={draft} setDraft={setDraft} onClose={closeCreating} onSubmit={submit} />
      <section className="feed-section">
        <div className="section-heading"><div><span className="step">02</span><h2>On the horizon</h2></div><span>{events.length} PLANS</span></div>
        <div className="event-grid" data-testid="feed">
          {uiState === 'feed-loading'
            ? [0, 1, 2].map((index) => <article className="event-card skeleton-card" data-testid={index === 0 ? 'feed-loading' : undefined} aria-busy="true" key={index}><div className="skeleton-block" /><div className="skeleton-lines"><i /><i /><i /></div></article>)
            : uiState === 'feed-empty' || events.length === 0
              ? <section className="feed-empty" data-testid="feed-empty"><h3>No plans yet.</h3><p>Make something happen when the group chat needs a destination.</p></section>
              : events.map((event, index) => <EventCard key={event._id} event={event} index={index} onOpen={() => onOpen(event._id)} />)}
        </div>
      </section>
    </>
  );
}

function CreateEventDialog({ open, busy, draft, setDraft, onClose, onSubmit }: {
  open: boolean;
  busy: boolean;
  draft: { title: string; emoji: string; when: string; location: string; description: string };
  setDraft(value: { title: string; emoji: string; when: string; location: string; description: string }): void;
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
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
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
        <form className="create-grid" data-testid="create-event-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {touched.title && titleError && <div className="form-error-summary" role="alert" data-testid="form-error-summary">Please fix the highlighted event details.</div>}
          <input aria-label="Emoji" data-testid="create-emoji" className="emoji-input" value={draft.emoji} onChange={(e) => setDraft({ ...draft, emoji: e.target.value })} />
          <label>Event title<input ref={titleInput} aria-invalid={Boolean(touched.title && titleError)} aria-describedby={touched.title && titleError ? 'event-title-error' : undefined} data-testid="event-title" placeholder="Sunday noodles" value={draft.title} onBlur={() => setTouched({ ...touched, title: true })} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          {touched.title && titleError && <span id="event-title-error" role="alert" data-testid="event-title-error">{titleError}</span>}
          <label className="when-field">When<input aria-label="When" data-testid="event-when" value={draft.when} onChange={(e) => setDraft({ ...draft, when: e.target.value })} /></label>
          <label>Location<input ref={locationInput} aria-invalid={Boolean(touched.location && locationError)} aria-describedby={touched.location && locationError ? 'event-location-error' : undefined} data-testid="event-location" placeholder="Where are we meeting?" value={draft.location} onBlur={() => setTouched({ ...touched, location: true })} onChange={(e) => setDraft({ ...draft, location: e.target.value })} /></label>
          {touched.location && locationError && <span id="event-location-error" role="alert" data-testid="event-location-error">{locationError}</span>}
          <label className="description-field">Description<textarea aria-label="Description" data-testid="event-description" rows={4} placeholder="A sentence to set the mood" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
          <button type="submit" className="primary submit" data-testid="create-event-submit" disabled={busy} aria-disabled={busy}>{busy ? 'Making it…' : 'Send the invite ↗'}</button>
        </form>
      </section>
    </div>, document.body,
  );
}

function FocusOverlay({ open, title, description, testId, panelClassName = '', initialFocusTestId, onClose, children }: {
  open: boolean;
  title: string;
  description: string;
  testId: string;
  panelClassName?: string;
  initialFocusTestId: string;
  onClose(): void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => panel.current?.querySelector<HTMLElement>(`[data-testid="${initialFocusTestId}"]`)?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
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
  }, [initialFocusTestId, onClose, open]);
  if (!open) return null;
  const headingId = `${testId}-heading`;
  const descriptionId = `${testId}-description`;
  return createPortal(
    <div className="product-overlay" data-testid={`${testId}-overlay`}>
      <button className="create-backdrop" data-testid={`${testId}-backdrop`} aria-label={`Close ${title}`} onClick={onClose} />
      <section ref={panel} className={`product-overlay-panel ${panelClassName}`} data-testid={testId} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={descriptionId}>
        <h2 id={headingId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        {children}
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
  const [eventFailed, setEventFailed] = useState(() => new URLSearchParams(location.search).get('uiState') === 'event-error');
  const [guestSheetOpen, setGuestSheetOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [pendingRsvp, setPendingRsvp] = useState<Exclude<RsvpStatus, 'host'> | null>(null);
  const [pendingPost, setPendingPost] = useState<string | null>(() => new URLSearchParams(location.search).get('uiState') === 'wall-pending' ? 'Visual pending message' : null);
  const optionsMenu = useRef<HTMLDivElement>(null);
  const respond = async (status: Exclude<RsvpStatus, 'host'>) => {
    setBusy(true);
    try { await provider.mutate('rsvp', { eventId, guestName: persona.name, status }, persona.userId); }
    finally { setBusy(false); }
  };
  const post = async () => {
    if (!draft.trim()) return;
    const message = draft.trim();
    setPendingPost(message);
    setDraft('');
    setBusy(true);
    try {
      await provider.mutate('postMessage', { eventId, authorName: persona.name, message }, persona.userId);
      await new Promise((resolve) => setTimeout(resolve, 450));
    } finally { setBusy(false); setPendingPost(null); }
  };
  const confirmRsvp = async () => {
    if (!pendingRsvp) return;
    const status = pendingRsvp;
    setPendingRsvp(null);
    await respond(status);
  };
  const onOptionsKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...(optionsMenu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const next = event.key === 'ArrowDown' ? (current + 1) % items.length
      : event.key === 'ArrowUp' ? (current - 1 + items.length) % items.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
    if (next !== null) { event.preventDefault(); items[next]?.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); setOptionsOpen(false); document.querySelector<HTMLElement>('[data-testid="event-options-trigger"]')?.focus(); }
  };
  if (eventFailed) return <section className="event-page" data-testid="event-page">
    <button className="back" data-testid="back" onClick={onBack}>← All plans</button>
    <div className="event-error" data-testid="event-error" role="alert"><h1>We couldn’t load this plan.</h1><p>The event route is still here. Try the event query again.</p><button data-testid="event-retry" onClick={() => setEventFailed(false)}>Try again</button></div>
  </section>;
  if (!event) return <section className="event-page"><button className="back" onClick={onBack}>← All plans</button><p>Loading the plan…</p></section>;
  const going = guests.filter((guest) => ['host', 'going'].includes(guest.status)).length;
  return (
    <section className="event-page" data-testid="event-page">
      <div className="event-toolbar"><button className="back" data-testid="back" onClick={onBack}>← All plans</button><div className="event-options"><button data-testid="event-options-trigger" aria-haspopup="menu" aria-expanded={optionsOpen} onClick={() => setOptionsOpen((open) => !open)}>Event options</button>{optionsOpen && <div ref={optionsMenu} className="event-options-menu" data-testid="event-options-menu" role="menu" aria-label="Event options" onKeyDown={onOptionsKeyDown}><button role="menuitem" data-testid="event-options-first-item" autoFocus>Copy invite link</button><button role="menuitem">Add to calendar</button><button role="menuitem">Mute updates</button></div>}</div></div>
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
            {pendingPost && <div className="post pending" data-testid="wall-pending-row"><b>{persona.name.slice(0, 1)}</b><p><strong>{persona.name}</strong>{pendingPost}<span role="status" data-testid="wall-pending-status">Sending…</span></p></div>}
            <form className="composer" data-testid="wall-composer" onSubmit={(event) => { event.preventDefault(); void post(); }}><label className="sr-only" htmlFor="wall-message">Message</label><input id="wall-message" data-testid="wall-message" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Say something as ${persona.name}…`} /><button type="submit" data-testid="wall-submit" disabled={busy || !draft.trim()}>Send ↗</button></form>
          </div>
        </div>
        <aside className="guest-panel" data-testid="guest-list">
          <div className="block-heading"><span>WHO’S IN</span><strong>{going}</strong></div>
          <button className="guest-list-trigger" data-testid="guest-list-trigger" onClick={() => setGuestSheetOpen(true)}>Open guest list</button>
          <div className="rsvp-actions" data-testid="rsvp-actions">
            {mine?.status === 'host' ? <div className="host-note">You’re hosting this one ✦</div> : <div role="radiogroup" aria-label="RSVP" className="rsvp-choice-group">{['going', 'maybe', 'cant'].map((status) => <button role="radio" aria-checked={mine?.status === status} key={status} disabled={busy} className={mine?.status === status ? 'selected' : ''} data-testid={`rsvp-${status}`} onClick={() => respond(status as Exclude<RsvpStatus, 'host'>)}>{statusLabel(status)}</button>)}</div>}
          </div>
          {mine?.status !== 'host' && <button className="rsvp-confirm-trigger" data-testid="rsvp-trigger" onClick={() => setPendingRsvp(mine?.status === 'going' ? 'maybe' : 'going')}>Confirm an RSVP change…</button>}
          <VirtualGuestList guests={guests} idPrefix="guest-panel" testId="virtual-guest-list" itemTestPrefix="guest" />
          <div className="provider-note"><span>{configuredBackend}</span>{provider.transport === 'push' ? 'streamed live' : 'refreshed every second'}</div>
        </aside>
      </div>
      <FocusOverlay open={guestSheetOpen} title="Guest list" description={`${going} people are going.`} testId="guest-list-sheet" panelClassName="guest-sheet" initialFocusTestId="guest-sheet-close" onClose={() => setGuestSheetOpen(false)}>
        <button data-testid="guest-sheet-close" onClick={() => setGuestSheetOpen(false)}>Close guest list</button>
        <VirtualGuestList guests={guests} idPrefix="guest-sheet" testId="guest-sheet-list" itemTestPrefix="guest-sheet" />
      </FocusOverlay>
      <FocusOverlay open={pendingRsvp !== null} title="Confirm RSVP" description={`Change your RSVP to ${pendingRsvp ? statusLabel(pendingRsvp) : ''}?`} testId="rsvp-confirm-dialog" initialFocusTestId="rsvp-confirm" onClose={() => setPendingRsvp(null)}>
        <div className="confirm-actions"><button data-testid="rsvp-cancel" onClick={() => setPendingRsvp(null)}>Cancel</button><button data-testid="rsvp-confirm" onClick={() => void confirmRsvp()}>Confirm</button></div>
      </FocusOverlay>
    </section>
  );
}

function VirtualGuestList({ guests, idPrefix = 'guest-panel', testId = 'virtual-guest-list', itemTestPrefix = 'guest' }: { guests: readonly RsvpRow[]; idPrefix?: string; testId?: string; itemTestPrefix?: string }) {
  const itemHeight = 52;
  const viewportHeight = 300;
  const [scrollTop, setScrollTop] = useState(0);
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - 1);
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + 2;
  const visible = guests.slice(start, start + visibleCount);
  const active = Math.min(guests.length - 1, Math.max(0, Math.round(scrollTop / itemHeight)));
  const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || guests.length === 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? guests.length - 1 : Math.min(guests.length - 1, Math.max(0, active + (event.key === 'ArrowDown' ? 1 : -1)));
    setScrollTop(next * itemHeight);
    event.currentTarget.scrollTop = next * itemHeight;
  };
  return <div className="guest-list virtual-guests" data-testid={testId} role="listbox" aria-label="Event guests" aria-activedescendant={guests[active] ? `${idPrefix}-${guests[active]._id}` : undefined} tabIndex={0} onKeyDown={move} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
    <div style={{ height: guests.length * itemHeight, position: 'relative' }}>
      {visible.map((guest, index) => <div className="guest" id={`${idPrefix}-${guest._id}`} role="option" aria-selected={start + index === active} key={guest._id} data-testid={`${itemTestPrefix}-${guest.userId}`} style={{ position: 'absolute', top: (start + index) * itemHeight, left: 0, right: 0, height: itemHeight }}><b>{guest.guestName.slice(0, 2).toUpperCase()}</b><span>{guest.guestName}</span><em>{statusLabel(guest.status)}</em></div>)}
    </div>
  </div>;
}

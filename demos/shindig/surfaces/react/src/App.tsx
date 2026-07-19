// Shindig — a Partiful-shaped events app on Snapback.
//
// Product shape (mirrors the headless acceptance claims):
// - The feed is your invites/seats (myFeed live query) rendered as cards.
// - You RSVP straight from the card; the first response seats you as a guest
//   through the membership declaration's self-insert transition.
// - The event page (details, guest list, wall) is members-only: the server
//   denies it until you've responded, so the UI renders a locked card —
//   honest, like the server, rather than pretending data is loading.

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';

import type { SnapbackClient } from '../../../../_kit/client.mjs';
import api from '../../../snapback/generated/api.mjs';
import { useLiveRows, type ConnectionAxis } from './useLiveRows';

export interface Persona {
  id: string;
  userId: string;
  name: string;
  hue: number;
}

export const PERSONAS: Persona[] = [
  { id: 'ada', userId: 'user_ada', name: 'Ada', hue: 265 },
  { id: 'grace', userId: 'user_grace', name: 'Grace', hue: 330 },
  { id: 'eve', userId: 'user_eve', name: 'Eve', hue: 180 },
];

interface InviteRow {
  _id: string;
  eventId: string;
  userId: string;
  guestName: string;
  status: 'host' | 'invited' | 'going' | 'maybe' | 'cant';
  note?: string;
  eventTitle: string;
  eventEmoji: string;
  eventStartsAt: number;
  hostName: string;
}

interface PostRow {
  _id: string;
  authorName: string;
  message: string;
  _createdAt: number;
}

interface EventRow {
  _id: string;
  title: string;
  emoji: string;
  description: string;
  location: string;
  startsAt: number;
  hostName: string;
}

type View = { kind: 'feed' } | { kind: 'create' } | { kind: 'event'; eventId: string };

const STATUS_LABELS: Record<InviteRow['status'], string> = {
  host: 'Hosting',
  invited: 'Invited',
  going: 'Going',
  maybe: 'Maybe',
  cant: "Can't go",
};

const fmtWhen = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function App({ client, initialUserId }: { client: SnapbackClient; initialUserId: string }) {
  const [userId, setUserId] = useState(initialUserId);
  const persona = PERSONAS.find((p) => p.userId === userId) ?? PERSONAS[0];
  const [view, setView] = useState<View>({ kind: 'feed' });

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <button type="button" style={styles.wordmark} onClick={() => setView({ kind: 'feed' })} data-testid="home">
          Shindig 🎈
        </button>
        <div style={styles.switcher} data-testid="persona-switcher">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              type="button"
              data-testid={`persona-${p.id}`}
              onClick={() => {
                setUserId(p.userId);
                setView({ kind: 'feed' });
              }}
              style={{
                ...styles.personaChip,
                background: `hsl(${p.hue} 60% ${p.userId === userId ? 42 : 18}% / ${p.userId === userId ? 1 : 0.6})`,
                outline: p.userId === userId ? '2px solid #fff' : 'none',
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </header>
      {/* Key the whole tree by persona: switching users drops every live
          subscription and re-binds under the new principal. */}
      <main key={persona.userId} style={styles.main}>
        {view.kind === 'feed' && (
          <Feed
            client={client}
            persona={persona}
            onOpen={(eventId) => setView({ kind: 'event', eventId })}
            onCreate={() => setView({ kind: 'create' })}
          />
        )}
        {view.kind === 'create' && (
          <CreateEvent
            client={client}
            persona={persona}
            onDone={(eventId) => setView({ kind: 'event', eventId })}
            onCancel={() => setView({ kind: 'feed' })}
          />
        )}
        {view.kind === 'event' && (
          <EventPage client={client} persona={persona} eventId={view.eventId} onBack={() => setView({ kind: 'feed' })} />
        )}
      </main>
    </div>
  );
}

function ConnectionBadge({ connection }: { connection: ConnectionAxis }) {
  const palette: Record<ConnectionAxis, string> = {
    connecting: '#b9a24a',
    live: '#3ecf8e',
    stale: '#e0913f',
    disconnected: '#d05555',
  };
  return (
    <span data-testid="connection" style={{ ...styles.connBadge, color: palette[connection] }}>
      ● {connection}
    </span>
  );
}

function RsvpButtons({
  invite,
  busy,
  onRsvp,
}: {
  invite: InviteRow;
  busy: boolean;
  onRsvp: (status: 'going' | 'maybe' | 'cant') => void;
}) {
  const options: Array<['going' | 'maybe' | 'cant', string]> = [
    ['going', '🎉 Going'],
    ['maybe', '🤔 Maybe'],
    ['cant', "😢 Can't"],
  ];
  return (
    <div style={styles.rsvpRow}>
      {options.map(([status, label]) => (
        <button
          key={status}
          type="button"
          data-testid={`rsvp-${status}`}
          disabled={busy}
          onClick={() => onRsvp(status)}
          style={{
            ...styles.rsvpButton,
            background: invite.status === status ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
            borderColor: invite.status === status ? '#fff' : 'rgba(255,255,255,0.25)',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Feed({
  client,
  persona,
  onOpen,
  onCreate,
}: {
  client: SnapbackClient;
  persona: Persona;
  onOpen: (eventId: string) => void;
  onCreate: () => void;
}) {
  const feed = useLiveRows<InviteRow>(client, api.myFeed, { userId: persona.userId });
  const [busy, setBusy] = useState(false);

  const rsvp = useCallback(
    async (eventId: string, status: 'going' | 'maybe' | 'cant') => {
      setBusy(true);
      try {
        await client.mutate(api.rsvp, { args: { eventId, status }, userId: persona.userId } as never);
      } catch (error) {
        console.error('[shindig] rsvp failed', error);
      } finally {
        setBusy(false);
      }
    },
    [client, persona.userId],
  );

  return (
    <section>
      <div style={styles.feedTop}>
        <h1 style={styles.h1}>Your shindigs</h1>
        <ConnectionBadge connection={feed.connection} />
        <button type="button" style={styles.primaryButton} onClick={onCreate} data-testid="new-event">
          + Throw a party
        </button>
      </div>
      {feed.rows.length === 0 && (
        <p style={styles.empty} data-testid="feed-empty">
          Nothing yet. Throw a party, or get yourself invited to one —
          switch personas up top to see someone else's feed.
        </p>
      )}
      <div style={styles.cardGrid}>
        {feed.rows.map((invite) => (
          <article key={invite._id} style={styles.card} data-testid={`feed-card-${invite.eventId}`}>
            <div style={styles.cardEmoji}>{invite.eventEmoji}</div>
            <h2 style={styles.cardTitle}>{invite.eventTitle}</h2>
            <div style={styles.cardMeta}>
              {fmtWhen(invite.eventStartsAt)} · hosted by {invite.hostName}
            </div>
            <div style={styles.statusPill} data-testid="card-status">
              {STATUS_LABELS[invite.status]}
            </div>
            {invite.status === 'host' ? (
              <button type="button" style={styles.secondaryButton} onClick={() => onOpen(invite.eventId)}>
                Manage party →
              </button>
            ) : (
              <>
                <RsvpButtons invite={invite} busy={busy} onRsvp={(status) => void rsvp(invite.eventId, status)} />
                {invite.status === 'invited' ? (
                  <div style={styles.lockedHint}>RSVP to see the details 🔒</div>
                ) : (
                  <button type="button" style={styles.secondaryButton} onClick={() => onOpen(invite.eventId)}>
                    Open →
                  </button>
                )}
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function CreateEvent({
  client,
  persona,
  onDone,
  onCancel,
}: {
  client: SnapbackClient;
  persona: Persona;
  onDone: (eventId: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState('🪩');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [when, setWhen] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const startsAt = when ? new Date(when).getTime() : NaN;
    if (!title.trim() || !location.trim() || Number.isNaN(startsAt)) {
      setError('Give it a name, a place, and a time.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = (await client.mutate(api.createEvent, {
        args: { title: title.trim(), emoji, description, location: location.trim(), startsAt, hostName: persona.name },
        userId: persona.userId,
      } as never)) as { result: string };
      onDone(created.result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'could not create the event');
      setBusy(false);
    }
  };

  return (
    <section style={styles.formCard}>
      <h1 style={styles.h1}>Throw a party</h1>
      <div style={styles.formRow}>
        <input style={{ ...styles.input, width: '4.5rem', textAlign: 'center', fontSize: 28 }} value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label="Event emoji" data-testid="create-emoji" />
        <input style={{ ...styles.input, flex: 1 }} placeholder="What's the occasion?" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="create-title" />
      </div>
      <textarea style={{ ...styles.input, minHeight: '4.5rem', resize: 'vertical' }} placeholder="Tell people what to expect…" value={description} onChange={(e) => setDescription(e.target.value)} data-testid="create-description" />
      <div style={styles.formRow}>
        <input style={{ ...styles.input, flex: 1 }} placeholder="Where?" value={location} onChange={(e) => setLocation(e.target.value)} data-testid="create-location" />
        <input style={styles.input} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} data-testid="create-when" />
      </div>
      {error && <p style={styles.errorText}>{error}</p>}
      <div style={styles.formRow}>
        <button type="button" style={styles.primaryButton} disabled={busy} onClick={() => void submit()} data-testid="create-submit">
          Send it 🎈
        </button>
        <button type="button" style={styles.secondaryButton} onClick={onCancel}>
          Never mind
        </button>
      </div>
    </section>
  );
}

function EventPage({
  client,
  persona,
  eventId,
  onBack,
}: {
  client: SnapbackClient;
  persona: Persona;
  eventId: string;
  onBack: () => void;
}) {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [locked, setLocked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Members-only point read. A role denial is a product state (locked), not a
  // failure — the server's invariant denial is what makes the lock honest.
  useEffect(() => {
    let cancelled = false;
    setEvent(null);
    setLocked(false);
    setLoadError(null);
    (client.query as (ref: unknown, options: unknown) => Promise<{ rows: EventRow[] }>)(api.getEvent, {
      args: { eventId },
      userId: persona.userId,
    })
      .then((result) => {
        if (!cancelled) setEvent(result.rows[0] ?? null);
      })
      .catch((cause: { diagnostic?: { code?: string }; message?: string }) => {
        if (cancelled) return;
        if (cause.diagnostic?.code === 'SNAPBACK_AUTH_PERMISSION_DENIED') setLocked(true);
        else setLoadError(cause.diagnostic?.code ?? cause.message ?? 'failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [client, eventId, persona.userId]);

  const guests = useLiveRows<InviteRow>(client, api.guestList, {
    args: { eventId },
    userId: persona.userId,
    skip: locked,
  });
  const wall = useLiveRows<PostRow>(client, api.eventWall, {
    args: { eventId },
    userId: persona.userId,
    skip: locked,
  });

  const myCard = guests.rows.find((row) => row.userId === persona.userId);
  const isHost = myCard?.status === 'host';

  if (locked) {
    return (
      <section style={styles.formCard} data-testid="event-locked">
        <h1 style={styles.h1}>🔒 Members only</h1>
        <p style={styles.empty}>RSVP from your feed to unlock the details, the guest list, and the wall.</p>
        <button type="button" style={styles.secondaryButton} onClick={onBack}>← Back</button>
      </section>
    );
  }
  if (loadError) {
    return (
      <section style={styles.formCard}>
        <p style={styles.errorText}>{loadError}</p>
        <button type="button" style={styles.secondaryButton} onClick={onBack}>← Back</button>
      </section>
    );
  }
  if (event === null) {
    return <p style={styles.empty}>Loading…</p>;
  }

  return (
    <section data-testid="event-page">
      <button type="button" style={styles.backLink} onClick={onBack}>← All shindigs</button>
      <div style={styles.eventHero}>
        <div style={{ fontSize: 64 }}>{event.emoji}</div>
        <div>
          <h1 style={{ ...styles.h1, marginBottom: 4 }}>{event.title}</h1>
          <div style={styles.cardMeta}>
            {fmtWhen(event.startsAt)} · {event.location} · hosted by {event.hostName}
          </div>
        </div>
        <ConnectionBadge connection={guests.connection} />
      </div>
      {event.description && <p style={styles.description}>{event.description}</p>}

      <div style={styles.columns}>
        <GuestList guests={guests.rows} />
        <Wall client={client} persona={persona} eventId={eventId} posts={wall.rows} />
      </div>

      {isHost && <InviteForm client={client} persona={persona} eventId={eventId} guests={guests.rows} />}
    </section>
  );
}

function GuestList({ guests }: { guests: InviteRow[] }) {
  const order: InviteRow['status'][] = ['host', 'going', 'maybe', 'invited', 'cant'];
  const sorted = [...guests].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  const going = guests.filter((g) => g.status === 'going' || g.status === 'host').length;
  return (
    <div style={styles.panel} data-testid="guest-list">
      <h3 style={styles.panelTitle}>Guest list · {going} going</h3>
      {sorted.map((guest) => (
        <div key={guest._id} style={styles.guestRow} data-testid={`guest-${guest.userId}`}>
          <span>{guest.guestName}</span>
          <span style={styles.guestStatus}>{STATUS_LABELS[guest.status]}{guest.note ? ` — “${guest.note}”` : ''}</span>
        </div>
      ))}
    </div>
  );
}

function Wall({
  client,
  persona,
  eventId,
  posts,
}: {
  client: SnapbackClient;
  persona: Persona;
  eventId: string;
  posts: PostRow[];
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const post = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await client.mutate(api.postToWall, {
        args: { eventId, message: draft.trim(), authorName: persona.name },
        userId: persona.userId,
      } as never);
      setDraft('');
    } catch (error) {
      console.error('[shindig] post failed', error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.panel} data-testid="wall">
      <h3 style={styles.panelTitle}>The wall</h3>
      {posts.length === 0 && <p style={styles.empty}>Quiet so far. Say something.</p>}
      {posts.map((p) => (
        <div key={p._id} style={styles.postRow}>
          <strong>{p.authorName}</strong> {p.message}
        </div>
      ))}
      <div style={styles.formRow}>
        <input
          style={{ ...styles.input, flex: 1 }}
          placeholder="Post to the wall…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void post();
          }}
          data-testid="wall-input"
        />
        <button type="button" style={styles.primaryButton} disabled={busy} onClick={() => void post()} data-testid="wall-send">
          Send
        </button>
      </div>
    </div>
  );
}

function InviteForm({
  client,
  persona,
  eventId,
  guests,
}: {
  client: SnapbackClient;
  persona: Persona;
  eventId: string;
  guests: InviteRow[];
}) {
  const invited = useMemo(() => new Set(guests.map((g) => g.userId)), [guests]);
  const candidates = PERSONAS.filter((p) => !invited.has(p.userId));
  const [error, setError] = useState<string | null>(null);

  const invite = async (target: Persona) => {
    setError(null);
    try {
      await client.mutate(api.invite, {
        args: { eventId, userId: target.userId, guestName: target.name },
        userId: persona.userId,
      } as never);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'invite failed');
    }
  };

  return (
    <div style={{ ...styles.panel, marginTop: 16 }} data-testid="invite-form">
      <h3 style={styles.panelTitle}>Invite someone</h3>
      {candidates.length === 0 && <p style={styles.empty}>Everyone's already on the list.</p>}
      <div style={styles.rsvpRow}>
        {candidates.map((p) => (
          <button key={p.id} type="button" style={styles.secondaryButton} onClick={() => void invite(p)} data-testid={`invite-${p.id}`}>
            + {p.name}
          </button>
        ))}
      </div>
      {error && <p style={styles.errorText}>{error}</p>}
    </div>
  );
}

const styles = {
  page: { maxWidth: 880, margin: '0 auto', padding: '20px 20px 80px' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
  wordmark: { background: 'none', border: 'none', color: '#fff', fontSize: 24, fontWeight: 800, cursor: 'pointer', padding: 0 },
  switcher: { display: 'flex', gap: 8 },
  personaChip: { border: 'none', borderRadius: 999, color: '#fff', padding: '6px 14px', fontWeight: 600, cursor: 'pointer' },
  main: {},
  h1: { fontSize: 28, fontWeight: 800, margin: '0 0 8px' },
  feedTop: { display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 18, flexWrap: 'wrap' },
  connBadge: { fontSize: 12, fontWeight: 600, letterSpacing: 0.3 },
  empty: { color: '#b7a8cc', fontSize: 14, lineHeight: 1.5 },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 },
  card: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: 18, display: 'flex', flexDirection: 'column', gap: 8 },
  cardEmoji: { fontSize: 44, lineHeight: 1 },
  cardTitle: { fontSize: 19, fontWeight: 700, margin: 0 },
  cardMeta: { fontSize: 12.5, color: '#c5b6da' },
  statusPill: { alignSelf: 'flex-start', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, background: 'rgba(255,255,255,0.12)', borderRadius: 999, padding: '3px 10px' },
  rsvpRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  rsvpButton: { border: '1px solid', borderRadius: 999, color: '#fff', padding: '6px 12px', fontSize: 13, cursor: 'pointer' },
  lockedHint: { fontSize: 12, color: '#b7a8cc' },
  primaryButton: { background: 'linear-gradient(135deg, #8b3df0, #d3388f)', color: '#fff', border: 'none', borderRadius: 999, padding: '9px 18px', fontWeight: 700, cursor: 'pointer' },
  secondaryButton: { background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 999, padding: '7px 14px', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' },
  backLink: { background: 'none', border: 'none', color: '#c5b6da', cursor: 'pointer', padding: 0, marginBottom: 14, fontSize: 14 },
  eventHero: { display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' },
  description: { color: '#e4d9f4', lineHeight: 1.55, maxWidth: 640 },
  columns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 18 },
  panel: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 16 },
  panelTitle: { margin: '0 0 10px', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, color: '#cbb9e4' },
  guestRow: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 14 },
  guestStatus: { color: '#b7a8cc', fontSize: 12.5, textAlign: 'right' },
  postRow: { padding: '6px 0', fontSize: 14, lineHeight: 1.45 },
  formCard: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18, padding: 22, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 },
  formRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  input: { background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, color: '#fff', padding: '9px 12px' },
  errorText: { color: '#ff9d9d', fontSize: 13, margin: 0 },
} satisfies Record<string, CSSProperties>;

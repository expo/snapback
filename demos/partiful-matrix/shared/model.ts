export const BACKENDS = ['snapback', 'supabase', 'convex', 'sqlite'] as const;
export type Backend = (typeof BACKENDS)[number];

// Web-only follow-up cells beyond the frozen Step 0 matrix (LLP 0063):
// The `*-realtime` modes are idiomatic browser-direct follow-up cells. They
// are deliberately outside the frozen Step 0 matrix and never route through
// the comparison gateway.
export type BackendMode = Backend | 'supabase-realtime' | 'convex-realtime';

export const PERSONAS = [
  { id: 'ada', userId: 'user_ada', name: 'Ada', initials: 'AD' },
  { id: 'grace', userId: 'user_grace', name: 'Grace', initials: 'GH' },
  { id: 'eve', userId: 'user_eve', name: 'Eve', initials: 'EV' },
] as const;

export type Persona = (typeof PERSONAS)[number];
export type RsvpStatus = 'host' | 'going' | 'maybe' | 'cant';

export interface EventRow {
  _id: string;
  title: string;
  emoji: string;
  description: string;
  location: string;
  startsAt: number;
  hostId: string;
  hostName: string;
  accent: string;
}

export interface RsvpRow {
  _id: string;
  eventId: string;
  userId: string;
  guestName: string;
  status: RsvpStatus;
}

export interface PostRow {
  _id: string;
  eventId: string;
  authorId: string;
  authorName: string;
  message: string;
  createdAt: number;
}

export type QueryName = 'listEvents' | 'eventDetails' | 'guestList' | 'eventWall';
export type MutationName = 'createEvent' | 'rsvp' | 'postMessage';
export type Connection = 'connecting' | 'live' | 'polling' | 'stale' | 'disconnected';
export type ProviderDelivery =
  | { kind: 'authoritative' }
  | { kind: 'connection' }
  | { kind: 'error'; error?: unknown };

export interface MatrixProvider {
  readonly backend: BackendMode;
  readonly transport: 'push' | 'poll';
  readonly externalStoreProtocol: 'snapback.external-store.v1';
  subscribe<Row>(
    name: QueryName,
    args: Record<string, unknown>,
    userId: string,
    observer: (rows: Row[], connection: Connection, delivery?: ProviderDelivery) => void,
  ): Promise<{ rows: Row[]; dispose(): void }>;
  mutate<T>(
    name: MutationName,
    args: Record<string, unknown>,
    userId: string,
  ): Promise<T>;
  transportEvidence?(): readonly Record<string, unknown>[];
  dispose?(): void | Promise<void>;
}

export function personaFromSearch(search: string): Persona {
  const requested = new URLSearchParams(search).get('user');
  return PERSONAS.find((persona) => persona.id === requested || persona.userId === requested) ?? PERSONAS[0];
}

export function eventFromSearch(search: string): string | null {
  return new URLSearchParams(search).get('event');
}

export function formatWhen(startsAt: number): string {
  return new Date(startsAt).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function statusLabel(status: string): string {
  if (status === 'host') return 'Hosting';
  if (status === 'going') return 'Going';
  if (status === 'maybe') return 'Maybe';
  if (status === 'cant') return "Can't go";
  return status;
}

// Shindig Contract surface helpers. Pure helpers depend only on their
// arguments (declared in data.contract-meta.ts); URL navigation is a named
// capability with an explicit effect.

export interface Persona {
  id: string;
  userId: string;
  name: string;
}

export const PERSONAS: Persona[] = [
  { id: 'ada', userId: 'user_ada', name: 'Ada' },
  { id: 'grace', userId: 'user_grace', name: 'Grace' },
  { id: 'eve', userId: 'user_eve', name: 'Eve' },
];

export interface InviteRow {
  _id: string;
  _createdAt: number;
  eventId: string;
  userId: string;
  guestName: string;
  status: string;
  note?: string;
  eventTitle: string;
  eventEmoji: string;
  eventStartsAt: number;
  hostName: string;
}

export interface PostRow {
  _id: string;
  authorName: string;
  message: string;
}

export interface EventRow {
  _id: string;
  title: string;
  emoji: string;
  description: string;
  location: string;
  startsAt: number;
  hostName: string;
}

const STATUS_LABELS: Record<string, string> = {
  host: 'Hosting',
  invited: 'Invited',
  going: 'Going',
  maybe: 'Maybe',
  cant: "Can't go",
};

export function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function guestLine(guest: InviteRow): string {
  const label = statusLabel(guest.status);
  return guest.note ? `${label} — “${guest.note}”` : label;
}

export function sortGuests(rows: InviteRow[]): InviteRow[] {
  const order = ['host', 'going', 'maybe', 'invited', 'cant'];
  return [...rows].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
}

export function goingCount(rows: InviteRow[]): number {
  return rows.filter((row) => row.status === 'going' || row.status === 'host').length;
}

export function isHost(rows: InviteRow[], userId: string): boolean {
  return rows.some((row) => row.userId === userId && row.status === 'host');
}

export function inviteCandidates(rows: InviteRow[]): Persona[] {
  const present = new Set(rows.map((row) => row.userId));
  return PERSONAS.filter((persona) => !present.has(persona.userId));
}

// Party-time chips instead of a datetime widget: choice -> absolute ms.
export function startsFor(choice: string, nowMs: number): number {
  const HOUR = 3_600_000;
  if (choice === 'tonight') return nowMs + 6 * HOUR;
  if (choice === 'weekend') return nowMs + 48 * HOUR;
  return nowMs + 7 * 24 * HOUR; // next week
}

export function whenChipLabel(choice: string): string {
  if (choice === 'tonight') return 'Tonight';
  if (choice === 'weekend') return 'This weekend';
  return 'Next week';
}

function currentUserParam(): string {
  return new URLSearchParams(location.search).get('user') ?? 'ada';
}

// Boot-bound live queries make event selection a navigation, not app state:
// the surface subscribes guestList/eventWall for exactly one event, so
// opening a different event re-boots with new args (see main.ts).
export function openEvent(eventId: string): void {
  location.assign(`?user=${encodeURIComponent(currentUserParam())}&event=${encodeURIComponent(eventId)}`);
}

export function openFeed(): void {
  location.assign(`?user=${encodeURIComponent(currentUserParam())}`);
}

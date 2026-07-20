export interface PartitimeLinks {
  listEvents(args: Record<string, never>): unknown;
  eventDetails(args: { eventId: string }): unknown;
  guestList(args: { eventId: string }): unknown;
  eventWall(args: { eventId: string }): unknown;
  createEvent(args: Record<string, unknown>): unknown;
  rsvp(args: Record<string, unknown>): unknown;
  postMessage(args: Record<string, unknown>): unknown;
}

let links: PartitimeLinks | null = null;

export function configurePartitimeLinks(next: PartitimeLinks) {
  links = next;
}

export function resetPartitimeLinks() {
  links = null;
}

export function getPartitimeLinks() {
  if (!links) throw new Error('Partitime Contract links used before provider boot');
  return links;
}

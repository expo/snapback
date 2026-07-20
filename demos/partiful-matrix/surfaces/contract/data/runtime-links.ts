export interface MatrixContractLinks {
  listEvents(args: Record<string, never>): unknown;
  eventDetails(args: { eventId: string }): unknown;
  guestList(args: { eventId: string }): unknown;
  eventWall(args: { eventId: string }): unknown;
  createEvent(args: Record<string, unknown>): unknown;
  rsvp(args: Record<string, unknown>): unknown;
  postMessage(args: Record<string, unknown>): unknown;
}

let links: MatrixContractLinks | null = null;
export function configureMatrixContractLinks(next: MatrixContractLinks) { links = next; }
export function resetMatrixContractLinks() { links = null; }
export function getMatrixContractLinks() {
  if (!links) throw new Error('Partiful matrix Contract links used before provider boot');
  return links;
}

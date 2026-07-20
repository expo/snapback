import { getPartitimeLinks } from './runtime-links.js';

export function eventDetails(args: { eventId: string }) {
  return getPartitimeLinks().eventDetails(args);
}

import { getPartitimeLinks } from './runtime-links.js';

export function guestList(args: { eventId: string }) {
  return getPartitimeLinks().guestList(args);
}

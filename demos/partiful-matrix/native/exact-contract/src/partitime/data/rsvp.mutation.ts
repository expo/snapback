import { getPartitimeLinks } from './runtime-links.js';

export function rsvp(args: Record<string, unknown>) {
  return getPartitimeLinks().rsvp(args);
}

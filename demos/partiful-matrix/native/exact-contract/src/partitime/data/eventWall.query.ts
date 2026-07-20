import { getPartitimeLinks } from './runtime-links.js';

export function eventWall(args: { eventId: string }) {
  return getPartitimeLinks().eventWall(args);
}

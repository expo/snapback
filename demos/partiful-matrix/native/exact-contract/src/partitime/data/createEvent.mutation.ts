import { getPartitimeLinks } from './runtime-links.js';

export function createEvent(args: Record<string, unknown>) {
  return getPartitimeLinks().createEvent(args);
}

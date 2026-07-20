import { getPartitimeLinks } from './runtime-links.js';

export function listEvents(args: Record<string, never>) {
  return getPartitimeLinks().listEvents(args);
}

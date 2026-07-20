import { getPartitimeLinks } from './runtime-links.js';

export function postMessage(args: Record<string, unknown>) {
  return getPartitimeLinks().postMessage(args);
}

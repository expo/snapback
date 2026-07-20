import { getChatLinks } from './runtime-links.js';

export function send(args: Record<string, unknown>) {
  return getChatLinks().send(args);
}

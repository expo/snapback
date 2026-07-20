import { getChatLinks } from './runtime-links.js';

export function setModel(args: Record<string, unknown>) {
  return getChatLinks().setModel(args);
}

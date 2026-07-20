import { getChatLinks } from './runtime-links.js';

export function chatInfo(args: Record<string, never>) {
  return getChatLinks().chatInfo(args);
}

import { getChatLinks } from './runtime-links.js';

export function newConversation(args: Record<string, never>) {
  return getChatLinks().newConversation(args);
}

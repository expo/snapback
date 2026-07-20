import { getChatLinks } from './runtime-links.js';

export function models(args: Record<string, never>) {
  return getChatLinks().models(args);
}

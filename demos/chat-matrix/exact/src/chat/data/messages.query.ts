import { getChatLinks } from './runtime-links.js';

export function messages(args: Record<string, never>) {
  return getChatLinks().messages(args);
}

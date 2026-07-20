export interface ChatLinks {
  messages(args: Record<string, never>): unknown;
  chatInfo(args: Record<string, never>): unknown;
  models(args: Record<string, never>): unknown;
  send(args: Record<string, unknown>): unknown;
  newConversation(args: Record<string, never>): unknown;
  setModel(args: Record<string, unknown>): unknown;
}

let links: ChatLinks | null = null;

export function configureChatLinks(next: ChatLinks) {
  links = next;
}

export function resetChatLinks() {
  links = null;
}

export function getChatLinks() {
  if (!links) throw new Error('Chat Contract links used before provider boot');
  return links;
}

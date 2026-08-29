const KEY = 'clique-search-messages';

export type CachedMessage = { text: string; chat: string; chatId: string };

export function rememberSearchMessages(chat: string, chatId: string, rows: { text?: string; tombstoned?: boolean; expiresAt?: number | null }[]) {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const incoming = rows
    .filter((row) => !row.tombstoned && row.text && (!row.expiresAt || row.expiresAt > now))
    .map((row) => ({ text: String(row.text), chat, chatId }));
  try {
    const current = JSON.parse(window.sessionStorage.getItem(KEY) || '[]') as CachedMessage[];
    const merged = [...incoming, ...current.filter((row) => row.chatId !== chatId)].slice(0, 400);
    window.sessionStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    window.sessionStorage.setItem(KEY, JSON.stringify(incoming.slice(0, 400)));
  }
}

export function cachedSearchMessages(): CachedMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(window.sessionStorage.getItem(KEY) || '[]') as CachedMessage[];
  } catch {
    return [];
  }
}

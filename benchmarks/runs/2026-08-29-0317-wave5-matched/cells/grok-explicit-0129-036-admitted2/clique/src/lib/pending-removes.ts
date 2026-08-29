const KEY = 'clique-pending-remove';
const EVENT = 'clique-pending-remove';

export type PendingRemove = { chatId: string; handle: string };

export function stashPendingRemove(chatId: string, handle: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(KEY, JSON.stringify({ chatId, handle }));
  notifyPendingRemove();
}

export function readPendingRemove(): PendingRemove | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) as PendingRemove : null;
  } catch {
    return null;
  }
}

export function clearPendingRemove() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(KEY);
  notifyPendingRemove();
}

export function peekPendingRemove(chatId: string | null | undefined) {
  const pending = readPendingRemove();
  if (!pending || !chatId) return undefined;
  return pending.chatId === chatId ? pending : undefined;
}

export function notifyPendingRemove() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EVENT));
}

export function subscribePendingRemove(onChange: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

const KEY = 'clique-pending-sends';
const EVENT = 'clique-pending-sends';

export type PendingSend = {
  clientId: string;
  chatId: string;
  text: string;
  quoteId?: string;
  createdAt: number;
  viewOnce?: boolean;
  mediaKind?: 'image' | 'video';
  image?: string;
  video?: string;
};

export function readPendingSends(): PendingSend[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) as PendingSend[] : [];
  } catch {
    return [];
  }
}

export function writePendingSends(rows: PendingSend[]) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(KEY, JSON.stringify(rows.slice(0, 50)));
  window.dispatchEvent(new Event(EVENT));
}

export function stashPendingSend(row: PendingSend) {
  const current = readPendingSends().filter((item) => item.clientId !== row.clientId);
  writePendingSends([...current, row]);
}

export function dropPendingSend(clientId: string) {
  const current = readPendingSends();
  const next = current.filter((item) => item.clientId !== clientId);
  if (next.length === current.length) return;
  writePendingSends(next);
}

export function subscribePendingSends(onChange: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

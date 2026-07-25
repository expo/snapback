const partitimeWhenFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'America/Los_Angeles',
});

export function fmtWhen(ms: number): string {
  // @ref LLP 0063#workstream-3--contract-as-a-complete-product-surface-language —
  // static Bun output and hydrated browser output must be byte-identical; ICU
  // owns the calendar fields, while the product owns their punctuation.
  const fields = Object.fromEntries(
    partitimeWhenFormatter
      .formatToParts(new Date(ms))
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  );
  return `${fields.weekday}, ${fields.month} ${fields.day}, ${fields.hour}:${fields.minute} ${fields.dayPeriod}`;
}
export function statusLabel(status: string): string {
  if (status === 'host') return 'Hosting';
  if (status === 'going') return 'Going';
  if (status === 'maybe') return 'Maybe';
  if (status === 'cant') return "Can't go";
  return status;
}
export function goingCount(rows: Array<{status:string}>): number { return rows.filter((row) => row.status === 'host' || row.status === 'going').length; }
export function myStatus(rows: Array<{userId:string;status:string}>, userId: string): string { return rows.find((row) => row.userId === userId)?.status ?? 'none'; }

// Match the React control's minimum optimistic-status dwell. A local provider
// can settle within one frame; without this floor the non-motion alternative
// disappears before a person can perceive it.
export function minimumFeedbackDelay(): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, 450));
}

export function navigatePartitimeCollection(key: string): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const owner = active?.closest<HTMLElement>('[role="menu"],[role="listbox"]');
  if (!owner) return;
  const items = [...owner.querySelectorAll<HTMLElement>('[role="menuitem"],[role="option"]')];
  if (items.length === 0) return;
  const activeDescendant = owner.getAttribute('aria-activedescendant');
  const activeOption = activeDescendant ? document.getElementById(activeDescendant) : null;
  const focusedOption = active?.getAttribute('role') === 'option' ? active : null;
  const current = items.indexOf(
    owner.getAttribute('role') === 'listbox'
      ? (focusedOption ?? activeOption as HTMLElement)
      : active!,
  );
  const next = key === 'Home'
    ? 0
    : key === 'End'
      ? items.length - 1
      : key === 'ArrowDown'
        ? current < 0 ? 0 : (current + 1) % items.length
        : current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
  if (owner.getAttribute('role') === 'listbox') {
    const option = items[next];
    option?.focus();
    option?.scrollIntoView({ block: 'nearest' });
  } else {
    items[next]?.focus();
  }
}

declare const __PARTITIME_BASE_PATH__: string;

function basePath(): string {
  const normalized = __PARTITIME_BASE_PATH__.startsWith('/') ? __PARTITIME_BASE_PATH__ : `/${__PARTITIME_BASE_PATH__}`;
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function navigate(pathname: string, params: URLSearchParams, focusTestId?: string): void {
  const search = params.toString();
  history.pushState({}, '', `${pathname}${search ? `?${search}` : ''}${location.hash}`);
  dispatchEvent(new CustomEvent('partitime:navigate', { detail: { focusTestId } }));
}

export function openEvent(eventId: string): void {
  const params = new URLSearchParams(location.search);
  params.delete('event');
  navigate(`${basePath()}events/${encodeURIComponent(eventId)}/`, params);
}
export function openCreateRoute(): void {
  const params = new URLSearchParams(location.search);
  params.delete('event');
  params.delete('uiState');
  navigate(`${basePath()}events/new/`, params);
}
export function openFeed(): void {
  const params = new URLSearchParams(location.search);
  params.delete('event');
  navigate(basePath(), params, 'create-event');
}

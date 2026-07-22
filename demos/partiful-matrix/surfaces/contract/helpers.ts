export function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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

export function navigatePartitimeCollection(key: string): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const owner = active?.closest<HTMLElement>('[role="menu"],[role="listbox"]');
  if (!owner) return;
  const items = [...owner.querySelectorAll<HTMLElement>('[role="menuitem"],[role="option"]')];
  if (items.length === 0) return;
  if (owner.getAttribute('role') === 'listbox') {
    const idPrefix = owner.dataset.testid ?? 'partitime-listbox';
    for (const [index, item] of items.entries()) {
      if (!item.id) item.id = `${idPrefix}-option-${index}`;
    }
  }
  const activeDescendant = owner.getAttribute('aria-activedescendant');
  const activeOption = activeDescendant ? document.getElementById(activeDescendant) : null;
  const current = Math.max(0, items.indexOf(owner.getAttribute('role') === 'listbox' ? activeOption as HTMLElement : active!));
  const next = key === 'Home'
    ? 0
    : key === 'End'
      ? items.length - 1
      : key === 'ArrowDown'
        ? (current + 1) % items.length
        : (current - 1 + items.length) % items.length;
  if (owner.getAttribute('role') === 'listbox') {
    const option = items[next];
    if (!option?.id) return;
    owner.setAttribute('aria-activedescendant', option.id);
    for (const item of items) item.setAttribute('aria-selected', item === option ? 'true' : 'false');
    option.scrollIntoView({ block: 'nearest' });
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

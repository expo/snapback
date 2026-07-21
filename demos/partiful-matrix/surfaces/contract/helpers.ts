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

declare const __PARTITIME_BASE_PATH__: string;

function basePath(): string {
  const normalized = __PARTITIME_BASE_PATH__.startsWith('/') ? __PARTITIME_BASE_PATH__ : `/${__PARTITIME_BASE_PATH__}`;
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function navigate(pathname: string, params: URLSearchParams): void {
  const search = params.toString();
  history.pushState({}, '', `${pathname}${search ? `?${search}` : ''}${location.hash}`);
  dispatchEvent(new CustomEvent('partitime:navigate'));
}

export function openEvent(eventId: string): void {
  const params = new URLSearchParams(location.search);
  params.delete('event');
  navigate(`${basePath()}events/${encodeURIComponent(eventId)}/`, params);
}
export function openFeed(): void {
  const params = new URLSearchParams(location.search);
  params.delete('event');
  navigate(basePath(), params);
}

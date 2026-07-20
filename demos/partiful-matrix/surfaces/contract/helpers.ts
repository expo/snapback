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
export function openEvent(eventId: string): void {
  const params = new URLSearchParams(location.search); params.set('event', eventId); location.assign(`?${params}`);
}
export function openFeed(): void {
  const params = new URLSearchParams(location.search); params.delete('event'); location.assign(`?${params}`);
}

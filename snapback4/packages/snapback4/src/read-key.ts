// Wire-equivalent object arguments share an observation; array order remains significant.
export function readKey(op: { name: string }, args: unknown): string {
  return `${op.name}:${JSON.stringify(args, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)}`;
}
export function* matchingReads<W extends { op: { name: string }; args: unknown; expiredServerDeadline?: number | undefined }>(watches: Iterable<W>, op: { name: string }, args: unknown): Iterable<W> {
  const key = readKey(op, args);
  for (const watch of watches) if (watch.expiredServerDeadline !== undefined && readKey(watch.op, watch.args) === key) yield watch;
}

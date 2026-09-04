// @ref LLP 1012#7-writes-offline — cursor identity is not order. Only held,
// post-commit next links prove progress; explicit negatives settle deletions.
import type { StoredAnswer, WatermarkRecord } from "./range-store.js";

export interface OverlayWatermark extends Pick<WatermarkRecord, "op" | "args" | "watermark"> {
  cursorArg: string;
  /** Last proven progress, and positions already consumed, survive a remount/reopen. */
  progress?: string;
  consumed?: string[];
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  if (!object(value)) return JSON.stringify(value);
  return JSON.stringify(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

/** Each page keeps the name used when it was filed, including a pre-manifest c. */
export function pagePosition(page: Pick<StoredAnswer, "op" | "args" | "cursorArg">, mark: OverlayWatermark): string | null | undefined {
  if (page.op !== mark.op || !object(page.args) || !object(mark.args)) return undefined;
  const cursor = page.cursorArg ?? mark.cursorArg;
  const base = { ...mark.args };
  const args = { ...page.args };
  // Before the manifest, a caller can already pass { after: null } while the
  // recorded name is c. Only the now-known cursor substitutes for that missing
  // field; other nullable/string arguments remain part of the query identity.
  delete base[Object.hasOwn(base, mark.cursorArg) ? mark.cursorArg : cursor];
  delete args[cursor];
  if (canonical(base) !== canonical(args)) return undefined;
  const position = page.args[cursor];
  return position === null || typeof position === "string" ? position : undefined;
}

/**
 * An ordered path starting at the commit snapshot, never inferred from a newer
 * seq or a different opaque string. A cycle, ambiguity, or missing link fails
 * closed. The caller supplies only non-empty pages whose result rows are held.
 */
export function cursorChain(pages: StoredAnswer[], mark: OverlayWatermark, committedSeq: number): string[] {
  const links = new Map<string | null, string>();
  for (const page of pages) {
    if (page.seq < committedSeq || typeof page.next !== "string") continue;
    const position = pagePosition(page, mark);
    if (position === undefined) continue;
    if (links.has(position) && links.get(position) !== page.next) return [];
    links.set(position, page.next);
  }
  const seen = new Set<string | null>([mark.watermark]);
  const chain: string[] = [];
  let position = mark.watermark;
  while (links.has(position)) {
    const next = links.get(position)!;
    if (seen.has(next)) return [];
    seen.add(next);
    chain.push(next);
    position = next;
  }
  return chain;
}

/** A re-mark can consume progress only once and only beyond the last proven mark. */
export function advanceOverlay(mark: OverlayWatermark, tail: WatermarkRecord | undefined, chain: string[]): boolean {
  if (!tail || pagePosition({ ...tail, args: object(tail.args)
    ? { ...tail.args, [tail.cursorArg ?? mark.cursorArg]: tail.watermark } : tail.args }, mark) === undefined) return false;
  if (typeof tail.watermark !== "string" || (mark.consumed ?? []).includes(tail.watermark)) return false;
  const at = chain.indexOf(tail.watermark);
  const previous = mark.progress === undefined ? -1 : chain.indexOf(mark.progress);
  if (at < 0 || (mark.progress !== undefined && previous < 0) || at <= previous) return false;
  mark.progress = tail.watermark;
  mark.consumed = [...new Set([...(mark.consumed ?? []), ...chain.slice(0, at + 1)])];
  return true;
}

// A live client follows the presence its watches read, by opaque tokens the
// server issued with each answer (LLP 3000.017 §3.2, §3.5).

/** At most this many tokens ride on one held poll; the server takes as many. */
export const FOLLOW_LIMIT = 64;
/** An answer that read presence the server would not follow (an empty token)
 * re-runs after this long instead (§3.5). A followed token needs no renewal:
 * following keeps it live. */
export const PRESENCE_RETRY_MS = 30_000;

/** The tokens to send on the next poll: those the live watches hold. */
export function followTokens(watches: Iterable<{ readonly presence: ReadonlySet<string> }>): string[] {
  const tokens: string[] = [];
  for (const watch of watches) {
    for (const token of watch.presence) {
      if (tokens.includes(token)) continue;
      if (tokens.length === FOLLOW_LIMIT) return tokens;
      tokens.push(token);
    }
  }
  return tokens;
}

/** Whether two follow lists carry the same tokens. */
export function sameFollow(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((token) => b.includes(token));
}

/** A watch's presence retry: armed while its last answer read presence the
 * server would not follow, cleared otherwise. Returns the timer to keep. */
export function presenceRetry(previous: ReturnType<typeof setTimeout> | null, due: boolean, rerun: () => void): ReturnType<typeof setTimeout> | null {
  if (previous) clearTimeout(previous);
  if (!due) return null;
  const timer = setTimeout(rerun, PRESENCE_RETRY_MS);
  (timer as { unref?: () => void }).unref?.();
  return timer;
}

/** The watches holding a token the server reported moved, with those tokens
 * removed: the next poll does not follow them, and each watch's re-run
 * brings its next token (§3.2). */
export function movedWatches<W extends { presence: Set<string> }>(watches: Iterable<W>, tokens: Iterable<string>): W[] {
  const moved = new Set(tokens);
  const due: W[] = [];
  for (const watch of watches) {
    if (![...watch.presence].some((token) => moved.has(token))) continue;
    watch.presence = new Set([...watch.presence].filter((token) => !moved.has(token)));
    due.push(watch);
  }
  return due;
}

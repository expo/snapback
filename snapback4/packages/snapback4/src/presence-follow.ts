// A live client follows the presence its watches read, by opaque tokens the
// server issued with each answer (LLP 3000.017 §3.2, §3.5).

/** At most this many tokens ride on one held poll; the server takes as many. */
export const FOLLOW_LIMIT = 64;
/** A token lives 10 minutes; watches that read presence re-run at half that,
 * so an honest client never lapses (§3.5). */
export const PRESENCE_RENEW_MS = 300_000;

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

/** Re-runs watches that read presence on a timer while any exist, renewing
 * their tokens; returns a stop function for close. */
export function presenceRenewal(watches: () => Iterable<{ readonly presence: ReadonlySet<string> }>, rerun: (watch: { readonly presence: ReadonlySet<string> }) => void) {
  let timer: ReturnType<typeof setInterval> | undefined;
  const any = () => { for (const watch of watches()) if (watch.presence.size) return true; return false; };
  return {
    update() {
      if (any() && !timer) {
        timer = setInterval(() => { for (const watch of watches()) if (watch.presence.size) rerun(watch); }, PRESENCE_RENEW_MS);
        (timer as { unref?: () => void }).unref?.();
      } else if (!any() && timer) { clearInterval(timer); timer = undefined; }
    },
    stop() { if (timer) clearInterval(timer); timer = undefined; },
  };
}

// A live client follows the presence its watches read (LLP 3000.017 §3.2).

/** At most this many principals ride on one held poll; the server takes as many. */
export const FOLLOW_LIMIT = 64;
/** A query read lets its viewer follow a principal for 10 minutes; watches that
 * read presence re-run at half that, so an honest client never lapses (§3.5). */
export const PRESENCE_RENEW_MS = 300_000;

/** The newest connected bit this client has seen for each principal. */
export class PresenceFollow {
  private readonly bits = new Map<string, boolean>();

  /** Records bits from a query answer or a change answer. Returns the
   * principals whose bit moved, so watches that read them re-run. */
  observe(presence: Readonly<Record<string, boolean>> | undefined): string[] {
    const moved: string[] = [];
    for (const [principal, bit] of Object.entries(presence ?? {})) {
      if (this.bits.has(principal) && this.bits.get(principal) !== bit) moved.push(principal);
      this.bits.set(principal, bit);
    }
    return moved;
  }

  /** The bits to send on the next poll: principals some live watch read. */
  follow(watches: Iterable<{ readonly presence: ReadonlySet<string> }>): Map<string, boolean> {
    const followed = new Map<string, boolean>();
    for (const watch of watches) {
      for (const principal of watch.presence) {
        const bit = this.bits.get(principal);
        if (bit === undefined || followed.has(principal)) continue;
        if (followed.size === FOLLOW_LIMIT) return followed;
        followed.set(principal, bit);
      }
    }
    return followed;
  }
}

/** Whether two follow lists carry the same principals and bits. */
export function sameFollow(a: ReadonlyMap<string, boolean>, b: ReadonlyMap<string, boolean>): boolean {
  return a.size === b.size && [...a].every(([principal, bit]) => b.get(principal) === bit);
}

/** Re-runs watches that read presence on a timer while any exist, renewing the
 * server's grants; returns a stop function for close. */
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

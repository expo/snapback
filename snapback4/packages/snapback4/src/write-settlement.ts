// @ref LLP 3000.011.003.000#9 — a run owns its settlement observer, even after the screen unmounts.
import { mintId } from "./client.ts";
import type { Client, Mutation, MutateOptions, Write } from "./contract.ts";

/** Advice only; it neither cancels the write nor settles its promise. */
export const OFFLINE_RUN_WARNING_MS = 10_000;
declare const __DEV__: boolean | undefined;
declare const process: { env: { NODE_ENV?: string } };
function development(): boolean {
  if (typeof __DEV__ === "boolean") return __DEV__;
  // Bundlers replace this standard expression; Hermes needs no import.meta
  // polyfill. Unbundled browser environments with no dev marker stay silent.
  try { return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"; }
  catch { return false; }
}

/** The explicit custody option stays immediate; ordinary hook calls await a receipt.
 * This observer belongs to the promise, not a React effect or query subscription. */
export async function settleMutation<A, R>(client: Client, op: Mutation<A, R>, args: A, options?: MutateOptions): Promise<Write<R>> {
  if (options?.waitSeconds === 0) return client.mutate(op, args, options);
  const id = options?.id ?? mintId();
  let observed: Write<R> | undefined;
  let settle: ((write: Write<R>) => void) | undefined;
  const stop = client.onWrite(write => {
    if (write.id !== id) return;
    observed = write as Write<R>;
    settle?.(observed);
  });
  // @ref LLP 3000.011.003.000#11-wave-11-runtime-upgrade-history — an offline run owns one development-only timer until settlement.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let warned = false;
  let lastLink: string | undefined;
  const offline = (link: string) => {
    if (link === lastLink) return;
    lastLink = link;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (link === "offline" && !warned) timer = setTimeout(() => {
      warned = true;
      console.warn(`snapback4: useMutation().run() for ${op.name} has waited offline for 10 seconds. It waits for sent | failed after reconnect. Use { waitSeconds: 0 } for immediate custody and observe the write receipt separately; this warning does not cancel the write.`);
    }, OFFLINE_RUN_WARNING_MS);
  };
  let stopLink: (() => void) | undefined;
  try {
    const write = await client.mutate(op, args, { ...options, id });
    if (write.state !== "pending") return write;
    if (observed) return observed;
    if (development()) { stopLink = client.onLink(offline); offline(client.link()); }
    return observed ?? await new Promise<Write<R>>(resolve => { settle = resolve; });
  } finally { stop(); stopLink?.(); if (timer !== undefined) clearTimeout(timer); }
}

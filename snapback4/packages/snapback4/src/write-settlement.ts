// @ref LLP 3000.011.003.000#9 — a run owns its settlement observer, even after the screen unmounts.
import { mintId } from "./client.ts";
import type { Client, Mutation, MutateOptions, Write } from "./contract.ts";

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
  try {
    const write = await client.mutate(op, args, { ...options, id });
    if (write.state !== "pending") return write;
    return observed ?? await new Promise<Write<R>>(resolve => { settle = resolve; });
  } finally { stop(); }
}

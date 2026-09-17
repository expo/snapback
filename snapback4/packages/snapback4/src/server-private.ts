import type { Query, Mutation, Session } from "./contract.ts";
import type { ServerContext } from "./server.ts";

/** Internal capability presented only while invoking a handler made by the
 * identity helper. It is intentionally absent from ServerContext. */
export interface IdentityRuntime {
  readonly now: () => number;
  /** Invocation-bound transport used only by the packaged provider adapter. */
  readonly providerFetch: typeof fetch;
  query<A, R>(op: Query<A, R>, args: A): Promise<R>;
  mutate<A, R>(op: Mutation<A, R>, args: A, id: string): Promise<void>;
  mint(issuer: string, subject: string, kind: string, days: number): Promise<Session>;
}

type OrdinaryHandler<A, R, Secrets extends string> =
  (args: A, ctx: ServerContext<Secrets>) => Promise<R> | R;
type IdentityExecutor =
  (args: unknown, ctx: ServerContext<string>, runtime: IdentityRuntime) => Promise<unknown>;

const executors = new WeakMap<Function, IdentityExecutor>();

export function identityHandler<A, R, Secrets extends string>(
  execute: (args: A, ctx: ServerContext<Secrets>, runtime: IdentityRuntime) => Promise<R>,
): OrdinaryHandler<A, R, Secrets> {
  const handler: OrdinaryHandler<A, R, Secrets> = () => {
    throw new Error("an identity handler may run only through generated server()");
  };
  executors.set(handler, execute as IdentityExecutor);
  return handler;
}

export function identityExecutor(handler: Function): IdentityExecutor | undefined {
  return executors.get(handler);
}

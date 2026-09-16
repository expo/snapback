// Node's application runtime; generated/server.ts binds the declared handlers.
import type { Client } from "./contract.ts";
import { runWorker, type ActionHandler, type EffectHandler, type Worker, type WorkerOptions } from "./worker.ts";
import { context } from "./server-context.ts";
import { redactor, ServerError, strictJson } from "./server-json.ts";
import type { StepRunner } from "./server-steps.ts";
export { ParkStep, ServerError } from "./server-json.ts";
export type { StepOptions } from "./server-steps.ts";

export interface ServerContext<Secrets extends string = never> {
  readonly query: Client["query"];
  readonly mutate: Client["mutate"];
  readonly principal: string;
  readonly invocation: {
    readonly id: string;
    readonly attempt: number;
    /** Absolute epoch milliseconds, or no operation deadline. */
    readonly deadline: number | null;
    readonly cancelled: boolean;
    /** Aborted on cancellation, deadline, lost authority or context closure. */
    readonly signal: AbortSignal;
  };
  readonly secrets: Readonly<Record<Secrets, string>>;
  readonly step: StepRunner;
  /** A deterministic mintId-shaped write identity, stable across attempts. */
  writeIdFor(label: string): string;
}

export interface ServerManifest {
  readonly actions: Readonly<Record<string, { readonly contract: string; readonly secrets: readonly string[] }>>;
  readonly effects: Readonly<Record<string, { readonly secrets: readonly string[] }>>;
}

export interface ServerOptions extends Omit<WorkerOptions, "url" | "token" | "actions" | "effects" | "redact"> {
  /** Defaults to SNAPBACK_URL in env (or process.env). */
  readonly url?: string;
  /** Defaults to SNAPBACK_SERVICE_TOKEN in env (or process.env). */
  readonly token?: string;
  /** Environment snapshot supplied by the supervisor; injectable for tests. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Invocation-status poll interval; default 1 second. */
  readonly statusIntervalMs?: number;
}

export interface ServerHandlers {
  // Generated signatures enforce each action's Args, Result and literal secret
  // union. Erase both parameters only at this registry boundary.
  readonly actions: Readonly<Record<string, (args: never, ctx: never) => unknown>>;
  readonly effects?: Readonly<Record<string, EffectHandler<never>>>;
}

// @ref LLP 3000.009#5.1 — generated contracts bind typed handlers, declared secrets and caller authority.
export function startServer(manifest: ServerManifest, handlers: ServerHandlers, options: ServerOptions = {}): Worker {
  const env = { ...(options.env ?? process.env) };
  const url = options.url ?? env.SNAPBACK_URL;
  const token = options.token ?? env.SNAPBACK_SERVICE_TOKEN;
  if (!url || !token) throw new ServerError("E_SERVER_CONFIG", "set SNAPBACK_URL and SNAPBACK_SERVICE_TOKEN or pass url and token");
  if (options.statusIntervalMs !== undefined && (!Number.isFinite(options.statusIntervalMs) || options.statusIntervalMs < 1)) {
    throw new ServerError("E_SERVER_CONFIG", "statusIntervalMs must be a positive number");
  }
  const actionNames = Object.getOwnPropertyNames(manifest.actions);
  const registered = Object.getOwnPropertyNames(handlers.actions);
  if (Reflect.ownKeys(handlers.actions).length !== registered.length || registered.some(name => !Object.hasOwn(manifest.actions, name)) || actionNames.some(name => !Object.hasOwn(handlers.actions, name) || typeof handlers.actions[name] !== "function")) {
    throw new ServerError("E_SERVER_HANDLERS", "supply exactly one own handler for every declared action");
  }
  if (handlers.effects && Reflect.ownKeys(handlers.effects).some(name => typeof name !== "string" || !Object.hasOwn(manifest.effects, name) || typeof handlers.effects?.[name] !== "function")) {
    throw new ServerError("E_SERVER_HANDLERS", "effect handlers must name declared effects");
  }
  const secretValues = new Set<string>([token]);
  for (const declaration of [...actionNames.map(name => manifest.actions[name]!), ...Object.getOwnPropertyNames(manifest.effects).map(name => manifest.effects[name]!)]) {
    for (const name of declaration.secrets) if (Object.hasOwn(env, name) && env[name]) secretValues.add(env[name]!);
  }
  const redact = redactor(secretValues);
  const actions: Record<string, ActionHandler<never>> = Object.create(null);
  for (const name of actionNames) {
    const declaration = manifest.actions[name]!;
    const handler = handlers.actions[name]!;
    actions[name] = async (args, meta) => {
      if (!declaration.contract || meta.contract !== declaration.contract) throw new ServerError("E_ACTION_GENERATION", "regenerate the server handlers for this action contract");
      const secrets: Record<string, string> = Object.create(null);
      for (const secret of declaration.secrets) {
        const value = Object.hasOwn(env, secret) ? env[secret] : undefined;
        if (!value) throw new ServerError("E_SECRET_MISSING", `the declared secret ${secret} is missing or empty`);
        secrets[secret] = value;
      }
      const scopedRedact = (message: string) => redact(message.split(meta.session.token).join("[REDACTED]"));
      const lifetime = context(meta, Object.freeze(secrets), { ...options, url, token }, scopedRedact);
      try {
        lifetime.context.invocation.signal.throwIfAborted();
        const result = await handler(args, lifetime.context as never);
        lifetime.context.invocation.signal.throwIfAborted();
        return JSON.parse(strictJson(result, "E_ACTION_RESULT")) as unknown;
      } finally { await lifetime.close(); }
    };
  }
  return runWorker({ ...options, url, token, actions, ...(handlers.effects ? { effects: handlers.effects } : {}), redact });
}

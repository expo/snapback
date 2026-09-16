// Node's application runtime; generated/server.ts binds the declared handlers.
import type { Client } from "./contract.ts";
import { runWorker, type ActionHandler, type EffectHandler, type Worker, type WorkerOptions } from "./worker.ts";
import { context } from "./server-context.ts";
import { redactor, ServerError, strictJson } from "./server-json.ts";
import type { StepRunner } from "./server-steps.ts";
import { applicationRefusal, routeRequest, routeResponse, type RouteDeclaration, type ServiceRoute } from "./server-routes.ts";
import { runVerifiers } from "./server-verify.ts";
export { ParkStep, ServerError } from "./server-json.ts";
export type { StepOptions } from "./server-steps.ts";
export type { RouteHandler, ServiceRoute, RouteRequest, VerificationContext } from "./server-routes.ts";

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
  readonly routes?: Readonly<Record<string, RouteDeclaration>>;
}

export interface ServerOptions extends Omit<WorkerOptions, "url" | "token" | "actions" | "effects" | "redact" | "onAuthFailure" | "actionRegistry"> {
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
  readonly actions?: Readonly<Record<string, (args: never, ctx: never) => unknown>>;
  readonly effects?: Readonly<Record<string, EffectHandler<never>>>;
  readonly routes?: Readonly<Record<string, ((req: never, ctx: never) => unknown) | {
    readonly verify: (req: never, ctx: never) => unknown;
    readonly handle: (req: never, ctx: never) => unknown;
  }>>;
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
  const actionHandlers = handlers.actions === undefined ? {} : handlers.actions;
  if (!actionHandlers || typeof actionHandlers !== "object" || Array.isArray(actionHandlers)
    || Reflect.ownKeys(actionHandlers).length !== actionNames.length
    || Reflect.ownKeys(actionHandlers).some(name => typeof name !== "string" || !Object.hasOwn(manifest.actions, name))
    || actionNames.some(name => name.startsWith("@route/") || !Object.hasOwn(actionHandlers, name) || typeof actionHandlers[name] !== "function")) {
    throw new ServerError("E_SERVER_HANDLERS", "supply exactly one own handler for every declared action");
  }
  if (handlers.effects && Reflect.ownKeys(handlers.effects).some(name => typeof name !== "string" || !Object.hasOwn(manifest.effects, name) || typeof handlers.effects?.[name] !== "function")) {
    throw new ServerError("E_SERVER_HANDLERS", "effect handlers must name declared effects");
  }
  const routeDeclarations = manifest.routes ?? {};
  const routeNames = Object.getOwnPropertyNames(routeDeclarations);
  const routeHandlers = handlers.routes === undefined ? {} : handlers.routes;
  if (!routeHandlers || typeof routeHandlers !== "object" || Array.isArray(routeHandlers)
    || Reflect.ownKeys(routeHandlers).length !== routeNames.length
    || Reflect.ownKeys(routeHandlers).some(name => typeof name !== "string" || !Object.hasOwn(routeDeclarations, name))
    || routeNames.some(name => !Object.hasOwn(routeHandlers, name))) {
    throw new ServerError("E_SERVER_HANDLERS", "supply exactly one own handler for every declared route");
  }
  for (const name of routeNames) {
    const declaration = routeDeclarations[name]!, handler = routeHandlers[name];
    if (declaration.service === null ? typeof handler !== "function"
      : typeof declaration.service !== "string" || !handler || typeof handler !== "object" || Array.isArray(handler)
        || Reflect.ownKeys(handler).length !== 2 || !Object.hasOwn(handler, "verify") || !Object.hasOwn(handler, "handle")
        || typeof handler.verify !== "function" || typeof handler.handle !== "function") {
      throw new ServerError("E_SERVER_HANDLERS", "session routes need a function; service routes need exactly own verify and handle functions");
    }
  }
  const secretValues = new Set<string>([token]);
  for (const declaration of [...actionNames.map(name => manifest.actions[name]!), ...Object.getOwnPropertyNames(manifest.effects).map(name => manifest.effects[name]!), ...routeNames.map(name => routeDeclarations[name]!)]) {
    for (const name of declaration.secrets) if (Object.hasOwn(env, name) && env[name]) secretValues.add(env[name]!);
  }
  const redact = redactor(secretValues);
  const secretsFor = (names: readonly string[]): Readonly<Record<string, string>> => {
    const secrets: Record<string, string> = Object.create(null);
    for (const secret of names) {
      const value = Object.hasOwn(env, secret) ? env[secret] : undefined;
      if (!value) throw new ServerError("E_SECRET_MISSING", `the declared secret ${secret} is missing or empty`);
      secrets[secret] = value;
    }
    return Object.freeze(secrets);
  };
  const stop = new AbortController();
  const abort = () => stop.abort(options.signal?.reason);
  if (options.signal?.aborted) abort(); else options.signal?.addEventListener("abort", abort, { once: true });
  const runtimeOptions = { ...options, url, token, signal: stop.signal };
  const actions: Record<string, ActionHandler<never>> = Object.create(null);
  const bind = (declaration: { contract: string; secrets: readonly string[] }, handler: (args: unknown, ctx: ServerContext<string>, redact: (message: string) => string) => unknown): ActionHandler<never> => {
    return async (args, meta) => {
      if (!declaration.contract || meta.contract !== declaration.contract) throw new ServerError("E_ACTION_GENERATION", "regenerate the server handlers for this action contract");
      const scopedRedact = (message: string) => redact(message.split(meta.session.token).join("[REDACTED]"));
      const lifetime = context(meta, secretsFor(declaration.secrets), runtimeOptions, scopedRedact);
      try {
        lifetime.context.invocation.signal.throwIfAborted();
        const result = await handler(args, lifetime.context, scopedRedact);
        lifetime.context.invocation.signal.throwIfAborted();
        return JSON.parse(strictJson(result, "E_ACTION_RESULT")) as unknown;
      } finally { await lifetime.close(); }
    };
  };
  for (const name of actionNames) {
    const handler = actionHandlers[name]!;
    actions[name] = bind(manifest.actions[name]!, (args, ctx) => handler(args as never, ctx as never));
  }
  const verifiers: Record<string, { declaration: RouteDeclaration; handler: ServiceRoute<string> }> = Object.create(null);
  for (const name of routeNames) {
    const declaration = routeDeclarations[name]!, registered = routeHandlers[name]!;
    const handler = typeof registered === "function" ? registered : registered.handle;
    if (declaration.service !== null) verifiers[name] = { declaration, handler: registered as ServiceRoute<string> };
    actions[`@route/${name}`] = bind(declaration, async (args, ctx, redact) => {
      if (!args || typeof args !== "object" || Reflect.ownKeys(args).length !== 1 || !Object.hasOwn(args, "request")) throw new ServerError("E_ROUTE_RESULT", "invalid private route arguments", "route");
      const request = routeRequest((args as { request: unknown }).request, declaration);
      let result: unknown;
      try { result = await handler(request as never, ctx as never); }
      catch (error) {
        ctx.invocation.signal.throwIfAborted();
        const acknowledged = applicationRefusal(error, redact);
        if (acknowledged) return acknowledged;
        throw error;
      }
      return routeResponse(result, ctx.invocation.signal);
    });
  }
  const workers = [runWorker({ ...runtimeOptions, actions, actionRegistry: true, ...(handlers.effects ? { effects: handlers.effects } : {}), redact, onAuthFailure: () => stop.abort() })];
  if (Object.keys(verifiers).length) workers.push(runVerifiers({ ...runtimeOptions, routes: verifiers, secrets: secretsFor, redact, stop: () => stop.abort() }));
  const done = Promise.allSettled(workers.map(worker => worker.done.catch(error => { stop.abort(error); throw error; }))).then(results => {
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }).finally(() => { stop.abort(); options.signal?.removeEventListener("abort", abort); });
  return { done, principal: () => workers.map(worker => worker.principal()).find(value => value !== null) ?? null };
}

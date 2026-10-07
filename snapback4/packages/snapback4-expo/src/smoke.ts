// @ref LLP 3000.011.005.000#2 — execute inside the installed app on its own client.
import type { Client, Query } from "snapback4/contract";
import type { DeviceCore } from "snapback4/local";
import { createWitness, type WitnessContainer } from "./witness-core.ts";

type State = {
  rows: Record<string, number>; watermark: number; generation: number;
  storeId: string; acquired: boolean; backendRequired: boolean;
};
type Backend = {
  generation: number;
  programs: { name: string; kind: string; native?: boolean; args: Record<string, unknown> }[];
  schema: { operations?: Record<string, { runs?: "device" | "server"; held?: boolean }> };
};
type Fact = { runs: "device" | "server"; held: boolean };
type Baseline = State & { origin: string; viewer: string };
type ErrorUtils = {
  getGlobalHandler(): (error: Error, fatal?: boolean) => void;
  setGlobalHandler(handler: (error: Error, fatal?: boolean) => void): void;
};
type Environment = {
  runtime?: Parameters<typeof createWitness>[1];
  errors?: ErrorUtils;
  now?: () => number;
  pause?: () => Promise<void>;
};
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`E_WITNESS_STEP: ${message}`);
}

/** Kept separately from Expo imports so the segment logic runs against mock devices. */
export function createSmoke(container: WitnessContainer, environment: Environment = {}) {
  if (!container.witnessLaunch) return null;
  const config = JSON.parse(container.witnessLaunch);
  if (config.smoke !== true) return null;
  assert(["prime", "offline", "restart"].includes(config.segment), "unknown smoke segment");
  const w = createWitness(container, environment.runtime)!;
  const now = environment.now ?? Date.now;
  const pause = environment.pause ?? (() => new Promise<void>(resolve => setTimeout(resolve, 100)));
  const startedAt = now();
  const errors: { message: string; fatal: boolean }[] = [];
  const errorUtils = environment.errors ?? (globalThis as typeof globalThis & { ErrorUtils?: ErrorUtils }).ErrorUtils;
  const previous = errorUtils?.getGlobalHandler();
  const handler = (error: Error, fatal?: boolean) => {
    errors.push({ message: String(error?.message ?? error), fatal: fatal === true });
    // Synchronous native append survives the previous handler terminating JS.
    try {
      container.witnessAppend(JSON.stringify({ smoke: { segment: w.segment, pass: false, errors: [...errors] },
        witness: { at: new Date().toISOString(), step: "smoke:failed" } }) + "\n");
    } finally { previous?.(error, fatal); }
  };
  errorUtils?.setGlobalHandler(handler);
  type Attachment = { client: Client; device: DeviceCore; origin: string };
  const superseded = Symbol("superseded smoke client");
  let latest: Attachment | undefined;
  let running: Promise<void> | undefined;
  const checkTime = () => {
    assert(errors.length === 0, "uncaught JavaScript error");
    assert(now() - startedAt < config.timeoutMs, "timed out waiting for smoke client or sync watermark");
  };
  const start = () => running ??= w.step({ prime: "primed", offline: "offline-done", restart: "done" }[w.segment]!, async () => {
    for (;;) {
      checkTime();
      if (!latest) { await pause(); continue; }
      const attached = latest;
      try { await sample(attached); return; }
      catch (error) { if (error !== superseded) throw error; }
    }
  });
  const attach = (client: Client, device: DeviceCore, origin: string): (() => void) => {
    const attached = latest = { client, device, origin };
    void start().catch(() => { /* step already durably recorded the failure */ });
    return () => { if (latest === attached) latest = undefined; };
  };
  async function sample(attached: Attachment) {
    const { client, device, origin } = attached;
    const current = () => { if (latest !== attached) throw superseded; };
    let state: State | undefined;
    const queries: Record<string, unknown>[] = [];
    const read = async <T>(op: string): Promise<T> => {
      current();
      let result: Record<string, unknown>;
      try { result = await device.call({ op }); } finally { current(); }
      assert(!result.denied && result.ok, `${op} refused: ${JSON.stringify(result.denied)}`);
      return result.ok as T;
    };
    const wait = async (condition: () => Promise<boolean>) => {
      while (!(await condition())) { checkTime(); await pause(); current(); }
    };
    const snapshot = async () => {
      state = await read<State>("witness_state");
      assert(state && typeof state.storeId === "string" && state.storeId.length > 0
        && Number.isSafeInteger(state.watermark) && state.watermark >= 0
        && state.rows && Object.values(state.rows).every(n => Number.isSafeInteger(n) && n >= 0), "invalid device smoke state");
    };
    const ready = () => client.viewer() !== null && client.link() === (w.segment === "offline" ? "offline" : "online")
      && client.acquired && state!.acquired && !state!.backendRequired;
    const identity = () => {
      if (w.segment === "prime") return;
      const baseline = config.baseline as Baseline | undefined;
      assert(baseline && baseline.origin === origin && baseline.viewer === client.viewer()
        && baseline.storeId === state!.storeId && baseline.generation === state!.generation,
      "prime's backend/session identity does not match this launch");
      if (w.segment === "offline") {
        assert(JSON.stringify(Object.entries(state!.rows).sort()) === JSON.stringify(Object.entries(baseline.rows).sort()), "held row counts differ from prime");
      }
    };
    const barrier = () => {
      assert(Number.isSafeInteger(config.barrierSeq) && config.barrierSeq > config.baseline?.watermark, "invalid restart sync barrier");
      return state!.watermark >= config.barrierSeq;
    };
    const receipt = (pass: boolean, error?: unknown) => w.receipt({ smoke: {
      segment: w.segment, pass, startedAt, endedAt: now(), durationMs: now() - startedAt,
      origin, viewer: client.viewer(), link: client.link(), ...state, queryFacts: config.queryFacts, queryGeneration: config.queryGeneration, queries, errors: [...errors],
      assets: { state: "not-exercised", reason: "generic smoke checks acquisition and queries; an application witness must record useAsset states and native media load/error events" },
      ...(w.segment === "restart" ? { barrierSeq: config.barrierSeq } : {}),
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    } });
    try {
      assert(errorUtils, "the native JavaScript error handler is unavailable");
      await wait(async () => { await snapshot(); return ready(); });
      identity();
      if (w.segment === "restart") {
        await wait(async () => { await snapshot(); identity(); return ready() && barrier(); });
      }
      // @ref LLP 3000.011.005.000#2 — residency comes from compiler facts, never a loading result.
      const facts = config.queryFacts as Record<string, Fact> | undefined;
      assert(facts && typeof facts === "object" && !Array.isArray(facts), "missing compiler query facts");
      const backend = await read<Backend>("backend");
      assert(Number.isSafeInteger(config.queryGeneration) && config.queryGeneration > 0
        && backend.generation === config.queryGeneration && state!.generation === config.queryGeneration,
        "compiler query facts do not match the kept backend generation");
      const eligible = backend.programs.filter(program => program.kind === "Query"
        && Object.values(program.args).every(type => type !== null && typeof type === "object" && "Optional" in type));
      assert(JSON.stringify(eligible.map(p => p.name).sort()) === JSON.stringify(Object.keys(facts).sort()),
        "compiler query facts do not match the kept program");
      assert(eligible.every(program => program.native !== true),
        "native queries require an application witness; generic smoke cannot classify conditional module availability");
      const validated = eligible.map(program => {
        const fact = facts[program.name];
        assert(fact && ["device", "server"].includes(fact.runs) && typeof fact.held === "boolean",
          `missing compiler residency for ${program.name}`);
        const kept = backend.schema.operations?.[program.name];
        assert(kept && kept.runs === fact.runs && (kept.held ?? false) === fact.held,
          `compiler residency differs from kept backend for ${program.name}`);
        return { program, fact };
      });
      // Validate the entire supplied set before issuing even the first query.
      for (const { program, fact } of validated) {
        const classification = fact.runs === "server" ? "online-only" : "device-answerable";
        if (w.segment !== "offline" && fact.runs !== "server") continue;
        const op = { kind: "query", name: program.name, runs: fact.runs, ...(fact.held ? { held: true } : {}) } as Query<{}, unknown>;
        const result = await client.query(op, {});
        current();
        const query: Record<string, unknown> = { name: program.name, classification };
        queries.push(query);
        if ("data" in result) {
          Object.assign(query, { state: "ready", count: Array.isArray(result.data) ? result.data.length : result.data == null ? 0 : 1,
            complete: result.complete, fresh: result.fresh, cut: result.cut });
        } else if ("denied" in result && result.denied.code && result.denied.message) {
          Object.assign(query, { state: "refused", code: result.denied.code, message: result.denied.message });
        } else if ("loading" in result) { query.state = "loading"; }
        else { throw new Error(`query ${program.name} returned an unknown result`); }
        if (w.segment === "offline" && fact.runs === "server") {
          assert(query.state === "loading" || (query.state === "refused" && /^E_OFFLINE(?:_|$)/.test(String(query.code))),
            `online-only query ${program.name} did not report offline unavailability`);
          query.expectation = "online-only: unavailable offline (expected)";
        } else if (fact.runs === "server") {
          assert(query.state === "ready", `online-only query ${program.name} did not answer online`);
        } else {
          assert(query.state === "ready" || query.state === "refused", `query ${program.name} returned neither ready nor an explained refusal`);
        }
      }
      // Give the mounted app a turn, then attest the state that exists now.
      await pause();
      await snapshot();
      assert(ready(), "session, link or acquisition changed before receipt");
      identity();
      if (w.segment === "restart") assert(barrier(), "sync watermark is below the restart barrier");
      assert(errors.length === 0, "uncaught JavaScript error");
      current();
      await receipt(true);
    } catch (error) {
      current(); // A closed or replaced candidate cannot emit failure evidence.
      await receipt(false, error); throw error;
    }
  }
  return { attach, run: (client: Client, device: DeviceCore, origin: string) => {
    attach(client, device, origin); return running!;
  }, dispose: () => { latest = undefined; if (previous) errorUtils?.setGlobalHandler(previous); } };
}

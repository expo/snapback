// @ref LLP 3000.011.005.000#2 — execute inside the installed app on its own client.
import type { Client, Query } from "snapback4/contract";
import type { DeviceCore } from "snapback4/local";
import { createWitness, type WitnessContainer } from "./witness-core.ts";

type State = {
  rows: Record<string, number>; watermark: number; generation: number;
  storeId: string; acquired: boolean; backendRequired: boolean;
};
type Backend = {
  programs: { name: string; kind: string; args: Record<string, unknown> }[];
  schema: { operations?: Record<string, { runs?: "device" | "server"; held?: boolean }> };
};
type Baseline = State & { origin: string; viewer: string };
type ErrorUtils = {
  getGlobalHandler(): (error: Error, fatal?: boolean) => void;
  setGlobalHandler(handler: (error: Error, fatal?: boolean) => void): void;
};
type Environment = {
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
  const w = createWitness(container)!;
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
      origin, viewer: client.viewer(), link: client.link(), ...state, queries, errors: [...errors],
      ...(w.segment === "restart" ? { barrierSeq: config.barrierSeq } : {}),
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    } });
    try {
      assert(errorUtils, "the native JavaScript error handler is unavailable");
      await wait(async () => { await snapshot(); return ready(); });
      identity();
      if (w.segment === "offline") {
        const backend = await read<Backend>("backend");
        for (const program of backend.programs) {
          if (program.kind !== "Query" || !Object.values(program.args).every(type => type !== null && typeof type === "object" && "Optional" in type)) continue;
          const fact = backend.schema.operations?.[program.name] ?? {};
          const op = { kind: "query", name: program.name, ...(fact.runs ? { runs: fact.runs } : {}), ...(fact.held ? { held: true } : {}) } as Query<{}, unknown>;
          const result = await client.query(op, {});
          current();
          if ("data" in result) {
            queries.push({ name: program.name, state: "ready", count: Array.isArray(result.data) ? result.data.length : result.data == null ? 0 : 1,
              complete: result.complete, fresh: result.fresh, cut: result.cut });
          } else if ("denied" in result && result.denied.code && result.denied.message) {
            queries.push({ name: program.name, state: "refused", code: result.denied.code, message: result.denied.message });
          } else { throw new Error(`query ${program.name} returned neither ready nor an explained refusal`); }
        }
      } else if (w.segment === "restart") {
        await wait(async () => { await snapshot(); identity(); return ready() && barrier(); });
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

import { createHash } from "node:crypto";
import { GiveUp } from "./worker.ts";
import { label, ParkStep, ServerError, strictJson } from "./server-json.ts";

export interface StepOptions<T> {
  /** Recover or deduplicate a previous attempt using the provider's stable key.
   * Throw ParkStep when no safe outcome can be established. */
  readonly reconcile?: (key: string) => T | Promise<T>;
}

export interface StepRunner {
  <T>(name: string, input: unknown, fn: (key: string) => T | Promise<T>, options?: StepOptions<T>): Promise<T>;
}

interface StepReply {
  readonly step?: { readonly state: "run" | "reconcile" | "done"; readonly key: string; readonly result?: unknown };
}

export function writeIdFor(invocation: string, name: string): string {
  label(name, "E_WRITE_LABEL");
  const digest = createHash("sha256").update(JSON.stringify(["snapback4:write:v1", invocation, name])).digest();
  let value = 0n;
  for (const byte of digest.subarray(0, 16)) value = (value << 8n) | BigInt(byte);
  let id = "";
  for (let index = 0; index < 26; index++) {
    id = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[Number(value & 31n)] + id;
    value >>= 5n;
  }
  return id;
}

// @ref LLP 3000.009#5.2 — unfinished external work reconciles through its key or parks.
export function steps(
  post: (path: string, body: unknown) => Promise<unknown>,
  assertActive: () => void,
  redact: (message: string) => string,
): StepRunner {
  const entries = new Map<string, { digest: string; outcome: Promise<string> }>();
  return async <T>(name: string, input: unknown, fn: (key: string) => T | Promise<T>, options?: StepOptions<T>): Promise<T> => {
    assertActive();
    label(name, "E_STEP_INPUT");
    const encoded = strictJson(input, "E_STEP_INPUT");
    const digest = createHash("sha256").update(encoded).digest("hex");
    const previous = entries.get(name);
    if (previous && previous.digest !== digest) throw new ServerError("E_STEP_INPUT", "this step was already called with different input");
    if (previous) return JSON.parse(await previous.outcome) as T;
    const path = `/steps/${encodeURIComponent(name)}`;
    const park = async (error: unknown): Promise<never> => {
      const message = redact(error instanceof Error ? error.message : String(error));
      const reply = await post(`${path}/park`, { error: message }) as { ok?: boolean };
      if (reply.ok !== true) throw new Error("the server did not acknowledge parking the step");
      throw new ServerError("E_STEP_PARKED", "the external step needs an operator to establish its outcome");
    };
    const run = async (): Promise<string> => {
      // Never retry begin here: its response may be lost after durable admission.
      const reply = await post(`${path}/begin`, { input: JSON.parse(encoded), reconcile: Boolean(options?.reconcile) }) as StepReply;
      const step = reply.step;
      if (!step || typeof step.key !== "string" || !["run", "reconcile", "done"].includes(step.state)) {
        throw new Error("the server returned an invalid step response");
      }
      assertActive();
      if (step.state === "done") return strictJson(step.result, "E_STEP_RESULT");
      if (step.state === "reconcile" && !options?.reconcile) return park(new ParkStep());
      let result: T;
      try { result = await (step.state === "reconcile" ? options!.reconcile!(step.key) : fn(step.key)); }
      catch (error) {
        if (error instanceof ParkStep || (step.state === "reconcile" && error instanceof GiveUp)) return park(error);
        throw error;
      }
      assertActive();
      const outcome = strictJson(result, "E_STEP_RESULT");
      const recorded = await post(`${path}/done`, { result: JSON.parse(outcome) }) as { ok?: boolean };
      if (recorded.ok !== true) throw new Error("the server did not acknowledge the step outcome");
      return outcome;
    };
    // Schedule after insertion: even reentrant/concurrent same-name calls join
    // this attempt, including an uncertain rejection. Only a new claim resumes.
    const outcome = Promise.resolve().then(run);
    entries.set(name, { digest, outcome });
    return JSON.parse(await outcome) as T;
  };
}

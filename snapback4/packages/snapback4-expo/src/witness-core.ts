/** The app owns receipt fields; only `witness` is reserved for this protocol. */
export interface Witness {
  readonly segment: string;
  step<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
  receipt(object: Record<string, unknown>): Promise<void>;
  waitFor(label: string): Promise<void>;
}

export interface WitnessContainer {
  readonly witnessLaunch: string | null;
  witnessAppend(line: string): void;
  witnessSignaled(label: string): boolean;
}

// @ref LLP 3000.007#20.10 — app-owned receipts, completed steps and container-file signals
export function createWitness(container: WitnessContainer | null): Witness | null {
  if (!container?.witnessLaunch) return null;
  const { segment, timeoutMs } = JSON.parse(container.witnessLaunch);
  if (typeof segment !== "string" || !segment || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("E_WITNESS_INPUT: invalid witness launch configuration");
  }
  const native = container;
  let current = "launched";
  let active = false;
  const append = (object: Record<string, unknown>, step: string) => {
    if (!object || Array.isArray(object) || typeof object !== "object" || "witness" in object) {
      throw new Error("E_WITNESS_RECEIPT: receipt must be an object without the reserved witness key");
    }
    // Serialize app code before installing the protocol envelope: neither a
    // getter nor toJSON can run again on the parsed plain object.
    let serialized: Record<string, unknown>;
    try {
      serialized = JSON.parse(JSON.stringify(object));
      if (!serialized || Array.isArray(serialized) || typeof serialized !== "object" || "witness" in serialized) throw Error();
    } catch {
      throw new Error("E_WITNESS_RECEIPT: serialized receipt must be an object without the reserved witness key");
    }
    native.witnessAppend(`${JSON.stringify({ ...serialized, witness: { at: new Date().toISOString(), step } })}\n`);
  };
  return {
    segment,
    async receipt(object) { append(object, current); },
    async step(name, fn) {
      if (!/^[a-zA-Z0-9_-]+$/.test(name) || active) throw new Error("E_WITNESS_STEP: steps must be named and sequential");
      active = true;
      current = `${name}:running`;
      try {
        const value = await fn();
        append({}, name);
        return value;
      } catch (error) {
        // The failure's own message is the first thing anyone reading the receipts needs.
        append({ error: error instanceof Error ? error.message : String(error) }, `${name}:failed`);
        throw error;
      } finally { active = false; current = "between-steps"; }
    },
    async waitFor(label) {
      if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error("E_WITNESS_INPUT: invalid signal label");
      const end = Date.now() + timeoutMs;
      while (!native.witnessSignaled(label)) {
        if (Date.now() >= end) throw new Error(`E_WITNESS_TIMEOUT: waiting for ${label}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  };
}

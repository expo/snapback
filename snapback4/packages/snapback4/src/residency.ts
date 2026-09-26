import type { Refusal, Residency } from "./contract.ts";

export function residencyError(why: Refusal): Error {
  return Object.assign(new Error(`${why.code}: ${why.message}`), why);
}

// @ref LLP 3000.019#3.4 — one public call across persistence hosts; recheck session custody after the read.
export async function readResidency(call: (request: Record<string, unknown>) => Promise<{ ok?: unknown; denied?: Refusal }>, unavailable: () => Refusal | null): Promise<Residency> {
  const before = unavailable();
  if (before) throw residencyError(before);
  const result = await call({ op: "residency" });
  const denied = unavailable() ?? result.denied;
  if (denied) throw residencyError(denied);
  return result.ok as Residency;
}

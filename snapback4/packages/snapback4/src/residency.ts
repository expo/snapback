import type { Refusal, Residency } from "./contract.ts";

export function residencyError(why: Refusal): Error {
  return Object.assign(new Error(`${why.code}: ${why.message}`), why);
}

// @ref LLP 3000.019#3.4 — one public call across persistence hosts; recheck session custody after the read.
export async function readResidency(call: (request: Record<string, unknown>) => Promise<{ ok?: unknown; denied?: Refusal }>, unavailable: () => Refusal | null): Promise<Residency> {
  const before = unavailable();
  if (before) throw residencyError(before);
  let result;
  try { result = await call({ op: "residency" }); }
  catch (error) {
    throw residencyError(unavailable() ?? {
      code: "E_STORE", family: "store", site: "client.residency",
      message: `cannot read device residency: ${String(error)}`,
      rewrite: "restart the failed device host and reopen the client, then retry client.residency()",
      guide: "residency",
    });
  }
  const denied = unavailable() ?? result.denied;
  if (denied) throw residencyError(denied);
  return result.ok as Residency;
}

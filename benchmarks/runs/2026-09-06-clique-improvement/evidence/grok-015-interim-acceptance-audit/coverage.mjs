import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function suiteRequiredIds(instrumentDir, milestone) {
  const raw = JSON.parse(await readFile(resolve(instrumentDir, "schema/social-messenger/assertions.json"), "utf8"));
  const key = milestone.toUpperCase();
  return (raw.milestones[key]?.assertions ?? [])
    .filter((a) => a.executor === "suite-required")
    .map((a) => a.id);
}

export function mapCoverage(ids, results) {
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  const assertions = {};
  for (const id of ids) {
    const hit = byId[id] ?? results.find((r) => r.id.startsWith(id.slice(0, 6))) ?? results[0];
    assertions[id] = { test: hit?.id ?? "suite", ok: hit?.ok ?? false };
  }
  return assertions;
}

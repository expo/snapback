import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const started = performance.now();
const [{ hydrateCase }, encoded] = await Promise.all([
  import("./dist/evaluator.mjs"),
  readFile("../corpus/scenario-hydrate.json", "utf8"),
]);
const replay = hydrateCase(JSON.parse(encoded));
const elapsedMs = performance.now() - started;
if (replay.planState !== "ready") throw new Error(replay.diagnostic);
console.log(JSON.stringify({ elapsedMs }));

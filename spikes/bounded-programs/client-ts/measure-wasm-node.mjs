import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const started = performance.now();
const bytes = await readFile("../target/wasm32-unknown-unknown/release/bounded_programs_spike.wasm");
const { instance } = await WebAssembly.instantiate(bytes);
const replayed = instance.exports.replay_first();
const elapsedMs = performance.now() - started;
if (replayed !== 1) throw new Error("Rust/WASM first hydration replay diverged");
console.log(JSON.stringify({ elapsedMs }));

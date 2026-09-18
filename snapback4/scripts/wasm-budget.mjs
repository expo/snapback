// Both byte-reporting scripts refuse an absent or corrupt budget. This helper
// only reports; build-wasm.sh fails on an overrun (the budget is a ratchet, author
// ruling 2026-09-18) while measure-wasm.sh records `over` and keeps measuring.
import { readFileSync } from 'node:fs';
const file = process.argv[2] ?? new URL('../metrics/wasm-budget.json', import.meta.url);
try {
  const { gzip, set, why } = JSON.parse(readFileSync(file, 'utf8'));
  if (!Number.isSafeInteger(gzip) || gzip <= 0 || typeof set !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(set) || typeof why !== 'string' || !why.trim()) throw new Error('expected positive integer gzip, YYYY-MM-DD set, and nonempty why');
  const actual = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
  if (actual !== undefined && (!Number.isSafeInteger(actual) || actual < 0)) throw new Error('measured gzip must be a nonnegative integer');
  console.log(actual === undefined ? gzip : `(budget ${gzip}: ${actual <= gzip ? 'ok' : `OVER by ${actual - gzip} B — issues/20260913-snapback4-wasm-device-diet.md`})`);
} catch (error) {
  console.error(`${file}: ${error.message}`);
  process.exitCode = 1;
}

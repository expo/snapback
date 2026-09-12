// Rows in the Clique fixture's message shape, taken from the frozen scale log
// (benchmarks/fixtures/social-messenger/scale.log): every `send`/`send-media`
// line becomes one message row. Ids are 26-char Crockford base32 of a
// 128-bit (time, counter) value, the client-minted form LLP 2000.000 §7.3 names.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const LOG = join(HERE, "../../benchmarks/fixtures/social-messenger/scale.log");
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function ulid(ms, n) {
  let v = (BigInt(ms) << 80n) | BigInt(n); let s = "";
  for (let i = 0; i < 26; i++) { s = B32[Number(v & 31n)] + s; v >>= 5n; }
  return s;
}
let cache;
export function messages(n) {
  if (!cache) {
    cache = [];
    const lines = readFileSync(LOG, "utf8").split("\n");
    let i = 0;
    for (const line of lines) {
      const m = /^(\S+) (\S+) (send|send-media) (\S+) (\S+) "((?:[^"\\]|\\.)*)"/.exec(line);
      if (!m) continue;
      const at = Date.parse(m[1]) + i;
      cache.push({ id: ulid(at, i), conversationId: m[5], authorId: m[2], body: m[6], at, editedAt: null });
      i++;
    }
  }
  // The frozen log holds 99,090 text sends; a larger request returns all of them.
  return cache.slice(0, Math.min(n, cache.length));
}
export function envelopes(rows, seq0 = 1) {
  return rows.map((row, i) => ({ seq: seq0 + i, table: "messages", op: "insert", row }));
}
export function ms(t0) { return Number(process.hrtime.bigint() - t0) / 1e6; }
export function now() { return process.hrtime.bigint(); }

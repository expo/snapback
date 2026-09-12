// Floor 1: one HTTP response carrying N partition-log rows, gzip and brotli.
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { messages, envelopes, now, ms } from "./rows.mjs";
for (const n of [10_000, 100_000]) {
  const rows = envelopes(messages(n));
  const t0 = now(); const json = Buffer.from(JSON.stringify(rows)); const tj = ms(t0);
  const t1 = now(); const g6 = gzipSync(json, { level: 6 }); const tg6 = ms(t1);
  const t2 = now(); const g9 = gzipSync(json, { level: 9 }); const tg9 = ms(t2);
  const t3 = now(); const br = brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }); const tbr = ms(t3);
  const bodyBytes = rows.reduce((a, e) => a + Buffer.byteLength(e.row.body), 0);
  console.log(JSON.stringify({ floor: "response", rows: rows.length, jsonBytes: json.length, bodyBytes, bytesPerRow: Math.round(json.length / n),
    gzip6Bytes: g6.length, gzip6Ms: +tg6.toFixed(1), gzip9Bytes: g9.length, gzip9Ms: +tg9.toFixed(1), brotli5Bytes: br.length, brotli5Ms: +tbr.toFixed(1), stringifyMs: +tj.toFixed(1) }));
}

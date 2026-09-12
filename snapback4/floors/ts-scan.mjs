// Floor 4a: a local query over 100k rows held by a TypeScript/JavaScript runtime
// (an array plus one Map index), as a replica-backed interpreter would see them.
import { messages, now, ms } from "./rows.mjs";
const rows = messages(100_000);
const h0 = process.memoryUsage().heapUsed;
const t0 = now(); const byConv = new Map(); for (const r of rows) { let a = byConv.get(r.conversationId); if (!a) byConv.set(r.conversationId, a = []); a.push(r); } for (const a of byConv.values()) a.sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1)); const tIndex = ms(t0);
const convs = [...byConv.keys()];
let n = 0; const t1 = now(); for (let i = 0; i < 1_000; i++) { const a = byConv.get(convs[i % convs.length]); n += a.slice(Math.max(0, a.length - 50)).length; } const tPage = ms(t1);
const t2 = now(); const c = convs[0]; const scan = rows.filter(r => r.conversationId === c).sort((x, y) => y.at - x.at).slice(0, 50); const tScan = ms(t2);
const t3 = now(); let hits = 0; const needle = "signal 004"; for (const r of rows) if (r.body.includes(needle)) hits++; const tSearch = ms(t3);
const h1 = process.memoryUsage().heapUsed;
console.log(JSON.stringify({ floor: "js-query", rows: rows.length, conversations: convs.length, indexBuildMs: +tIndex.toFixed(1), threadPageUs: +((tPage / 1000) * 1000).toFixed(2), rowsReturned: n, fullScanPageMs: +tScan.toFixed(2), scanPageRows: scan.length, bodySearchMs: +tSearch.toFixed(1), searchHits: hits, heapMB: +((h1 - h0) / 1048576).toFixed(1) }));

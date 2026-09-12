// Floors 3 (native SQLite bulk insert, stand-in for expo-sqlite), 4b (local
// query over 100k rows in SQLite) and 5 (a 50-member send's partition fan-out).
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { messages, envelopes, now, ms, ulid } from "./rows.mjs";
const dir = mkdtempSync(join(tmpdir(), "sb4-floor-"));
function open(name, sync) {
  const db = new DatabaseSync(join(dir, name));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=${sync};
    CREATE TABLE messages(id TEXT PRIMARY KEY, conversationId TEXT NOT NULL, authorId TEXT NOT NULL, body TEXT, at INTEGER NOT NULL, editedAt INTEGER);
    CREATE INDEX byConvTime ON messages(conversationId, at, id);
    CREATE TABLE partition_log(seq INTEGER PRIMARY KEY, tbl TEXT NOT NULL, op TEXT NOT NULL, id TEXT NOT NULL, row TEXT NOT NULL);
    CREATE TABLE recipient_log(recipient TEXT NOT NULL, seq INTEGER NOT NULL, tbl TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(recipient, seq));`);
  return db;
}
function insertBatch(db, rows, seq0) {
  const im = db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?)");
  const il = db.prepare("INSERT INTO partition_log VALUES(?,?,?,?,?)");
  let seq = seq0;
  for (const r of rows) { im.run(r.id, r.conversationId, r.authorId, r.body, r.at, r.editedAt); il.run(seq++, "messages", "insert", r.id, JSON.stringify(r)); }
  return seq;
}
const out = [];
for (const sync of ["NORMAL", "FULL"]) {
  // one transaction, 10k rows (message + log row each)
  { const db = open(`one-${sync}.db`, sync); const rows = messages(10_000);
    const t0 = now(); db.exec("BEGIN"); insertBatch(db, rows, 1); db.exec("COMMIT"); const t = ms(t0);
    out.push({ floor: "sqlite-insert", sync, rows: 10_000, txns: 1, ms: +t.toFixed(1) }); db.close(); }
  // 200 transactions of 50 (the Snapback 2 page-at-a-time pattern)
  { const db = open(`pages-${sync}.db`, sync); const rows = messages(10_000);
    const t0 = now(); let seq = 1; for (let i = 0; i < rows.length; i += 50) { db.exec("BEGIN"); seq = insertBatch(db, rows.slice(i, i + 50), seq); db.exec("COMMIT"); } const t = ms(t0);
    out.push({ floor: "sqlite-insert", sync, rows: 10_000, txns: 200, ms: +t.toFixed(1) }); db.close(); }
}
// 100k rows in 20 transactions of 5k, then queries
{ const db = open("big.db", "NORMAL"); const rows = messages(100_000);
  const t0 = now(); let seq = 1; for (let i = 0; i < rows.length; i += 5_000) { db.exec("BEGIN"); seq = insertBatch(db, rows.slice(i, i + 5_000), seq); db.exec("COMMIT"); } const tIns = ms(t0);
  out.push({ floor: "sqlite-insert", sync: "NORMAL", rows: rows.length, txns: Math.ceil(rows.length/5000), ms: +tIns.toFixed(1) });
  const convs = [...new Set(rows.map(r => r.conversationId))];
  const page = db.prepare("SELECT id, authorId, body, at FROM messages WHERE conversationId = ? ORDER BY at DESC, id DESC LIMIT 50");
  let n = 0; const t1 = now(); for (let i = 0; i < 1_000; i++) n += page.all(convs[i % convs.length]).length; const tPage = ms(t1);
  const t2 = now(); const c = db.prepare("SELECT count(*) AS n FROM messages").get().n; const tCount = ms(t2);
  const t3 = now(); const hits = db.prepare("SELECT count(*) AS n FROM messages WHERE body LIKE ?").get("%signal 004%").n; const tLike = ms(t3);
  out.push({ floor: "sqlite-query", rows: rows.length, conversations: convs.length, threadPageUs: +((tPage / 1000) * 1000).toFixed(1), rowsReturned: n, countMs: +tCount.toFixed(2), countRows: c, likeScanMs: +tLike.toFixed(1), likeHits: hits });
  db.close(); }
// fan-out: one send = 1 message row + 1 partition-log row + 50 recipient-log rows, per transaction, durable
for (const sync of ["NORMAL", "FULL"]) {
  const db = open(`fanout-${sync}.db`, sync);
  const im = db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?)"), il = db.prepare("INSERT INTO partition_log VALUES(?,?,?,?,?)"), ir = db.prepare("INSERT INTO recipient_log VALUES(?,?,?,?)");
  const members = Array.from({ length: 50 }, (_, i) => `u${String(i + 1).padStart(4, "0")}`);
  const t0 = now();
  for (let k = 0; k < 100; k++) { const id = ulid(Date.now(), k); db.exec("BEGIN"); im.run(id, "g0001", "u0001", `fan-out ${k}`, Date.now(), null); il.run(k + 1, "messages", "insert", id, "{}"); for (const m of members) ir.run(m, k + 1, "messages", id); db.exec("COMMIT"); }
  const t = ms(t0); out.push({ floor: "sqlite-fanout", sync, sends: 100, recipients: 50, msPerSend: +(t / 100).toFixed(2) }); db.close();
}
for (const o of out) console.log(JSON.stringify(o));

// Floor 2: IndexedDB writes in real Chromium — one transaction of 10k puts, then
// 200 transactions of 50 (the page-at-a-time pattern), then 100k in 5k chunks,
// then an indexed read of one thread page.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { globSync } from "node:fs";
import { messages, envelopes } from "./rows.mjs";
const require = createRequire("/Users/ccheever/projects/snapback/snapback2/packages/snapback2/package.json");
const { chromium } = require("playwright-core");
const [exe] = globSync(`${process.env.HOME}/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`).sort().reverse();
if (!exe) throw new Error("no cached Chromium");
const server = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>floor</title>"); });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage(); await page.goto(url);
const result = await page.evaluate(async (env) => {
  const openDb = (name) => new Promise((res, rej) => { const rq = indexedDB.open(name, 1); rq.onupgradeneeded = () => { const db = rq.result; const st = db.createObjectStore("messages", { keyPath: "id" }); st.createIndex("byConv", ["conversationId", "at"]); db.createObjectStore("log", { keyPath: "seq" }); }; rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
  const putAll = async (db, items) => { const tx = db.transaction(["messages", "log"], "readwrite"); const m = tx.objectStore("messages"), l = tx.objectStore("log"); for (const e of items) { m.put(e.row); l.put(e); } await txDone(tx); };
  const out = {};
  { const db = await openDb("one"); const t0 = performance.now(); await putAll(db, env.slice(0, 10000)); out.oneTxn10kMs = +(performance.now() - t0).toFixed(1); db.close(); }
  { const db = await openDb("pages"); const t0 = performance.now(); for (let i = 0; i < 10000; i += 50) await putAll(db, env.slice(i, i + 50)); out.txns200x50Ms = +(performance.now() - t0).toFixed(1); db.close(); }
  { const db = await openDb("big"); const t0 = performance.now(); for (let i = 0; i < env.length; i += 5000) await putAll(db, env.slice(i, i + 5000)); out.chunks5k100kMs = +(performance.now() - t0).toFixed(1);
    const conv = env[0].row.conversationId; const t1 = performance.now();
    const rows = await new Promise((res, rej) => { const tx = db.transaction("messages"); const rq = tx.objectStore("messages").index("byConv").getAll(IDBKeyRange.bound([conv, 0], [conv, Infinity]), 50); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
    out.indexedPageMs = +(performance.now() - t1).toFixed(2); out.pageRows = rows.length; db.close(); }
  return out;
}, envelopes(messages(100_000)));
await browser.close(); server.close();
console.log(JSON.stringify({ floor: "indexeddb", rows: messages(100_000).length, chromium: exe.split("/")[5], ...result }));

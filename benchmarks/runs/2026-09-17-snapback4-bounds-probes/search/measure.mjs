// Scratch measurement: what does "search every chat I'm in" cost on the published
// 0.2.27 engine, as one naive query vs the card's two-cursor walk, for dense and
// sparse hit distributions? Deterministic meter counters, not latency claims.
import { spawn } from "node:child_process";
import { once } from "node:events";

const binary = process.env.SB;
const sizes = (process.env.SIZES ?? "100,500,1000").split(",").map(Number);
const PER_CHAT = 30;

function seedFor({ chats, hitChats, foreignChats }) {
  const rows = [];
  const room = (g) => `r${String(g).padStart(5, "0")}`;
  for (let g = 0; g < chats; g++) {
    rows.push({ table: "members", row: { id: `${room(g)}-alice`, roomId: room(g), principal: "dev:alice" } });
    rows.push({ table: "members", row: { id: `${room(g)}-bob`, roomId: room(g), principal: "dev:bob" } });
    // hitChats spread evenly across the membership order
    const isHit = hitChats >= chats ? true : (g % Math.floor(chats / hitChats) === 0 && g / Math.floor(chats / hitChats) < hitChats);
    for (let m = 0; m < PER_CHAT; m++) {
      const hit = isHit && m < 24;
      rows.push({ table: "messages", row: { id: `${room(g)}-m${String(m).padStart(3, "0")}`, roomId: room(g), body: hit ? `coffee time number ${m}` : `tea break number ${m}`, at: 1_700_000_000_000 + m * 1000 + g } });
    }
  }
  // chats alice cannot read, all with newer hits: they load the unscoped index
  for (let g = 0; g < foreignChats; g++) {
    const id = `x${String(g).padStart(5, "0")}`;
    rows.push({ table: "members", row: { id: `${id}-zed`, roomId: id, principal: "dev:zed" } });
    for (let m = 0; m < PER_CHAT; m++) rows.push({ table: "messages", row: { id: `${id}-m${String(m).padStart(3, "0")}`, roomId: id, body: `coffee elsewhere ${m}`, at: 1_800_000_000_000 + m * 1000 + g } });
  }
  return rows;
}

async function withServer(fn) {
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(server, "exit");
  let output = "";
  const api = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("not ready: " + output)), 30_000);
    const onData = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } };
    server.stdout.on("data", onData); server.stderr.on("data", onData);
  });
  try { return await fn(api); } finally { server.kill(); await exited; }
}

async function main() {
  for (const dist of ["dense", "sparse5"]) {
    for (const chats of sizes) {
      await withServer(async (api) => {
        const post = async (path, body, persona = "alice") => {
          const r = await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) });
          return r.json();
        };
        const seed = seedFor({ chats, hitChats: dist === "dense" ? chats : 5, foreignChats: 200 });
        // seed in slices under the 16 MiB body ceiling
        for (let i = 0; i < seed.length; i += 20000) {
          const s = await post("/seed", seed.slice(i, i + 20000));
          if (s.seeded === undefined) throw new Error(JSON.stringify(s).slice(0, 400));
        }
        const q = async (op, args) => {
          const t0 = performance.now();
          const v = await post(`/q/${op}`, { args, meter: true });
          const ms = performance.now() - t0;
          return { v, ms };
        };
        const line = (name, { v, ms }) => {
          const m = v.meter ?? {};
          console.log(`${dist.padEnd(8)} chats=${String(chats).padStart(4)} ${name.padEnd(26)} rows=${String(Array.isArray(v.data) ? v.data.length : "-").padStart(3)} complete=${String(v.complete).padEnd(5)} cut=${String(v.cut).padEnd(5)} next=${v.next ? "yes" : "no "} examined=${String(m.examined).padStart(6)} idx=${String(m.indexEntries).padStart(6)} probes=${String(m.probes).padStart(5)} steps=${String(m.steps).padStart(7)} ms=${ms.toFixed(1)}${v.denied ? " DENIED " + JSON.stringify(v.denied).slice(0, 200) : ""}`);
        };
        line("everywhere (1 cursor)", await q("everywhere", { q: "cof", c: null }));
        line("inbox (plain merge)", await q("inbox", { c: null }));
        line("unscoped byWords", await q("unscoped", { q: "cof", c: null }));
        // the card's walk: count requests and total examined to FIRST 20 results and to exhaustion
        let batch = null, requests = 0, examined = 0, found = 0, firstPageRequests = null, firstPageExamined = null, incomplete = 0;
        const t0 = performance.now();
        for (;;) {
          const chatsPage = await q("searchChats", { c: batch }); requests++; examined += chatsPage.v.meter?.examined ?? 0;
          let c = null;
          for (;;) {
            const r = await q("searchChatBatch", { q: "cof", batch, c }); requests++; examined += r.v.meter?.examined ?? 0;
            if (!r.v.complete) incomplete++;
            found += r.v.data.length;
            if (firstPageRequests === null && found >= 20) { firstPageRequests = requests; firstPageExamined = examined; }
            if (!r.v.next) break; c = r.v.next;
          }
          if (!chatsPage.v.next) break; batch = chatsPage.v.next;
        }
        console.log(`${dist.padEnd(8)} chats=${String(chats).padStart(4)} ${"two-cursor walk".padEnd(26)} found=${found} requests=${requests} examined=${examined} incompletePages=${incomplete} toFirst20: requests=${firstPageRequests} examined=${firstPageExamined} wallMs=${(performance.now() - t0).toFixed(0)}`);
      });
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

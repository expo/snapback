// Clique worker: claims `notify` + `digest` effects and appends them to
// push.log (the M6/M8 push-seam evidence). At boot it syncs
// config/windows.json + config/digest.json into sysconfig via /seed
// (dev, same machine).
import { runWorker } from "snapback4/worker";
import { readFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const url = process.env.SNAPBACK_URL ?? "http://127.0.0.1:49340";
const token = process.env.SNAPBACK_SERVICE_TOKEN ?? "";
const logPath = process.env.CLIQUE_PUSH_LOG ?? resolve(root, "push.log");

function logEffect(effect, payload, id) {
  const line = JSON.stringify({ at: new Date().toISOString(), id, effect, payload });
  appendFileSync(logPath, line + "\n");
  console.log(`[worker] ${effect} ${line.slice(0, 220)}`);
}

function parseAnchorMs(s) {
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return 0;
  return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
}

async function syncConfig() {
  try {
    const windows = JSON.parse(readFileSync(resolve(root, "config/windows.json"), "utf8"));
    const digest = JSON.parse(readFileSync(resolve(root, "config/digest.json"), "utf8"));
    const dis = Object.fromEntries((windows.disappearingOptions ?? []).map((o) => [o.value, o.ttlSeconds]));
    const row = {
      key: "v1",
      editWin: windows.editWindowSeconds ?? 900,
      deleteWin: windows.deleteForEveryoneWindowSeconds ?? 3600,
      ttlA: dis["24h"] ?? 86400,
      ttlB: dis["7d"] ?? 604800,
      digestPeriod: (digest.periodSeconds ?? 86400) * 1000,
      digestAnchorMs: parseAnchorMs(digest.periodAnchorUtc ?? "08:00:00"),
      replayOff: false,
    };
    row.id = row.key;
    const res = await fetch(`${url}/seed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ table: "sysconfig", row }]),
    });
    console.log(`[worker] config sync -> ${res.status} ${await res.text()}`);
  } catch (err) {
    console.log(`[worker] config sync skipped: ${err.message}`);
  }
}

await syncConfig();

if (!token) {
  console.log("[worker] no service token; effect claiming disabled (config sync only)");
  process.exit(0);
}

runWorker({
  url,
  token,
  effects: {
    notify: async (payload, meta) => {
      logEffect("notify", payload, meta.id);
      return { logged: true };
    },
    digest: async (payload, meta) => {
      logEffect("digest", payload, meta.id);
      return { logged: true };
    },
  },
});

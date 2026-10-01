// Declares service:notifications. Logs Clique push-seam payloads for acceptance.
import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runWorker } from "snapback4/worker";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const logPath = resolve(root, "data/push-log.jsonl");
await mkdir(dirname(logPath), { recursive: true });

const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());

await runWorker({
  url: process.env.SNAPBACK_URL,
  token: process.env.SNAPBACK_SERVICE_TOKEN,
  ledger: true,
  signal: stop.signal,
  effects: {
    notify: async (payload, meta) => {
      const row = {
        ...payload,
        idempotencyKey: meta.idempotencyKey,
        effectId: meta.id,
        loggedAt: Date.now(),
      };
      await appendFile(logPath, `${JSON.stringify(row)}\n`);
      return { logged: true, idempotencyKey: meta.idempotencyKey };
    },
  },
}).done;

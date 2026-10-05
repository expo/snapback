// Clique push seam. Logs every payload for acceptance; provider I/O is the log.
// snapback4 secrets:
import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runWorker } from "snapback4/worker";

const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());

const logPath = process.env.CLIQUE_PUSH_LOG
  ?? resolve(process.cwd(), "data/push-log.jsonl");

await mkdir(dirname(logPath), { recursive: true });

await runWorker({
  url: process.env.SNAPBACK_URL,
  token: process.env.SNAPBACK_SERVICE_TOKEN,
  ledger: true,
  signal: stop.signal,
  effects: {
    notify: async (payload, meta) => {
      const row = {
        at: new Date().toISOString(),
        idempotencyKey: meta.idempotencyKey,
        payload,
      };
      await appendFile(logPath, `${JSON.stringify(row)}\n`);
      return { logged: true, path: logPath, id: meta.idempotencyKey };
    },
  },
}).done;

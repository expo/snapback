import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runWorker } from "snapback4/worker";

const url = process.env.SNAPBACK_URL;
const token = process.env.SNAPBACK_SERVICE_TOKEN;
if (!url || !token) throw new Error("set SNAPBACK_URL and SNAPBACK_SERVICE_TOKEN, or run snapback4 dev");

const logPath = process.env.CLIQUE_PUSH_LOG ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "push-log.jsonl");
await mkdir(dirname(logPath), { recursive: true });

const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());

await runWorker({
  url,
  token,
  signal: stop.signal,
  effects: {
    notify: async (payload: Record<string, unknown>, meta: { id: string }) => {
      const line = JSON.stringify({ ...payload, effectId: meta.id, loggedAt: Date.now() });
      await appendFile(logPath, `${line}\n`);
      return { logged: true, path: logPath };
    },
  },
}).done;

import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { server } from "./generated/server.ts";

const logPath = process.env.SNAPBACK_PUSH_LOG
  ?? resolve(fileURLToPath(new URL(".", import.meta.url)), "../data/push-seam.jsonl");

async function record(payload: unknown) {
  await mkdir(dirname(logPath), { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), payload });
  await appendFile(logPath, `${line}\n`, "utf8");
}

export default server({
  effects: {
    async notify(payload) {
      await record(payload);
      return { logged: true };
    },
  },
});

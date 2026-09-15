import fs from "node:fs";
import { runWorker } from "snapback4/worker";
const path = "evidence/provider.jsonl";
fs.mkdirSync("evidence", { recursive: true });
const sent = new Set(
  fs.existsSync(path)
    ? fs
        .readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((x) => JSON.parse(x).id)
    : [],
);
fs.appendFileSync(
  "evidence/pids.jsonl",
  JSON.stringify({
    name: "provider-worker",
    pid: process.pid,
    parent: process.ppid,
  }) + "\n",
);
fs.appendFileSync(
  "run-log.md",
  `${Math.floor(Date.now() / 1000)} server worker pid=${process.pid} parent=${process.ppid}\n`,
);
runWorker({
  url: process.env.SNAPBACK_URL,
  token: process.env.SNAPBACK_SERVICE_TOKEN,
  effects: {
    pushCandidate: async (payload, meta) => {
      const r = await (
        await fetch(process.env.SNAPBACK_URL + "/m/push.dispatch", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + process.env.SNAPBACK_SERVICE_TOKEN,
          },
          body: JSON.stringify({ id: "dispatch-" + meta.id, args: payload }),
        })
      ).json();
      if (r.state !== "sent") throw Error(JSON.stringify(r));
      return { dispatched: true };
    },
    notify: async (payload, meta) => {
      if (!sent.has(meta.id)) {
        fs.appendFileSync(
          path,
          JSON.stringify({ id: meta.id, at: Date.now(), payload }) + "\n",
        );
        sent.add(meta.id);
      }
      return { providerId: meta.id };
    },
  },
});

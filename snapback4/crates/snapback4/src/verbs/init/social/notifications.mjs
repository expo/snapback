// Named workers copy snapback/workers/; put relative helper imports in its subdirectories.
// process.cwd() starts at SNAPBACK_PROJECT_DIR (project in dev, active release in serve).
// Write files with resolve(process.env.SNAPBACK_PROJECT_DIR, "data/push-log.jsonl"),
// never relative to import.meta.url: module URLs point into a disposable private copy.
// Dependencies stay host-installed; arbitrary parent env is stripped (guide effects).
// This filename declares service:notifications. dev and serve own its lifecycle.
import { GiveUp, runWorker } from "snapback4/worker";

const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());
await runWorker({
  url: process.env.SNAPBACK_URL,
  token: process.env.SNAPBACK_SERVICE_TOKEN,
  ledger: true,
  signal: stop.signal,
  effects: { notify: async (payload, meta) => {
    // Add your provider call here and pass meta.idempotencyKey to it.
    // Successful JSON results are ledgered before acknowledgement. A crash
    // after the provider call but before that commit still needs provider dedup.
    // This starter intentionally sends nothing until you connect a provider.
    throw new GiveUp("Connect a notification provider: snapback4 guide effects");
  } },
}).done;

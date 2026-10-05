// Dev copies snapback/ plus server-checker-tracked project imports; keep helpers there.
// process.cwd() starts at SNAPBACK_PROJECT_DIR (project in dev, active release in serve).
// Write files with resolve(process.env.SNAPBACK_PROJECT_DIR, "data/push-log.jsonl"),
// never relative to import.meta.url: module URLs point into a disposable private copy.
// Dependencies stay host-installed; arbitrary parent env is stripped (guide effects).
// `snapback4 dev` supplies this worker's service seat. The invitation is
// an application integration: the engine never executes this TypeScript.
import { GiveUp, mintSession, runWorker } from "snapback4/worker";

const url = process.env.SNAPBACK_URL;
const token = process.env.SNAPBACK_SERVICE_TOKEN;
if (!url || !token) throw new Error("set SNAPBACK_URL and SNAPBACK_SERVICE_TOKEN, or run snapback4 dev");
const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());

await runWorker({ url, token, signal: stop.signal, actions: {
  invite: async ({ email }: { email: string }) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 121) throw new GiveUp("an invitation needs an email that fits member:<email> (128 characters)");
    const principal = `member:${email}`;
    // A production provider would deliver this session to that account.
    // The caller learns the principal, never the invited account's token.
    await mintSession(url, token, principal, "member");
    return { principal };
  },
} }).done;

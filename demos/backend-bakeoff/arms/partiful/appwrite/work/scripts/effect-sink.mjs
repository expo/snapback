import { createServer } from "node:http";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.env.EFFECT_RUNTIME_ROOT ?? ".";
const logFile = path.resolve(root, "effect-attempts.jsonl");
const stateFile = path.resolve(root, "effect-state.json");
await mkdir(root, { recursive: true });
await writeFile(stateFile, "{}\n");
const state = new Map();
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (req.headers["x-effect-secret"] !== process.env.EFFECT_SECRET) {
    res.writeHead(403).end(JSON.stringify({ ok: false }));
    return;
  }
  const body = JSON.parse(raw);
  const prior = state.get(body.dedupeKey) ?? 0;
  state.set(body.dedupeKey, prior + 1);
  await appendFile(logFile, `${JSON.stringify({
    at: new Date().toISOString(),
    dedupeKey: body.dedupeKey,
    attemptNumber: body.attemptNumber,
    duplicate: prior > 0,
    secretPresent: false,
  })}\n`);
  await writeFile(stateFile, `${JSON.stringify(Object.fromEntries(state), null, 2)}\n`);
  if (body.dedupeKey.includes("ambiguous") && prior === 0) {
    req.socket.destroy();
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, duplicate: prior > 0 }));
});
const port = Number(process.env.EFFECT_PORT ?? 20082);
server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ ready: true, port, secretPrinted: false }));
});

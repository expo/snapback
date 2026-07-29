import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const PORT = 4332;
const stateRoot = new URL("../../state/", import.meta.url);
const statePath = new URL("fake-provider.json", stateRoot);
await mkdir(stateRoot, { recursive: true });

let state = { receipts: {}, requests: [] };
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

async function persist() {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/deliver") {
    response.writeHead(404);
    response.end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const key = String(body.idempotencyKey ?? "");
  const mode = String(body.mode ?? "");
  if (!key || !["known-success", "ambiguous-first"].includes(mode)) {
    response.writeHead(400);
    response.end(JSON.stringify({ error: "bad request" }));
    return;
  }

  const existing = state.receipts[key];
  const receiptId = existing?.receiptId
    ?? `local-receipt-${Buffer.from(key).toString("base64url").slice(0, 24)}`;
  state.receipts[key] = {
    receiptId,
    deliveries: 1,
    firstMode: existing?.firstMode ?? mode,
  };
  state.requests.push({
    idempotencyKey: key,
    mode,
    deduped: Boolean(existing),
    ordinal: state.requests.length + 1,
  });
  await persist();

  if (mode === "ambiguous-first" && !existing) {
    request.socket.destroy();
    return;
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    accepted: true,
    deduped: Boolean(existing),
    receiptId,
  }));
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`${JSON.stringify({ ok: true, port: PORT })}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

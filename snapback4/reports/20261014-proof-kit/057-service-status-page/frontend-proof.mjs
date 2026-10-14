import assert from "node:assert/strict";
import path from "node:path";
import { startDev, command, cleanup } from "snapback4/proof";
const root = path.resolve(import.meta.dirname, ".."), app = path.join(root, "app");
const bun = process.env.BUN ?? "bun";
const dev = await startDev({ cwd: root });
try {
  const port = new URL(dev.url).port;
  assert.equal((await command(bun, ["exact.mjs", "snapback", "--port", port], { cwd: app })).code, 0);
  assert.equal((await command(bun, ["exact.mjs", "test", "web"], { cwd: app, env: { PORT_LO: process.env.PORT_LO, PORT_HI: process.env.PORT_HI } })).code, 0);
  console.log("frontend:proof passed (Exact UI assertions)");
} finally { await cleanup(() => dev.stop()); }

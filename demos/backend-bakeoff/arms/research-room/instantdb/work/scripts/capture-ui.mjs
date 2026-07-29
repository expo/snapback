import { writeFile } from "node:fs/promises";
import path from "node:path";
import { evidenceDir, writeJson } from "./lib.mjs";

const target = await fetch("http://127.0.0.1:9347/json/new?http://127.0.0.1:4347/", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (message) => {
  const payload = JSON.parse(String(message.data));
  if (payload.id && pending.has(payload.id)) {
    pending.get(payload.id)(payload);
    pending.delete(payload.id);
  } else if (payload.method) events.push(payload);
};
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440, height: 960, deviceScaleFactor: 1, mobile: false,
});
await send("Page.navigate", { url: "http://127.0.0.1:4347/" });
const deadline = Date.now() + 10000;
while (!events.some((event) => event.method === "Page.loadEventFired") && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const title = await send("Runtime.evaluate", { expression: "document.querySelector('h1')?.textContent", returnByValue: true });
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
ws.close();
const screenshotPath = path.join(evidenceDir, "ui-smoke.png");
await writeFile(screenshotPath, Buffer.from(shot.result.data, "base64"));
await writeJson(path.join(evidenceDir, "ui-smoke.json"), {
  schemaVersion: 1,
  url: "http://127.0.0.1:4347/",
  browser: "Google Chrome headless",
  debugPort: 9347,
  viewport: { width: 1440, height: 960 },
  assertion: { h1: title.result.result.value, passed: title.result.result.value === "Research room" },
  screenshot: "evidence/ui-smoke.png",
  browserStorageInspected: false,
  containsCredentialValues: false,
});
if (title.result.result.value !== "Research room") throw new Error("UI smoke assertion failed.");
process.stdout.write(JSON.stringify({ ok: true, h1: title.result.result.value }) + "\n");

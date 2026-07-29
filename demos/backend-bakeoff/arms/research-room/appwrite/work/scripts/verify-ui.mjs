import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import {
  receiptsRoot,
  runtimeFile,
  vitePort,
  workRoot,
} from "./constants.mjs";

const runtime = JSON.parse(await readFile(runtimeFile, "utf8"));
const browserRoot = path.resolve(workRoot, ".browser-state");
await mkdir(browserRoot, { recursive: true });
const context = await chromium.launchPersistentContext(
  path.resolve(browserRoot, "bob"),
  {
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  },
);
const page = context.pages()[0] ?? await context.newPage();
let realtimeSockets = 0;
page.on("websocket", (socket) => {
  if (socket.url().includes("/v1/realtime")) realtimeSockets += 1;
});
await page.goto(`http://127.0.0.1:${vitePort}`);
await page.waitForTimeout(1_500);
if (!await page.locator('[data-testid="research-room-shell"][data-ready="true"]').isVisible().catch(() => false)) {
  await page.getByLabel("Email").fill(runtime.personas.bob.email);
  await page.getByLabel("Password").fill(runtime.personas.bob.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
await page.locator('[data-testid="research-room-shell"][data-ready="true"]').waitFor({
  timeout: 20_000,
});
await page.waitForTimeout(1_000);
const sourceLabels = await page.locator("aside li").allTextContents();
const answerVisible = await page.locator('[data-testid="research-answer"]').isVisible();
await context.close();
if (sourceLabels.length !== 6 || !answerVisible || realtimeSockets < 1) {
  throw new Error("Research Room UI integration proof failed");
}
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  actor: "bob-native-email-password-session",
  shellReady: true,
  renderedSourceLabels: sourceLabels,
  answerVisible,
  appwriteRealtimeSocketCount: realtimeSockets,
  browserStatePathKind: "ignored worktree-local",
  containsSecretValues: false,
};
await writeFile(
  path.resolve(receiptsRoot, "ui-integration.v1.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.log(JSON.stringify({
  ok: true,
  shellReady: true,
  renderedSources: sourceLabels.length,
  realtimeSockets,
  secretValuesPrinted: false,
}));

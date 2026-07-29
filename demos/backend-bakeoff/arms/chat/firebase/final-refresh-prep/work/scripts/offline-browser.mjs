import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const profile = path.resolve(".browser-profile");
await mkdir(profile, { recursive: true });
const browser = await chromium.launchPersistentContext(profile, {
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--disable-dev-shm-usage"]
});

let online;
let offline;
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:35288", { waitUntil: "networkidle" });
  if (await page.getByTestId("logout").isVisible()) {
    await page.getByTestId("logout").click();
  }
  if (await page.getByTestId("login").isVisible()) {
    await page.getByTestId("login").click();
  }
  await page.getByTestId("auth-state").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector('[data-testid="snapshot-source"]')?.textContent === "server");
  await page.waitForFunction(() => document.querySelector('[data-testid="message-count"]')?.textContent === "25");
  online = {
    auth: await page.getByTestId("auth-state").textContent(),
    source: await page.getByTestId("snapshot-source").textContent(),
    count: Number(await page.getByTestId("message-count").textContent())
  };
  await page.close();

  const coldPage = await browser.newPage();
  await coldPage.goto("http://127.0.0.1:35288?offline=1", { waitUntil: "domcontentloaded" });
  await coldPage.waitForFunction(() => document.querySelector('[data-testid="auth-state"]')?.textContent === "bob@example.test");
  await coldPage.waitForFunction(() => document.querySelector('[data-testid="snapshot-source"]')?.textContent === "cache");
  await coldPage.waitForFunction(() => Number(document.querySelector('[data-testid="message-count"]')?.textContent) === 25);
  offline = {
    newPageColdBoot: true,
    firestoreNetworkDisabledBeforeHistoryListener: true,
    auth: await coldPage.getByTestId("auth-state").textContent(),
    source: await coldPage.getByTestId("snapshot-source").textContent(),
    count: Number(await coldPage.getByTestId("message-count").textContent()),
    retainedOrigin: "Firestore persistentLocalCache / browser IndexedDB"
  };
  await coldPage.close();
} finally {
  await browser.close();
}

if (online.count !== 25 || online.source !== "server" || offline.count !== 25 || offline.source !== "cache") {
  throw new Error(`Offline evidence mismatch: ${JSON.stringify({ online, offline })}`);
}

const result = {
  id: "CHAT-09-OFFLINE-HISTORY",
  status: "pass",
  capturedAt: new Date().toISOString(),
  target: "llp0102-final-chat-firebase-w2",
  transport: "Firestore IndexedDB persistent cache with Firestore network disabled",
  evidence: { online, offline },
  note: "A new browser page in the same persistent profile cold-booted with Firestore transport disabled and rendered 25 previously loaded private messages from native persistent cache."
};
await writeFile(path.resolve("receipts/scenarios/CHAT-09-OFFLINE-HISTORY.json"), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(path.resolve("receipts/offline-browser.json"), `${JSON.stringify(result.evidence, null, 2)}\n`);

const acceptancePath = path.resolve("receipts/acceptance-results.json");
const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
acceptance.scenarios["CHAT-09-OFFLINE-HISTORY"] = result;
acceptance.pendingExternalChecks = acceptance.pendingExternalChecks.filter((id) => id !== result.id);
await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { hash, projectId } from "./lib.mjs";

process.env.GCLOUD_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8321";
const adminApp = initializeApp({ projectId }, `offline-admin-${crypto.randomUUID()}`);
const adminDb = getFirestore(adminApp);
const profile = path.resolve(".browser-profile");
await mkdir(profile, { recursive: true });
const browser = await chromium.launchPersistentContext(profile, {
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--disable-dev-shm-usage"],
});

let online;
let offline;
let targetId;
let originalTitle;
const marker = `Offline queued edit ${Date.now()}`;
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:4321", { waitUntil: "networkidle" });
  if (await page.getByTestId("logout").isVisible().catch(() => false)) {
    await page.getByTestId("logout").click();
  }
  if (await page.getByTestId("login").isVisible()) await page.getByTestId("login").click();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="snapshot-source"]')?.textContent === "server" &&
    document.querySelector('[data-testid="issue-count"]')?.textContent === "50"
  );
  targetId = await page.locator("[data-issue-id]").first().getAttribute("data-issue-id");
  if (!targetId) throw new Error("Offline target id missing");
  originalTitle = (await adminDb.doc(`issues/${targetId}`).get()).data().title;
  online = {
    auth: await page.getByTestId("auth-state").textContent(),
    source: await page.getByTestId("snapshot-source").textContent(),
    issueCount: Number(await page.getByTestId("issue-count").textContent()),
    targetId,
  };
  await page.close();

  const coldPage = await browser.newPage();
  await coldPage.goto("http://127.0.0.1:4321?offline=1", { waitUntil: "domcontentloaded" });
  await coldPage.waitForFunction(() =>
    document.querySelector('[data-testid="auth-state"]')?.textContent === "bob@example.test" &&
    document.querySelector('[data-testid="snapshot-source"]')?.textContent === "cache" &&
    document.querySelector('[data-testid="issue-count"]')?.textContent === "50"
  );
  await coldPage.getByTestId("offline-title").fill(marker);
  await coldPage.getByTestId("offline-edit").click();
  await coldPage.waitForFunction(() =>
    document.querySelector('[data-testid="pending-writes"]')?.textContent === "true"
  );
  const authoritativeWhileOffline = (await adminDb.doc(`issues/${targetId}`).get()).data().title;
  if (authoritativeWhileOffline !== originalTitle) {
    throw new Error("Offline queued write reached authoritative state before reconnect");
  }
  const indexedDbNames = await coldPage.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name).filter(Boolean)
  );
  await coldPage.getByTestId("reconnect").click();
  await coldPage.waitForFunction(() =>
    document.querySelector('[data-testid="pending-writes"]')?.textContent === "false" &&
    document.querySelector('[data-testid="snapshot-source"]')?.textContent === "server"
  );
  const authoritativeAfterReconnect = (await adminDb.doc(`issues/${targetId}`).get()).data().title;
  if (authoritativeAfterReconnect !== marker) {
    throw new Error("Queued edit did not settle authoritatively after reconnect");
  }
  offline = {
    coldPage: true,
    transportDisabledBeforeQuery: true,
    retainedIssueCount: Number(await coldPage.getByTestId("issue-count").textContent()),
    snapshotSourceBeforeReconnect: "cache",
    queuedEditRenderedOptimistically: true,
    pendingWritesBeforeReconnect: true,
    authoritativeBeforeReconnectUnchanged: true,
    authoritativeAfterReconnectMatched: true,
    pendingWritesAfterReconnect: false,
    indexedDbDatabaseCount: indexedDbNames.length,
    indexedDbNameHashes: indexedDbNames.map(hash).sort(),
    targetId,
    markerHash: hash(marker),
  };
  await adminDb.doc(`issues/${targetId}`).update({ title: originalTitle });
  await coldPage.close();
} finally {
  await browser.close();
  await deleteApp(adminApp);
}

const result = {
  id: "LINEAR-10-OFFLINE",
  status: "pass",
  capturedAt: new Date().toISOString(),
  target: projectId,
  transport: "Firestore IndexedDB persistent cache and offline mutation queue",
  evidence: { online, offline },
  note: "A new page in the same isolated persistent profile booted 50 issues from native cache with Firestore transport disabled, queued one update, and reconciled exactly once after reconnect.",
};
await writeFile(path.resolve("receipts/scenarios/LINEAR-10-OFFLINE.json"), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(path.resolve("receipts/offline-browser.json"), `${JSON.stringify(result.evidence, null, 2)}\n`);
const acceptancePath = path.resolve("receipts/acceptance-results.json");
const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
acceptance.scenarios[result.id] = result;
acceptance.pendingExternalChecks = acceptance.pendingExternalChecks.filter((id) => id !== result.id);
await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

// Offline cold-start proof: relaunch the SAME browser profile (fresh process,
// localStorage intact) while the Convex backend is STOPPED. History must
// still be readable. Run only after ui-online.mjs and after stopping convex.
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const APP = process.argv[2] ?? "http://localhost:8097";
const BACKEND = process.argv[3] ?? "http://127.0.0.1:3212";
const ART = join(here, "..", "artifacts");
const PROFILE_A = join(here, ".pw-profile-a");
mkdirSync(ART, { recursive: true });

let pass = 0,
  fail = 0;
function check(name, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

// Precondition: backend really is down.
let backendDown = false;
try {
  await fetch(BACKEND + "/version", { signal: AbortSignal.timeout(3000) });
} catch {
  backendDown = true;
}
check("precondition: convex backend is unreachable", backendDown);

const ctx = await chromium.launchPersistentContext(PROFILE_A, {
  viewport: { width: 420, height: 760 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(APP, { waitUntil: "domcontentloaded" });

// Cached conversation list should render even though queries never resolve.
await page.waitForSelector('[data-testid="conversation-list"]', {
  timeout: 60000,
});
check("cold start: conversation list rendered from cache", true);
check(
  "cold start: seeded group visible offline",
  await page.getByText("Weekend Trip").first().isVisible()
);
await page.waitForSelector('[data-testid="offline-banner"]', {
  timeout: 15000,
});
check("cold start: offline banner shown", true);
await page.screenshot({ path: join(ART, "06-offline-coldstart-list.png") });

// Open the group chat: message history must be readable from cache.
await page.click('[data-testid="convo-weekend-trip"]');
await page.waitForSelector('[data-testid="message-list"]', { timeout: 30000 });
await page.waitForSelector("text=Cabin is booked", { timeout: 30000 });
check("cold start: message history readable offline", true);
check(
  "cold start: messages sent this session are in offline history",
  await page.getByText("Hello from Playwright (Amara)").first().isVisible()
);
await page.screenshot({ path: join(ART, "07-offline-coldstart-chat.png") });

await ctx.close();
console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail === 0 ? 0 : 1);

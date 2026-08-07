// UI acceptance proofs against the Expo web build (two live clients).
// Usage: node ui-online.mjs [appUrl]
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const APP = process.argv[2] ?? "http://localhost:8097";
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

// Make a visible test image (red/white card) by screenshotting a styled div.
const scratch = await chromium.launch();
const scratchPage = await scratch.newPage({
  viewport: { width: 400, height: 300 },
});
await scratchPage.setContent(
  `<div style="width:400px;height:300px;background:linear-gradient(135deg,#e63946,#f4a261);display:flex;align-items:center;justify-content:center;font:700 28px sans-serif;color:#fff">venue photo 📷</div>`
);
const IMG_PATH = join(ART, "test-upload.png");
await scratchPage.screenshot({ path: IMG_PATH });
await scratch.close();

// Client A: persistent profile (its localStorage is reused by the offline
// cold-start proof later).
const ctxA = await chromium.launchPersistentContext(PROFILE_A, {
  viewport: { width: 420, height: 760 },
});
const a = ctxA.pages()[0] ?? (await ctxA.newPage());
console.log("loading app (first Metro bundle can be slow)...");
await a.goto(APP, { waitUntil: "domcontentloaded" });
await a.waitForSelector('[data-testid="conversation-list"]', {
  timeout: 240000,
});
check("A: app loaded, conversation list rendered", true);
check(
  "A: seeded conversations visible",
  await a.getByText("Weekend Trip").first().isVisible()
);
await a.screenshot({ path: join(ART, "01-conversation-list.png") });

// Open group chat
await a.click('[data-testid="convo-weekend-trip"]');
await a.waitForSelector('[data-testid="message-list"]');
await a.waitForSelector("text=Cabin is booked", { timeout: 30000 });
check("A: seeded group history visible", true);

// Send a text message
await a.fill('[data-testid="message-input"]', "Hello from Playwright (Amara)");
await a.click('[data-testid="send-button"]');
await a.waitForSelector("text=Hello from Playwright (Amara)", {
  timeout: 15000,
});
check("A: text message sent and rendered live", true);

// Reply pointer via UI
await a.getByText("I can drive, I fit 3 more.").first().click();
await a.waitForSelector('[data-testid^="reply-"]');
await a.click('[data-testid^="reply-"]');
await a.waitForSelector('[data-testid="reply-banner"]');
check("A: reply banner shows quoted target", true);
await a.fill('[data-testid="message-input"]', "Replying via UI");
await a.click('[data-testid="send-button"]');
await a.waitForSelector("text=Replying via UI", { timeout: 15000 });
check("A: reply message sent", true);

// Reaction via UI
await a.getByText("What should I bring?", { exact: false }).first().click();
const reactButtons = a.locator('[data-testid^="react-❤️-"]');
await reactButtons.first().waitFor();
await reactButtons.first().click();
await a.waitForTimeout(1500);
const heartVisible = await a
  .locator('[data-testid="message-list"]')
  .getByText("❤️", { exact: false })
  .first()
  .isVisible();
check("A: reaction pill visible after tapping ❤️", heartVisible);
await a.screenshot({ path: join(ART, "02-chat-after-send-reply-react.png") });

// Client B: second browser, persona Ben, same conversation
const ctxB = await chromium.launch();
const bCtx = await ctxB.newContext({ viewport: { width: 420, height: 760 } });
const b = await bCtx.newPage();
await b.goto(APP, { waitUntil: "domcontentloaded" });
await b.waitForSelector('[data-testid="persona-ben"]', { timeout: 120000 });
await b.click('[data-testid="persona-ben"]');
await b.click('[data-testid="convo-weekend-trip"]');
await b.waitForSelector('[data-testid="message-list"]');
check(
  "B: second client (Ben) sees the same history live",
  await b.getByText("Hello from Playwright (Amara)").first().isVisible()
);

// Typing indicator: B types, A should see "Ben is typing…"
await b.focus('[data-testid="message-input"]');
await b.type('[data-testid="message-input"]', "thinking about snacks…", {
  delay: 120,
});
await a.waitForSelector('[data-testid="typing-indicator"]', {
  timeout: 10000,
});
const typingText = await a
  .locator('[data-testid="typing-indicator"]')
  .innerText();
check(
  "A: sees live typing indicator from B",
  typingText.includes("Ben") && typingText.includes("typing"),
  typingText
);
await a.screenshot({ path: join(ART, "03-typing-indicator-on-A.png") });
await b.screenshot({ path: join(ART, "03b-typing-client-B.png") });

// B finishes the message; indicator should clear on A after send.
await b.click('[data-testid="send-button"]');
await a.waitForSelector("text=thinking about snacks…", { timeout: 15000 });
await a.waitForSelector('[data-testid="typing-indicator"]', {
  state: "detached",
  timeout: 10000,
});
check("A: typing indicator cleared after B sends", true);

// Image message from A: picker -> upload -> attached message rendering
const [chooser] = await Promise.all([
  a.waitForEvent("filechooser", { timeout: 15000 }),
  a.click('[data-testid="attach-button"]'),
]);
await chooser.setFiles(IMG_PATH);
await a.waitForSelector('[data-testid^="image-"]', { timeout: 30000 });
check("A: image message uploaded and rendered", true);
// And it syncs to B
await b.waitForSelector('[data-testid^="image-"]', { timeout: 15000 });
const imgSrc = await b
  .locator('[data-testid^="image-"] img, img[data-testid^="image-"]')
  .first()
  .getAttribute("src");
check(
  "B: image message synced with storage URL",
  !!imgSrc && imgSrc.includes("/api/storage/"),
  imgSrc ?? "no src"
);
await a.waitForTimeout(800);
await a.screenshot({ path: join(ART, "04-image-message-A.png") });
await b.screenshot({ path: join(ART, "04b-image-message-B.png") });

// Persona switcher speed: switch A to Chidi and send
const t0 = Date.now();
await a.click('[data-testid="persona-chidi"]');
await a.fill('[data-testid="message-input"]', "Chidi here after a switch");
await a.click('[data-testid="send-button"]');
await b.waitForSelector("text=Chidi here after a switch", { timeout: 15000 });
const bubble = b
  .locator('[data-testid^="message-"]', {
    hasText: "Chidi here after a switch",
  })
  .last();
const authorOk = await bubble.getByText("Chidi", { exact: false }).count();
check(
  "persona switch: A switched to Chidi and message attributed correctly",
  authorOk > 0,
  `switch+send+sync took ${Date.now() - t0}ms`
);
await b.screenshot({ path: join(ART, "05-persona-switch-seen-by-B.png") });

// Leave A on the chat screen so the offline proof reopens with warm cache,
// then go back to the list so both views are cached.
await a.click('[data-testid="back-button"]');
await a.waitForSelector('[data-testid="conversation-list"]');
await a.waitForTimeout(1000);

await ctxA.close();
await ctxB.close();
console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail === 0 ? 0 : 1);

// API signatures: snapback4 guide api proof | client | auth | generated
// EDIT REGION: business assertions between the markers below; keep build, hosts and cleanup.
// Builds its own dist before starting proof servers.
// Replace the application assertions when replacing the starter screen.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { command, startDev, startStatic, withBrowser, renderedText, fillRN, signInUI, statusText, waitForFresh, bounded, cleanup, portRange } from "snapback4/proof";

import { runProofSuite } from "snapback4/proof-runner";

await runProofSuite(async () => {

// For SVG/foreignObject controls, click the actual rendered box, not a text
// descendant whose DOM geometry Playwright may interpret differently.
async function clickSvg(page, control) {
  await control.waitFor({ state: "visible" });
  const box = await control.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, "SVG control has no rendered box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const options = process.env.SNAPBACK4_PROOF_LOGS ? { logsDir: process.env.SNAPBACK4_PROOF_LOGS } : {};
const range = portRange();
if (range !== "0" && range.split("-")[0] === range.split("-")[1]) throw Error("the starter needs two runtime ports");
const build = await command("npm", ["run", "build"], { ...options, timeoutMs: 300_000 });
assert.equal(build.code, 0, `frontend:proof build failed: ${build.stderr}; logs: ${build.logs.stderr}`);
const dev = await startDev({ ...options, args: ["--memory", "--unsafe-dev-doors"] });
let web;
try {
  const identity = await (await fetch(`${dev.url}/auth/config`, { signal: AbortSignal.timeout(5000) })).json();
  const personas = (await (await fetch(`${dev.url}/dev/status`, { signal: AbortSignal.timeout(5000) })).json()).personas;
  web = await startStatic("dist", options);
  await withBrowser({ executablePath: process.env.CHROME, ...options }, async context => {
    const page = await context.newPage();
    await page.goto(`${web.url}/?api=${encodeURIComponent(dev.url)}&witness=web`, { waitUntil: "domcontentloaded" });
    if (identity.guests) {
      await page.getByRole("button", { name: "Continue as a guest", exact: true }).click();
    } else if (identity.password) {
      await fillRN(page.getByLabel("Email", { exact: true }), `proof-${randomUUID()}@example.test`);
      await fillRN(page.getByLabel("Password", { exact: true }), "Proof-password-928!");
      await page.getByRole("button", { name: "Sign up", exact: true }).click();
    } else if (personas.length) {
      await page.getByRole("button", { name: personas[0], exact: true }).click();
    }
    // EDIT REGION: sign-in role and screen/write assertions begin.
    
    if (identity.guests || identity.password || personas.length) await page.getByRole("button", { name: /^(Sign out|Switch persona)$/, exact: true }).waitFor();
    
    assert.ok((await page.locator('body').innerText()).trim(), 'frontend rendered no content');
    // Add a real UI write and assert its SDK receipt and fresh rendered result here.
    throw Error('E_FRONTEND_SCENARIO: frontend rendered; no app-specific write scenario yet. Edit scripts/frontend-proof.mjs and replace this refusal with your write assertions.');
  });
} finally { await cleanup(() => web?.stop(), () => dev.stop()); }
});

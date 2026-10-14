// Build first: npm run build (web) or npm run build:web (Expo web).
// Replace the application assertions when replacing the starter screen.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startDev, startStatic, withBrowser, fillRN, statusText, waitForFresh, bounded, cleanup } from "snapback4/proof";

const dev = await startDev();
let web;
try {
  const identity = await (await fetch(`${dev.url}/auth/config`, { signal: AbortSignal.timeout(5000) })).json();
  const personas = (await (await fetch(`${dev.url}/dev/status`, { signal: AbortSignal.timeout(5000) })).json()).personas;
  web = await startStatic("dist");
  await withBrowser({ executablePath: process.env.CHROME }, async context => {
    const page = await context.newPage();
    await page.goto(`${web.url}/?api=${encodeURIComponent(dev.url)}&witness=web`, { waitUntil: "domcontentloaded" });
    if (identity.guests) {
      await page.getByRole("button", { name: "Continue as a guest", exact: true }).click();
    } else if (identity.password) {
      await fillRN(page.getByLabel("Email", { exact: true }), `proof-${randomUUID()}@example.test`);
      await fillRN(page.getByLabel("Password", { exact: true }), "Proof-password-928!");
      await page.getByRole("button", { name: "Sign up", exact: true }).click();
    } else {
      assert.ok(personas.length, "declare identity or personas before proving the starter");
      await page.getByRole("button", { name: personas[0], exact: true }).click();
    }
    await page.getByRole("button", { name: /^(Sign out|Switch persona)$/, exact: true }).waitFor();
    const task = page.getByLabel("Task", { exact: true });
    if (await task.count()) {
      const title = `Proof ${randomUUID()}`;
      await fillRN(task, title);
      // Arm the app's SDK receipt outside the form, which may unmount.
      const button = page.getByRole("button", { name: "Add", exact: true });
      await button.evaluate((element, title) => window.__snapback4Witness.beginForm("add", { title }, element), title);
      await button.click();
      const receipt = await bounded(page.evaluate(() => window.__snapback4Witness.formResult()), 30_000, "clicked write receipt");
      assert.equal(receipt.state, "sent", JSON.stringify(receipt));
      await waitForFresh(statusText(page, new RegExp(title)), null);
    }
  });
  console.log("frontend:proof passed");
} finally { await cleanup(() => web?.stop(), () => dev.stop()); }

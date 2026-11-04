// Builds the app, serves it against a real staging backend with seeded
// password users, and drives a write (boxer self-registration) in Chromium.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploy, startServe, startStatic, withBrowser, renderedText, fillRN, waitForFresh, bounded, cleanup, command, portRange } from "snapback4/proof";
import { api } from "../snapback/generated/api.ts";

const range = portRange();
if (range !== "0" && range.split("-")[0] === range.split("-")[1]) throw Error("frontend:proof needs two runtime ports");
const DIR = ".staging-proof";
rmSync(DIR, { recursive: true, force: true });
await deploy(DIR, "snapback", { args: ["--staging"] });
const serve = await startServe(DIR, {
  seedUsers: { roles: { coach: 1, matchmaker: 1, boxer: 1, physician: 1, inspector: 1 }, provision: api.provision },
});
let web;
try {
  const boxer = serve.sessions.boxer[0];
  const build = await command("npm", ["run", "build"], { timeoutMs: 300_000 });
  assert.equal(build.code, 0, `frontend:proof build failed: ${build.stderr}`);
  web = await startStatic("dist");
  await withBrowser({ executablePath: process.env.CHROME, args: ["--no-sandbox"] }, async context => {
    const page = await context.newPage();
    await page.goto(`${web.url}/?api=${encodeURIComponent(serve.url)}`, { waitUntil: "domcontentloaded" });
    await fillRN(page.getByLabel("Email", { exact: true }), boxer.email);
    await fillRN(page.getByLabel("Password", { exact: true }), boxer.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("heading", { name: "Register as a boxer", exact: true }).waitFor();
    const name = `Proof ${randomUUID()}`;
    await fillRN(page.getByLabel("Boxer name", { exact: true }), name);
    await fillRN(page.getByLabel("Weight (lb)", { exact: true }), "155");
    const button = page.getByRole("button", { name: "Register", exact: true });
    await button.evaluate((element, boxerName) => window.__snapback4Witness.beginForm("registerBoxer", { name: boxerName, weightLb: 155 }, element), name);
    await button.click();
    const receipt = await bounded(page.evaluate(() => window.__snapback4Witness.formResult()), 30_000, "register write receipt");
    assert.equal(receipt.state, "sent", JSON.stringify(receipt));
    const within = page.getByLabel("Boxers", { exact: true });
    await waitForFresh(renderedText(page, name, { within, exact: false }), null);
    // Physician flow: upload an exam scan for the new boxer through the real UI.
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    const physician = serve.sessions.physician[0];
    await fillRN(page.getByLabel("Email", { exact: true }), physician.email);
    await fillRN(page.getByLabel("Password", { exact: true }), physician.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), exact: false }).click();
    await page.getByRole("heading", { name: "Boxer detail", exact: true }).waitFor();
    const scanPath = join(tmpdir(), `exam-scan-${Date.now()}.png`);
    writeFileSync(scanPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    await page.getByLabel("Scan", { exact: true }).setInputFiles(scanPath);
    await page.getByRole("button", { name: "Save exam", exact: true }).click();
    await waitForFresh(renderedText(page, "Eligibility: exam valid", { exact: false }), null, { timeoutMs: 60_000 });
    // v2 feature: the matchmaker sets the experience label and sees it appear.
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    const mm = serve.sessions.matchmaker[0];
    await fillRN(page.getByLabel("Email", { exact: true }), mm.email);
    await fillRN(page.getByLabel("Password", { exact: true }), mm.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), exact: false }).click();
    await page.getByRole("heading", { name: "Boxer detail", exact: true }).waitFor();
    const expForm = page.locator('form[aria-label="Experience label"]');
    await expForm.locator("select").selectOption("previously competed");
    await expForm.getByRole("button", { name: "Save label", exact: true }).click();
    const detail = page.locator('section[aria-label="Boxer detail"]');
    await waitForFresh(renderedText(page, "record 0-0-0 · previously competed", { within: detail, exact: false }), null, { timeoutMs: 60_000 });
  });
  console.log("frontend:proof passed");
} finally { await cleanup(() => web?.stop(), () => serve.stop()); }

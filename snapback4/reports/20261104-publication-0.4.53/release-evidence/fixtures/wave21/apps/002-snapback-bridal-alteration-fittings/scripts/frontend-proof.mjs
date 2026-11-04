// frontend:proof — builds the web app, serves it with a live backend, and
// drives a real browser through a real write: sign in, log a gown with a
// photo, see it appear on the board, open it. Self-contained and rerunnable
// (fresh backend + unique names every run; rebuilds dist when missing).
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deploy, startServe, startStatic, cleanup, command, cli,
  withBrowser, fillRN, renderedText, waitForFresh,
} from "snapback4/proof";
import { login } from "snapback4/auth";
import { createClient } from "snapback4/client";
import { api } from "../snapback/generated/api.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TAG = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const PASSWORD = "correct horse battery staple";
const log = (...args) => console.error("[frontend:proof]", ...args);

function stamp(daysAhead) {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function ensureDist() {
  if (existsSync("dist/index.html")) {
    log("reusing dist");
    return;
  }
  log("building dist with expo export");
  const build = await command("npx", ["expo", "export", "--platform", "web", "--max-workers", "2", "--clear"], {
    env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" },
  });
  if (build.code !== 0) throw new Error(`expo export failed: ${build.code}\n${build.stderr.slice(-2000)}`);
  const shell = await cli(["web-shell", "dist", "--base", "/"]);
  if (shell.code !== 0) throw new Error(`web-shell failed: ${shell.code}\n${shell.stderr.slice(-2000)}`);
  log("dist built");
}

async function main() {
  rmSync("staging-proof", { recursive: true, force: true });
  const deployed = await deploy("staging-proof", "snapback", { args: ["--staging"] });
  if (deployed.code !== 0) throw new Error(`deploy failed: ${deployed.stderr.slice(-2000)}`);
  const host = await startServe("staging-proof", {
    seedUsers: { roles: { frontdesk: 1, bride: 1, seamstress: 1 }, provision: api.provision },
  });
  let web = null;
  try {
    const url = host.url;
    const desk = host.sessions.frontdesk[0];
    const bride = host.sessions.bride[0];
    const seam = host.sessions.seamstress[0];
    // The bride joins the directory so the front desk can file under her.
    const brideName = `Proof Bride ${TAG}`;
    const brideLogin = await login(url, bride.email, bride.password);
    if (!brideLogin.ok) throw new Error("bride login failed");
    const brideClient = createClient({ url, session: brideLogin.session });
    const registered = await brideClient.mutate(api.registerBride, { displayName: brideName });
    if (registered.state !== "sent") throw new Error(`registerBride failed: ${registered.why?.code}`);

    await ensureDist();
    web = await startStatic("dist");
    log("backend", url, "web", web.url);

    const style = `Proof Gown ${TAG}`;
    const measures = `Proof measures ${TAG}`;
    const observation = `Proof observation ${TAG}`;
    const stitching = `Proof stitching ${TAG}`;
    const pngPath = join(process.env.TMPDIR || tmpdir(), `proof-gown-${TAG}.png`);
    writeFileSync(pngPath, PNG);

    await withBrowser(
      { executablePath: process.env.CHROME, args: ["--no-sandbox"] },
      async (context) => {
        const page = await context.newPage();
        await page.goto(`${web.url}/?api=${encodeURIComponent(url)}`, { waitUntil: "domcontentloaded" });
        await fillRN(page.getByLabel("Email", { exact: true }), desk.email);
        await fillRN(page.getByLabel("Password", { exact: true }), desk.password);
        await page.getByRole("button", { name: /^sign in$/i }).click();
        await waitForFresh(renderedText(page, "Workroom board", { exact: false }), null);
        await page.getByRole("button", { name: new RegExp(`Bride: ${brideName}`) }).click();
        await fillRN(page.getByLabel("Style", { exact: true }), style);
        await fillRN(page.getByLabel("Measurements", { exact: true }), measures);
        await fillRN(page.getByLabel("Phone", { exact: true }), "555-0142");
        await fillRN(page.getByLabel("Address", { exact: true }), "7 Proof Ln");
        await fillRN(page.getByLabel("Price", { exact: true }), "899");
        await fillRN(page.getByLabel("Wedding date", { exact: true }), stamp(60));
        await fillRN(page.getByLabel("Final fitting date", { exact: true }), stamp(40));
        await page.getByLabel("Gown photo", { exact: true }).setInputFiles(pngPath);
        await page.getByRole("button", { name: /^log gown$/i }).click();
        const board = page.getByTestId("workroom-board");
        const row = renderedText(page, `${style} · intake`, { within: board, exact: true });
        const seen = await waitForFresh(row, null);
        log("board shows new gown:", seen.slice(0, 80));
        await page.getByRole("button", { name: new RegExp(`Open ${style}`, "i") }).click();
        const detailMeasures = renderedText(page, measures, { exact: false });
        await waitForFresh(detailMeasures, null);
        log("detail shows measurements");
        // v2 feature through the real UI: file a fit observation, see it.
        await fillRN(page.getByLabel("Fit observation", { exact: true }), observation);
        await page.getByRole("button", { name: /^add observation$/i }).click();
        await waitForFresh(renderedText(page, observation, { exact: false }), null);
        log("observation recorded");
        // Only seamstresses/owner may set alteration instructions: sign in
        // as the seamstress and write them on the same gown.
        await page.getByRole("button", { name: /^sign out$/i }).click();
        await fillRN(page.getByLabel("Email", { exact: true }), seam.email);
        await fillRN(page.getByLabel("Password", { exact: true }), seam.password);
        await page.getByRole("button", { name: /^sign in$/i }).click();
        await waitForFresh(renderedText(page, "Workroom board", { exact: false }), null);
        await page.getByRole("button", { name: new RegExp(`Open ${style}`, "i") }).click();
        await waitForFresh(renderedText(page, observation, { exact: false }), null);
        await fillRN(page.getByLabel("Alteration instructions", { exact: true }), stitching);
        await page.getByRole("button", { name: /^save instructions$/i }).click();
        await waitForFresh(renderedText(page, `Alterations: ${stitching}`, { exact: false }), null);
        log("instructions recorded");
      },
    );
    log("frontend proof passed");
  } finally {
    await cleanup(...[() => host.stop(), ...(web ? [() => web.stop()] : [])]);
  }
}

main().then(() => process.exit(0), (error) => {
  console.error("[frontend:proof] FAILED:", error?.message ?? error);
  process.exit(1);
});

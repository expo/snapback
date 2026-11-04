// probe:serve — serve PRODUCTION v2 (as the reviewer finds it) plus the
// production-built frontend. Makes sure v2 is live without resetting data,
// ensures two real users per role through the real sign-up path, prints ONE
// JSON line to stdout {backendUrl, frontendUrl, sessions, apiNotes} and stays
// up until SIGTERM/SIGINT. Everything else goes to stderr.
import { existsSync } from "node:fs";
import { cli, deploy, rollback, startServe, startStatic, cleanup, command } from "snapback4/proof";
import { createClient } from "snapback4/client";
import { api } from "../snapback/generated/api.ts";
import { ensureProdUsers } from "./prod-users.mjs";

const DIR = "./deploy";
const TAG = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const log = (...args) => console.error("[probe:serve]", ...args);

async function isV2Live() {
  const r = await cli(["sql", "SELECT * FROM fittings", "--release", DIR, "--json", "--limit", "1"]);
  if (r.code !== 0) return false;
  try {
    return JSON.parse(r.stdout).columns.includes("observation");
  } catch {
    return false;
  }
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
  if (!existsSync(`${DIR}/store.sqlite`)) {
    log("no production store; deploying v1 then v2");
    const first = await deploy(DIR, "v1/schema.q");
    if (first.code !== 0) throw new Error(`fresh v1 deploy failed: ${first.stderr.slice(-1000)}`);
  }
  if (!(await isV2Live())) {
    log("v1 live; moving forward to v2 without touching data");
    const fw = await rollback(DIR, "latest");
    if (fw.code !== 0) throw new Error(`forward to v2 failed: ${fw.stderr.slice(-1000)}`);
    if (!(await isV2Live())) throw new Error("production is still not v2 after forward");
  }
  log("v2 live");
  const host = await startServe(DIR);
  const stopAll = [() => host.stop()];
  try {
    const url = host.url;
    const users = await ensureProdUsers(url, await host.operatorToken());
    // File one fresh sample gown so the reviewer lands in a working shop.
    try {
      const desk = users.frontdesk[0];
      const bride = users.bride[0];
      const deskClient = createClient({ url, session: { principal: desk.principal, token: desk.token } });
      const up = await deskClient.upload(Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
      if (up.ok) {
        const now = Date.now();
        const DAY = 24 * 60 * 60 * 1000;
        await deskClient.mutate(api.logGown, {
          bride: bride.principal, style: `Sample A-line ${TAG}`, measurements: "bust 34 waist 26 hips 36",
          phone: "555-0100", address: "1 Chapel Ln", quotedPrice: 129900,
          photos: [{ id: up.asset.id }], weddingDate: now + 60 * DAY, finalFittingAt: now + 52 * DAY,
        });
      }
    } catch (error) {
      log("sample data note:", error?.message ?? error);
    }
    await ensureDist();
    const web = await startStatic("dist");
    stopAll.push(() => web.stop());
    const frontendUrl = `${web.url}/?api=${encodeURIComponent(url)}`;
    log("backend", url, "frontend", frontendUrl);
    const sessions = {};
    for (const [role, accounts] of Object.entries(users)) {
      sessions[role] = accounts.map((a) => ({
        user: a.email,
        email: a.email,
        password: a.password,
        principal: a.principal,
        token: a.token,
        headers: { Authorization: `Bearer ${a.token}` },
      }));
    }
    const out = {
      backendUrl: url,
      frontendUrl,
      sessions,
      apiNotes: "JSON over HTTP. Sign in with POST /auth/signup or /auth/login {email,password} -> {session:{principal,token,expiresAt}}; every call sends Authorization: Bearer <token> with Content-Type: application/json. Queries: POST /q/<op> {args:{...}} -> {data,complete,next}|{denied:{code,message}}. Mutations: POST /m/<op> {id:<write-id>,args:{...}} -> {state:\"sent\",result}|{state:\"failed\",why:{code,message}}. Fitting notes are split: addFitting takes {gown, observation} (the old {gown, note} spelling still files an observation); setInstructions takes {fitting, instructions} and only seamstress/owner may call it (else NOT_INSTRUCTIONS). Upload bytes with POST /assets (Content-Type: image/*) -> {asset:{id,...}}, then pass {id} into the photo argument of logGown. The Expo web app at frontendUrl uses the same calls through the snapback4 client bindings (?api= selects the backend).",
    };
    process.stdout.write(JSON.stringify(out) + "\n");
    await new Promise((resolve) => {
      process.once("SIGTERM", resolve);
      process.once("SIGINT", resolve);
    });
  } finally {
    await cleanup(...stopAll);
  }
}

main().then(() => process.exit(0), (error) => {
  console.error("[probe:serve] FAILED:", error?.message ?? error);
  process.exit(1);
});

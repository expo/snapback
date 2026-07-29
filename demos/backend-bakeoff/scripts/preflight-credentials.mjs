#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bakeoffRoot = path.resolve(here, "..");

export function classifyFirebase(text, exitStatus) {
  if (exitStatus !== 0 || /no authorized accounts|not logged|login required/i.test(text)) return "missing";
  return /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(text) ? "ready" : "indeterminate";
}

export function classifyInstant(text, exitStatus) {
  if (exitStatus !== 0 || /not logged|login required|no auth/i.test(text)) return "missing";
  return /logged in|authenticated/i.test(text) ? "ready" : "indeterminate";
}

export function classifySpacetime(text, exitStatus) {
  if (exitStatus !== 0 || /not logged|no current login|no identity/i.test(text)) return "missing";
  return /logged in|identity|email/i.test(text) ? "ready" : "indeterminate";
}

export function classifySupabase(text, exitStatus) {
  if (exitStatus !== 0 || /access token|not logged|unauthorized|login required/i.test(text)) return "missing";
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? "ready" : "indeterminate";
  } catch {
    return "indeterminate";
  }
}

export function classifyAppwrite(_text, exitStatus) {
  return exitStatus === 0 ? "ready" : "missing";
}

export function parseLocalPreflight(markdown) {
  const value = (key) => {
    const match = markdown.match(new RegExp(`^\\s*[-*]?\\s*${key}\\s*:\\s*(.+?)\\s*$`, "mi"));
    return match?.[1]?.trim() ?? "";
  };
  const validEmail = (candidate) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate);
  return {
    aliceMailboxConfigured: validEmail(value("BAKEOFF_ALICE_EMAIL")),
    bobMailboxConfigured: validEmail(value("BAKEOFF_BOB_EMAIL")),
    malloryMailboxConfigured: validEmail(value("BAKEOFF_MALLORY_EMAIL")),
    paidPlanApprovalRecorded: /^(1|true|yes|approved)$/i.test(value("BAKEOFF_PAID_PLANS_APPROVED")),
  };
}

function dogfoodCredentialValue(markdown, label) {
  const lines = markdown.split(/\r?\n/);
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const clean = (value) =>
    value
      .trim()
      .replace(/^[-*]\s+/, "")
      .replace(/^`(.*)`$/, "$1")
      .replace(/^['"](.*)['"]$/, "$1")
      .trim();
  const usable = (value) =>
    Boolean(value) &&
    !/^(?:\.{3}|<[^>]*>|redacted|todo|tbd|none|null|replace(?:[-_\s].*)?)$/i.test(value);
  const labelPattern = escapeRegExp(label);
  const assignment = new RegExp(
    `^\\s*(?:[-*]\\s+)?(?:\`${labelPattern}\`|${labelPattern})\\s*[:=]\\s*(.*?)\\s*$`,
    "i",
  );
  const anyAssignment = /^\s*(?:[-*]\s+)?(?:`[^`]+`|[A-Za-z][A-Za-z0-9 _-]*)\s*[:=]/;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(assignment);
    if (!match) continue;

    const sameLine = clean(match[1]);
    if (usable(sameLine)) return sameLine;
    if (sameLine) continue;

    const nextLine = lines[index + 1];
    if (!nextLine || /^\s*#/.test(nextLine) || anyAssignment.test(nextLine)) continue;
    const nextValue = clean(nextLine);
    if (usable(nextValue)) return nextValue;
  }
  return "";
}

export function parseDogfoodTargetCapabilities(markdown) {
  const valuePresent = (label) => Boolean(dogfoodCredentialValue(markdown, label));
  return {
    supabaseSharedTarget:
      valuePresent("SUPABASE_URL") &&
      (valuePresent("SUPABASE_PUBLISHABLE_KEY") || valuePresent("SUPABASE_ANON_KEY")) &&
      valuePresent("SUPABASE_SECRET_KEY"),
    convexSharedTarget: ["CONVEX_DEPLOY_KEY", "CONVEX_URL"].every(valuePresent),
    instantdbSharedTarget: ["Public App ID", "Admin token"].every(valuePresent),
  };
}

function run(command, args, timeoutMs = 20_000, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: bakeoffRoot,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk) => {
      output += chunk.toString("utf8");
      if (output.length > 1_000_000) output = output.slice(-1_000_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitStatus: null, output: error.message, error: true });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ exitStatus: code, output, signal, error: false });
    });
  });
}

export async function probeDogfoodTargets(markdown, fetchImpl = fetch) {
  const supabaseUrl = dogfoodCredentialValue(markdown, "SUPABASE_URL");
  const supabaseKey =
    dogfoodCredentialValue(markdown, "SUPABASE_PUBLISHABLE_KEY") ||
    dogfoodCredentialValue(markdown, "SUPABASE_ANON_KEY");
  const convexDeployKey = dogfoodCredentialValue(markdown, "CONVEX_DEPLOY_KEY");
  const convexUrl = dogfoodCredentialValue(markdown, "CONVEX_URL");
  const instantAppId = dogfoodCredentialValue(markdown, "Public App ID");
  const instantAdminToken = dogfoodCredentialValue(markdown, "Admin token");

  let supabase = "missing";
  if (supabaseUrl && supabaseKey) {
    try {
      const response = await fetchImpl(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/health`, {
        headers: { apikey: supabaseKey },
        signal: AbortSignal.timeout(20_000),
      });
      supabase = response.ok ? "reachable-read-only" : "unreachable-or-unauthorized";
    } catch {
      supabase = "unreachable-or-unauthorized";
    }
  }

  let convex = "missing";
  if (convexDeployKey && convexUrl) {
    const result = await run(binPath("convex"), ["function-spec"], 20_000, {
      CONVEX_DEPLOY_KEY: convexDeployKey,
      CONVEX_URL: convexUrl,
    });
    convex = result.exitStatus === 0 ? "reachable-read-only" : "unreachable-or-unauthorized";
  }

  let instantdb = "missing";
  if (instantAppId && instantAdminToken) {
    const result = await run(binPath("instant-cli"), ["query", "{}", "--admin"], 20_000, {
      INSTANT_APP_ID: instantAppId,
      INSTANT_APP_ADMIN_TOKEN: instantAdminToken,
    });
    instantdb = result.exitStatus === 0 ? "reachable-read-only" : "unreachable-or-unauthorized";
  }

  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    containsSecretValues: false,
    targets: { supabase, convex, instantdb },
    eligibility: "eligible-with-arm-namespace-and-baseline-preserving-cleanup",
    note: "Probes read only service health or target metadata. Command output and credential values are discarded. Write eligibility remains subject to a per-arm baseline and scoped cleanup plan.",
  };
}

function binPath(name) {
  return path.join(bakeoffRoot, "node_modules", ".bin", name);
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function preflight() {
  const firebase = await run(binPath("firebase"), ["login:list"]);
  const supabase = await run(binPath("supabase"), ["projects", "list", "--output", "json"]);
  const instant = await run(binPath("instant-cli"), ["info"]);
  const spacetime = await run(path.join(process.env.HOME ?? "", ".local", "bin", "spacetime"), ["login", "show"]);
  const appwrite = await run(binPath("appwrite"), ["account", "get"]);
  const convexConfigPresent =
    await exists(path.join(process.env.HOME ?? "", ".convex", "config.json")) ||
    await exists(path.join(process.env.HOME ?? "", ".convex", "config"));
  const localSecretsPath = path.resolve(bakeoffRoot, "../..", ".agent-local-secrets.md");
  const localSecrets = await readFile(localSecretsPath, "utf8").catch(() => "");
  const local = parseLocalPreflight(localSecrets);
  const dogfoodSecrets = await readFile(
    path.join(process.env.HOME ?? "", "Dropbox", "APIKeys", "dogfood-matrix-secrets.md"),
    "utf8",
  ).catch(() => "");
  const dogfood = parseDogfoodTargetCapabilities(dogfoodSecrets);

  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    containsSecretValues: false,
    providers: {
      convex: {
        account: convexConfigPresent ? "configured-unverified" : "missing",
        note: "Convex has no standalone login command; verify through fresh-project configuration before the timed clock."
      },
      supabase: { account: classifySupabase(supabase.output, supabase.exitStatus) },
      firebase: { account: classifyFirebase(firebase.output, firebase.exitStatus) },
      instantdb: { account: classifyInstant(instant.output, instant.exitStatus) },
      spacetimedb: { account: classifySpacetime(spacetime.output, spacetime.exitStatus) },
      appwrite: { account: classifyAppwrite(appwrite.output, appwrite.exitStatus) }
    },
    existingSharedTargetCredentials: {
      supabase: dogfood.supabaseSharedTarget ? "available-eligible-with-arm-namespace" : "missing",
      convex: dogfood.convexSharedTarget ? "available-eligible-with-arm-namespace" : "missing",
      instantdb: dogfood.instantdbSharedTarget ? "available-pending-connectivity" : "missing"
    },
    personas: {
      aliceMailboxConfigured: Boolean(process.env.BAKEOFF_ALICE_EMAIL) || local.aliceMailboxConfigured,
      bobMailboxConfigured: Boolean(process.env.BAKEOFF_BOB_EMAIL) || local.bobMailboxConfigured,
      malloryMailboxConfigured: Boolean(process.env.BAKEOFF_MALLORY_EMAIL) || local.malloryMailboxConfigured
    },
    paidPlanApprovalRecorded: process.env.BAKEOFF_PAID_PLANS_APPROVED === "1" || local.paidPlanApprovalRecorded,
    note: "Raw CLI and secret-file values are intentionally discarded and never printed or persisted. Shared targets require a unique arm namespace, redacted baseline, and baseline-preserving scoped cleanup."
  };
}

async function main() {
  if (process.argv.includes("--probe-shared-targets")) {
    const dogfoodSecrets = await readFile(
      path.join(process.env.HOME ?? "", "Dropbox", "APIKeys", "dogfood-matrix-secrets.md"),
      "utf8",
    ).catch(() => "");
    console.log(JSON.stringify(await probeDogfoodTargets(dogfoodSecrets), null, 2));
    return;
  }
  console.log(JSON.stringify(await preflight(), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
}

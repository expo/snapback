#!/usr/bin/env node

// Credentials preflight for the LLP 0137 improvement sweep (G0).
//
// Prints and persists ONLY capability names, statuses, booleans, and mention
// counts. It never prints or persists account emails, tokens, project ids,
// key material, or any line of a secrets file.
//
// @ref LLP 0137#g0--sweep-freeze — preflight credentials without revealing
// them; missing hosted access later becomes a GAP finding under G2, never an
// invented local equivalent.

import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const sweepRoot = path.resolve(here, "..");
const repoRoot = path.resolve(sweepRoot, "../..");

const args = process.argv.slice(2);
const write = args.includes("--write");
const secretsRootFlag = args.indexOf("--secrets-root");
const secretsRoot =
  secretsRootFlag >= 0 && args[secretsRootFlag + 1]
    ? path.resolve(args[secretsRootFlag + 1])
    : repoRoot;

// Providers LLP 0137 names: Snapback as the swept product (public npm), and
// the pre-declared strongest-fit probe providers.
const probeProviders = [
  "convex",
  "supabase",
  "firebase",
  "instantdb",
  "spacetimedb",
];

const mentionPatterns = {
  convex: /convex/gi,
  supabase: /supabase/gi,
  firebase: /firebase/gi,
  instantdb: /instant/gi,
  spacetimedb: /spacetime/gi,
};

async function fileExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function mentionCounts(candidate) {
  // Reads the file only to count provider-name mentions; the content is
  // discarded and never printed, logged, or persisted.
  const body = await readFile(candidate, "utf8");
  const counts = {};
  for (const provider of probeProviders) {
    counts[provider] = (body.match(mentionPatterns[provider]) ?? []).length;
  }
  return counts;
}

async function commandAvailable(command, commandArgs) {
  try {
    await execFileAsync(command, commandArgs, { timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

async function registryReachable() {
  try {
    const response = await fetch("https://registry.npmjs.org/", {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const apiKeysDir = path.join(homedir(), "Dropbox", "APIKeys");
const dogfoodFile = path.join(apiKeysDir, "dogfood-matrix-secrets.md");
const npmTokenFile = path.join(apiKeysDir, "npm-token.txt");
const agentLocalFile = path.join(secretsRoot, ".agent-local-secrets.md");

const apiKeysDirPresent = await fileExists(apiKeysDir);
const dogfoodPresent = await fileExists(dogfoodFile);
const agentLocalPresent = await fileExists(agentLocalFile);
const dogfoodCounts = dogfoodPresent ? await mentionCounts(dogfoodFile) : null;
const agentLocalCounts = agentLocalPresent
  ? await mentionCounts(agentLocalFile)
  : null;

function providerStatus(provider) {
  const mentions =
    (dogfoodCounts?.[provider] ?? 0) + (agentLocalCounts?.[provider] ?? 0);
  return mentions > 0 ? "credential-material-present" : "absent";
}

const health = {
  schemaVersion: 1,
  protocolId: "llp-0137-improvement-sweep-v1",
  checkedAt: new Date().toISOString().slice(0, 10),
  containsSecretValues: false,
  policy:
    "Only capability names, statuses, booleans, and mention counts are retained. Values, account emails, tokens, project ids, and billing identifiers are forbidden.",
  credentialSources: {
    apiKeysDirectory: {
      source: "~/Dropbox/APIKeys",
      status: apiKeysDirPresent ? "present" : "absent",
    },
    dogfoodMatrixSecrets: {
      source: "~/Dropbox/APIKeys/dogfood-matrix-secrets.md",
      status: dogfoodPresent ? "present" : "absent",
    },
    npmPublishToken: {
      source: "~/Dropbox/APIKeys/npm-token.txt",
      status: (await fileExists(npmTokenFile)) ? "present" : "absent",
      note: "publish-side only; G1 consumption needs no credential",
    },
    agentLocalSecrets: {
      source: ".agent-local-secrets.md (project root)",
      status: agentLocalPresent ? "present" : "absent-in-this-checkout",
    },
  },
  snapbackConsumption: {
    channel: "public npm",
    registryReachable: await registryReachable(),
    credentialRequired: false,
    note: "G1 qualifies the terminal @expo/snapback-* closure separately; installing it needs no credential by design.",
  },
  probeProviders: Object.fromEntries(
    probeProviders.map((provider) => [
      provider,
      {
        status: providerStatus(provider),
        note:
          providerStatus(provider) === "absent"
            ? "no credential material found; a probe would use the provider's official local/emulator path or record a hosted GAP under G2"
            : "named credential material exists; reachability and write-eligibility are verified at probe time under G2",
      },
    ]),
  ),
  localTools: {
    node: { status: "ready", diagnostic: process.version },
    iosSimulator: {
      status: (await commandAvailable("xcrun", ["simctl", "help"]))
        ? "ready"
        : "absent",
      requiredBy: ["track-b-expo-ios"],
    },
    androidTooling: {
      status: (await commandAvailable("adb", ["version"]))
        ? "ready"
        : "absent",
      requiredBy: ["track-b-expo-android"],
    },
  },
  demandDrivenNote:
    "Probes are demand-driven under the frozen probe policy; an absent probe credential does not block G0 or the Snapback web sweep. Track B tooling gaps gate only Track B arms (G3).",
};

const rendered = `${JSON.stringify(health, null, 2)}\n`;
if (write) {
  await writeFile(
    path.join(sweepRoot, "protocol", "credentials-health.v1.json"),
    rendered,
  );
}
process.stdout.write(rendered);

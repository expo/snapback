#!/usr/bin/env node

import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SUPPORTED_NODE_MAJOR = 24;
const FULL_JOURNEY_DRIVER_ID = "social-messenger-full-journey-native-cli-driver.v1";
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveMeteringRoot(packetRoot) {
  const candidates = [
    resolve(packetRoot, "instrument/tools/social-messenger/metering"),
    resolve(SCRIPT_DIRECTORY, "../metering"),
  ];
  for (const candidate of candidates) {
    if (await exists(resolve(candidate, "scale-replay-evidence.mjs"))
        && await exists(resolve(candidate, "manifest.mjs"))) {
      return candidate;
    }
  }
  throw new Error(
    `canonical metering authority is absent; checked ${candidates.join(", ")}`,
  );
}

async function loadAuthority(packetRoot) {
  if (Number(process.versions.node.split(".", 1)[0]) !== SUPPORTED_NODE_MAJOR) {
    throw new Error(
      `canonical terminal validation requires Node ${SUPPORTED_NODE_MAJOR}; observed ${process.version}`,
    );
  }
  const meteringRoot = await resolveMeteringRoot(packetRoot);
  const evidence = await import(pathToFileURL(resolve(
    meteringRoot,
    "scale-replay-evidence.mjs",
  )));
  const manifest = await import(pathToFileURL(resolve(meteringRoot, "manifest.mjs")));
  if (typeof evidence.validateScaleReplayEvidence !== "function"
      || typeof manifest.bindFullJourneyAccountingValues !== "function") {
    throw new Error("canonical metering validators do not expose their required entry points");
  }
  return {
    fixtureAuthority: evidence.SCALE_REPLAY_FIXTURE_AUTHORITY,
    validateScaleReplayEvidence: evidence.validateScaleReplayEvidence,
    bindFullJourneyAccountingValues: manifest.bindFullJourneyAccountingValues,
  };
}

function requireFailureProducerEnvelope(value) {
  const clockKeys = [
    "attempted",
    "wallSeconds",
    "capSeconds",
    "capFractionUsed",
    "capExhausted",
    "probeWallSecondsExcluded",
  ];
  if (value?.clock === null || typeof value?.clock !== "object"
      || clockKeys.some((key) => !Object.hasOwn(value.clock, key))
      || value.clock.probeWallSecondsExcluded !== 0) {
    throw new Error("canonical replay failure lacks the complete producer clock envelope");
  }
  if (value?.failure === null || typeof value?.failure !== "object"
      || typeof value.failure.name !== "string" || value.failure.name.length === 0
      || typeof value.failure.message !== "string" || value.failure.message.length === 0) {
    throw new Error("canonical replay failure lacks the producer failure name and message");
  }
  if (value.outcome === "aborted" && (
    value.clock.capSeconds !== null
    || value.clock.capFractionUsed !== null
    || value.clock.capExhausted !== null
  )) {
    throw new Error("aborted canonical replay failure must retain the producer's null cap fields");
  }
}

function validateFailure(value, bindFullJourneyAccountingValues) {
  const usageAvailable = value?.outcome !== "settlement-timeout";
  const result = bindFullJourneyAccountingValues({
    manifest: {
      driver: { id: FULL_JOURNEY_DRIVER_ID },
      scaleReplayFailure: { outcome: value?.outcome },
    },
    boundaryValue: { milestones: { M8: { status: "green" } } },
    driverCompatibility: {
      usageSettlements: [{
        milestone: "M8",
        usageAvailable,
        usageSettledAt: value?.startedAt,
      }],
    },
    loadedSessions: [{ sourceId: "builder", startedAt: value?.startedAt }],
    channel: { turns: [] },
    replayFailureValue: value,
  });
  requireFailureProducerEnvelope(value);
  return {
    outcome: `failure:${value.outcome}`,
    canonical: {
      clock: result.separateClockPhases.replay,
      firstStartedAt: value.startedAt,
      lastFinishedAt: value.finishedAt,
    },
  };
}

export async function validateCanonicalTerminal(request, packetRoot) {
  const authority = await loadAuthority(packetRoot);
  if (request?.kind === "success") {
    const result = authority.validateScaleReplayEvidence(request.value, request.receipt);
    const disposition = request.value.attempts.at(-1).disposition;
    return {
      outcome: disposition === "completed" ? "success" : "failure:aborted",
      canonical: result,
    };
  }
  if (request?.kind === "failure") {
    return validateFailure(request.value, authority.bindFullJourneyAccountingValues);
  }
  throw new Error("validator request kind must be success or failure");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function main() {
  const rootIndex = process.argv.indexOf("--packet-root");
  if (rootIndex === -1 || rootIndex + 1 >= process.argv.length) {
    throw new Error("--packet-root is required");
  }
  const packetRoot = resolve(process.argv[rootIndex + 1]);
  let authority;
  try {
    authority = await loadAuthority(packetRoot);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, kind: "infrastructure", error: error.message })}\n`);
    process.exitCode = 3;
    return;
  }
  if (process.argv.includes("--doctor")) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      node: process.version,
      fixtureAuthority: authority.fixtureAuthority,
    })}\n`);
    return;
  }
  try {
    const request = await readStdin();
    let result;
    if (request?.kind === "success") {
      const canonical = authority.validateScaleReplayEvidence(request.value, request.receipt);
      const disposition = request.value.attempts.at(-1).disposition;
      result = {
        outcome: disposition === "completed" ? "success" : "failure:aborted",
        canonical,
      };
    } else if (request?.kind === "failure") {
      result = validateFailure(request.value, authority.bindFullJourneyAccountingValues);
    } else {
      throw new Error("validator request kind must be success or failure");
    }
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, kind: "validation", error: error.message })}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

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
  const instrumentRoot = resolve(packetRoot, "instrument");
  const packetAuthority = resolve(instrumentRoot, "tools/social-messenger/metering");
  if (await exists(instrumentRoot)) {
    if (await exists(resolve(packetAuthority, "scale-replay-evidence.mjs"))
        && await exists(resolve(packetAuthority, "manifest.mjs"))) {
      return { path: packetAuthority, source: "packet-instrument" };
    }
    throw new Error(
      `prepared packet instrument lacks canonical metering authority at ${packetAuthority}`,
    );
  }
  const repositoryAuthority = resolve(SCRIPT_DIRECTORY, "../metering");
  if (await exists(resolve(repositoryAuthority, "scale-replay-evidence.mjs"))
      && await exists(resolve(repositoryAuthority, "manifest.mjs"))) {
    return { path: repositoryAuthority, source: "repository-source" };
  }
  throw new Error(`canonical metering authority is absent at ${repositoryAuthority}`);
}

async function loadAuthority(packetRoot) {
  if (Number(process.versions.node.split(".", 1)[0]) !== SUPPORTED_NODE_MAJOR) {
    throw new Error(
      `canonical terminal validation requires Node ${SUPPORTED_NODE_MAJOR}; observed ${process.version}`,
    );
  }
  const metering = await resolveMeteringRoot(packetRoot);
  const meteringRoot = metering.path;
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
    authoritySource: metering.source,
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

function validateWithAuthority(request, authority) {
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

export async function validateCanonicalTerminal(request, packetRoot) {
  return validateWithAuthority(request, await loadAuthority(packetRoot));
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
      authoritySource: authority.authoritySource,
      fixtureAuthority: authority.fixtureAuthority,
    })}\n`);
    return;
  }
  try {
    const request = await readStdin();
    const result = validateWithAuthority(request, authority);
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, kind: "validation", error: error.message })}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

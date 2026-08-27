function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function tokenTotal(counts) {
  return Number.isInteger(counts?.input) && Number.isInteger(counts?.output)
    ? counts.input + counts.output
    : null;
}

function secondsBetween(startedAt, finishedAt) {
  return Math.max(0, (Date.parse(finishedAt) - Date.parse(startedAt)) / 1_000);
}

function sumTokenCounts(values) {
  return values.reduce(
    (total, value) => addTokenCounts(total, value),
    zeroTokenCounts(),
  );
}

function milestoneCharging({ status, authoring, caps }) {
  const actualTokens = tokenTotal(authoring.tokens);
  if (status === "green") {
    return {
      chargedWallSeconds: authoring.wallSeconds,
      chargedTokens: actualTokens,
      flags: [],
    };
  }
  if (authoring.terminalReason === "token-cap") {
    return {
      chargedWallSeconds: authoring.wallSeconds,
      chargedTokens: caps.tokenCap,
      flags: ["capped-tokens"],
    };
  }
  if (["wall-cap", "native-usage-settlement-timeout"].includes(authoring.terminalReason)) {
    return {
      chargedWallSeconds: caps.wallCapSeconds,
      chargedTokens: actualTokens,
      flags: ["capped-wall"],
    };
  }
  return {
    chargedWallSeconds: caps.wallCapSeconds,
    chargedTokens: actualTokens,
    flags: ["aborted"],
  };
}

// @ref LLP 0201#d2--quantitative-instrument — every published quantitative
// claim is composed from the hash-bound base plus one deterministic native
// join, so validation can replay the same complete record rather than checking
// self-consistent subsets.
export function composeRunRecord({ base, patch, expectedMilestones = [] }) {
  if (base === null || typeof base !== "object" || Array.isArray(base)) {
    throw new TypeError("record base must be an object");
  }
  const startedAt = patch.meteringProvenance?.driver?.startedAt;
  requiredString(startedAt, "metering driver.startedAt");
  const attempted = patch.executionOrder.map((milestone) => [
    milestone,
    patch.milestones[milestone],
  ]);
  const finishedAt = attempted.at(-1)?.[1]?.authoring?.terminalAt;
  requiredString(finishedAt, "final milestone terminalAt");
  const continuousAttempted = attempted.filter(([milestone]) => milestone !== "M7");
  const authoringFinishedAt = continuousAttempted.at(-1)?.[1]?.authoring?.terminalAt;
  requiredString(authoringFinishedAt, "continuous-session terminalAt");
  const record = structuredClone(base);
  const continuousSeconds = secondsBetween(startedAt, authoringFinishedAt);
  const firstGreenProofAt = attempted
    .map(([, value]) => value.authoring.firstGreenAt)
    .filter((value) => value !== null)
    .sort()[0] ?? null;
  const orientationAt = patch.firstProductEdit.at;
  const orientationSeconds = orientationAt === null
    ? 0
    : Math.min(continuousSeconds, secondsBetween(startedAt, orientationAt));

  record.timestamps = { startedAt, finishedAt };
  record.firstGreenProofAt = firstGreenProofAt;

  let previousAt = startedAt;
  const milestones = {};
  for (const [milestone, projected] of attempted) {
    const baseMilestone = record.socialMessenger?.milestones?.[milestone] ?? {};
    const {
      wallStartedAt = previousAt,
      ...projectedAuthoring
    } = projected.authoring;
    const authoring = {
      ...baseMilestone.authoring,
      ...projectedAuthoring,
      wallSeconds: secondsBetween(wallStartedAt, projected.authoring.terminalAt),
    };
    const caps = {
      wallCapSeconds: baseMilestone.caps?.wallCapSeconds ?? null,
      tokenCap: baseMilestone.caps?.tokenCap ?? null,
    };
    milestones[milestone] = {
      ...baseMilestone,
      ...projected,
      authoring,
      caps,
      charging: milestoneCharging({ status: projected.status, authoring, caps }),
    };
    previousAt = projected.authoring.terminalAt;
  }
  const expected = expectedMilestones.length > 0 ? expectedMilestones : patch.executionOrder;
  for (const milestone of expected) {
    if (milestones[milestone] !== undefined) continue;
    const baseMilestone = record.socialMessenger?.milestones?.[milestone] ?? {};
    milestones[milestone] = {
      ...baseMilestone,
      status: "not-run",
      authoring: {
        wallSeconds: null,
        tokens: {
          input: null,
          output: null,
          cacheRead: null,
          cacheWrite: null,
          reasoning: null,
        },
        firstGreenAt: null,
        suitePassAt: null,
        choreoPassAt: null,
        terminalAt: null,
        terminalSequence: null,
        terminalReason: null,
      },
      charging: {
        chargedWallSeconds: null,
        chargedTokens: null,
        flags: [],
      },
    };
  }
  const terminatedEarly = patch.executionOrder.length < expected.length
    || attempted.some(([, value]) => value.status !== "green");
  record.socialMessenger = {
    ...record.socialMessenger,
    instrumentVersion: patch.instrumentVersion,
    typingObservationBoundaryVersion: patch.typingObservationBoundaryVersion,
    observabilityProtocol: patch.observabilityProtocol,
    milestones,
    termination: terminatedEarly
      ? {
          terminatedEarly: true,
          reason: record.socialMessenger?.termination?.reason ?? "cell-driver-failure",
          afterMilestone: patch.executionOrder.at(-1) ?? null,
        }
      : { terminatedEarly: false, reason: null, afterMilestone: null },
    firstProductEdit: patch.firstProductEdit,
    meteringProvenance: patch.meteringProvenance,
    efficiencyScorecardEligibility: patch.efficiencyScorecardEligibility,
    suiteStatusLinkage: patch.suiteStatusLinkage,
  };

  const fullJourney = record.socialMessenger.runScope === "full";
  const continuousTokens = fullJourney
    ? sumTokenCounts(continuousAttempted.map(([, value]) => value.authoring.tokens))
    : patch.totals;
  const replayTokens = fullJourney
    ? patch.separateTokenPhases?.replay ?? zeroTokenCounts()
    : zeroTokenCounts();
  const m7Tokens = fullJourney && attempted.some(([milestone]) => milestone === "M7")
    ? milestones.M7.authoring.tokens
    : zeroTokenCounts();
  const totalCounts = fullJourney
    ? sumTokenCounts([continuousTokens, replayTokens, m7Tokens])
    : continuousTokens;
  const continuousTokenTotal = tokenTotal(continuousTokens);
  const replayTokenTotal = tokenTotal(replayTokens);
  const m7TokenTotal = tokenTotal(m7Tokens);
  const orientationTokens = tokenTotal(patch.firstProductEdit.orientationTokens);
  const replayClock = patch.separateClockPhases?.replay
    ?? record.socialMessenger.clocks?.replay;
  const replayWallSeconds = fullJourney
    && replayClock?.attempted === true
    && Number.isFinite(replayClock.wallSeconds)
    ? replayClock.wallSeconds
    : 0;
  const m7WallSeconds = fullJourney
    && attempted.some(([milestone]) => milestone === "M7")
    && Number.isFinite(milestones.M7.authoring.wallSeconds)
    ? milestones.M7.authoring.wallSeconds
    : 0;
  record.wallClock = {
    totalSeconds: continuousSeconds + replayWallSeconds + m7WallSeconds,
    phases: {
      orientation: orientationSeconds,
      authoring: continuousSeconds - orientationSeconds,
      ...(fullJourney ? { replay: replayWallSeconds, m7Session: m7WallSeconds } : {}),
      verification: 0,
      diagnosis: 0,
    },
  };
  record.tokens = {
    input: totalCounts.input,
    output: totalCounts.output,
    source: patch.source,
    phases: {
      orientation: orientationTokens,
      authoring: continuousTokenTotal === null || orientationTokens === null
        ? null
        : continuousTokenTotal - orientationTokens,
      ...(fullJourney ? { replay: replayTokenTotal, m7Session: m7TokenTotal } : {}),
      verification: continuousTokenTotal === null ? null : 0,
      diagnosis: continuousTokenTotal === null ? null : 0,
    },
  };
  if (record.socialMessenger.clocks?.m7Session !== undefined && milestones.M7 !== undefined) {
    record.socialMessenger.clocks.m7Session = {
      ...record.socialMessenger.clocks.m7Session,
      wallSeconds: milestones.M7.authoring.wallSeconds,
      tokens: milestones.M7.authoring.tokens,
    };
  }
  if (record.socialMessenger.clocks?.replay !== undefined && fullJourney) {
    record.socialMessenger.clocks.replay = {
      ...replayClock,
      tokens: replayTokens,
    };
  }
  return record;
}
import { addTokenCounts, zeroTokenCounts } from "./counts.mjs";

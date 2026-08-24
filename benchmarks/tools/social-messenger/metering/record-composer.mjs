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
  if (authoring.terminalReason === "wall-cap") {
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
  const record = structuredClone(base);
  const totalSeconds = secondsBetween(startedAt, finishedAt);
  const firstGreenProofAt = attempted
    .map(([, value]) => value.authoring.firstGreenAt)
    .filter((value) => value !== null)
    .sort()[0] ?? null;
  const orientationAt = patch.firstProductEdit.at;
  const orientationSeconds = orientationAt === null
    ? 0
    : Math.min(totalSeconds, secondsBetween(startedAt, orientationAt));
  const totalTokens = tokenTotal(patch.totals);
  const orientationTokens = tokenTotal(patch.firstProductEdit.orientationTokens);

  record.timestamps = { startedAt, finishedAt };
  record.firstGreenProofAt = firstGreenProofAt;
  record.wallClock = {
    totalSeconds,
    phases: {
      orientation: orientationSeconds,
      authoring: totalSeconds - orientationSeconds,
      verification: 0,
      diagnosis: 0,
    },
  };
  record.tokens = {
    input: patch.totals.input,
    output: patch.totals.output,
    source: patch.source,
    phases: {
      orientation: orientationTokens,
      authoring: totalTokens === null || orientationTokens === null
        ? null
        : totalTokens - orientationTokens,
      verification: totalTokens === null ? null : 0,
      diagnosis: totalTokens === null ? null : 0,
    },
  };

  let previousAt = startedAt;
  const milestones = {};
  for (const [milestone, projected] of attempted) {
    const baseMilestone = record.socialMessenger?.milestones?.[milestone] ?? {};
    const authoring = {
      ...baseMilestone.authoring,
      ...projected.authoring,
      wallSeconds: secondsBetween(previousAt, projected.authoring.terminalAt),
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
  return record;
}

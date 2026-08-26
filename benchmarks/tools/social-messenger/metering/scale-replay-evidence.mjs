import { readFileSync } from "node:fs";

import { timestampMillis } from "./jsonl.mjs";

const COMBINED_FIXTURE = JSON.parse(readFileSync(
  new URL("../../../fixtures/social-messenger/invariant-manifest-combined.json", import.meta.url),
  "utf8",
));

const SCALE_LOG = COMBINED_FIXTURE.artifacts["scale.log"];
const CHECKPOINTS = Object.entries(COMBINED_FIXTURE.checkpoints).map(([id, checkpoint]) => ({
  id,
  settledPrefix: checkpoint.scaleActionsApplied,
  prefixSha256: `sha256:${checkpoint.scalePrefixSha256}`,
}));

export const SCALE_REPLAY_RECEIPT_VERSION =
  "snapback.full-journey-scale-replay-receipt.v1";

export const SCALE_REPLAY_FIXTURE_AUTHORITY = Object.freeze({
  actionLogSha256: `sha256:${SCALE_LOG.sha256}`,
  actionCount: SCALE_LOG.actionCount,
  checkpoints: Object.freeze(CHECKPOINTS.map((checkpoint) => Object.freeze(checkpoint))),
});

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateReceipt(receipt, finalAttempt) {
  const authority = SCALE_REPLAY_FIXTURE_AUTHORITY;
  if (
    receipt?.version !== SCALE_REPLAY_RECEIPT_VERSION
    || typeof receipt.pass !== "boolean"
    || receipt.actionLog?.sha256 !== authority.actionLogSha256
    || receipt.actionLog?.actionCount !== authority.actionCount
    || !Number.isInteger(receipt.settledPrefix)
    || receipt.settledPrefix < 0
    || receipt.settledPrefix > authority.actionCount
    || !Number.isInteger(receipt.failedActions)
    || receipt.failedActions < 0
    || !Array.isArray(receipt.checkpoints)
  ) {
    throw new Error("scale replay receipt does not bind the registered fixture action log");
  }
  const expectedCheckpoints = authority.checkpoints.filter(
    (checkpoint) => checkpoint.settledPrefix <= receipt.settledPrefix,
  );
  if (!sameJson(receipt.checkpoints, expectedCheckpoints)) {
    throw new Error("scale replay receipt checkpoint prefixes differ from the registered action log");
  }
  if (receipt.settledPrefix !== finalAttempt.settledPrefix) {
    throw new Error("scale replay receipt settled prefix differs from the final attempt");
  }
  if (finalAttempt.disposition === "completed") {
    if (
      receipt.pass !== true
      || receipt.failedActions !== 0
      || receipt.settledPrefix !== authority.actionCount
    ) {
      throw new Error("completed scale replay lacks a full passing fixture-bound receipt");
    }
  } else if (receipt.pass !== false) {
    throw new Error("aborted scale replay receipt cannot claim pass");
  }
}

// @ref LLP 0201#d2--quantitative-instrument — the scale phase is admitted
// only when its retained adapter receipt binds the fixture pack's exact action
// log and every reached checkpoint prefix; self-consistent clock prose alone
// is not replay evidence.
export function validateScaleReplayEvidence(value, receipt) {
  if (
    value?.version !== "snapback.full-journey-scale-replay.v1"
    || value.attempted !== true
    || !Number.isFinite(value.capSeconds)
    || value.capSeconds <= 0
    || !Number.isFinite(value.probeWallSecondsExcluded)
    || value.probeWallSecondsExcluded < 0
    || !Array.isArray(value.attempts)
    || value.attempts.length === 0
    || value.receipt === null
    || typeof value.receipt !== "object"
    || Array.isArray(value.receipt)
    || typeof value.receipt.path !== "string"
    || value.receipt.path.length === 0
    || !/^sha256:[a-f0-9]{64}$/u.test(value.receipt.sha256 ?? "")
  ) {
    throw new Error("full-journey scale replay has an invalid evidence contract");
  }
  let priorFinishedAt = null;
  let priorSettledPrefix = 0;
  let totalAttemptSeconds = 0;
  for (const [index, attempt] of value.attempts.entries()) {
    const startedAt = timestampMillis(attempt?.startedAt, `scale attempt ${index + 1}.startedAt`);
    const finishedAt = timestampMillis(attempt?.finishedAt, `scale attempt ${index + 1}.finishedAt`);
    const final = index === value.attempts.length - 1;
    if (
      attempt?.attempt !== index + 1
      || finishedAt < startedAt
      || (priorFinishedAt !== null && startedAt < priorFinishedAt)
      || !Number.isInteger(attempt.settledPrefix)
      || attempt.settledPrefix < priorSettledPrefix
      || attempt.settledPrefix > SCALE_REPLAY_FIXTURE_AUTHORITY.actionCount
      || (index === 0 ? attempt.continuationOf !== null : attempt.continuationOf !== index)
      || (final
        ? !["completed", "aborted"].includes(attempt.disposition)
        : attempt.disposition !== "continued")
    ) {
      throw new Error(`scale attempt ${index + 1} violates chronological continuation semantics`);
    }
    priorFinishedAt = finishedAt;
    priorSettledPrefix = attempt.settledPrefix;
    totalAttemptSeconds += (finishedAt - startedAt) / 1_000;
  }
  if (value.probeWallSecondsExcluded > totalAttemptSeconds) {
    throw new Error("full-journey scale probe exclusion exceeds attempted wall");
  }
  validateReceipt(receipt, value.attempts.at(-1));
  const wallSeconds = totalAttemptSeconds - value.probeWallSecondsExcluded;
  const clock = {
    attempted: true,
    wallSeconds,
    capSeconds: value.capSeconds,
    capFractionUsed: wallSeconds / value.capSeconds,
    capExhausted: wallSeconds >= value.capSeconds,
    probeWallSecondsExcluded: value.probeWallSecondsExcluded,
  };
  if (
    value.wallSeconds !== clock.wallSeconds
    || value.capFractionUsed !== clock.capFractionUsed
    || value.capExhausted !== clock.capExhausted
  ) {
    throw new Error("full-journey scale replay derived clock fields do not match its attempts");
  }
  return {
    clock,
    attempts: value.attempts,
    receipt: value.receipt,
    firstStartedAt: value.attempts[0].startedAt,
    lastFinishedAt: value.attempts.at(-1).finishedAt,
  };
}

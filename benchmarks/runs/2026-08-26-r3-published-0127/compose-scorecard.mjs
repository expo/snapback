#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { validateSocialMessengerRunRecord } from "../../tools/social-messenger/record-validator.mjs";

export const R3_SCORECARD_VERSION = "snapback.r3-run-scorecard.v2";
const STRUCTURAL_ROWS = Object.freeze([
  "covered-fact-source-inspections", "custom-fixed-origin-relays",
  "destructive-additive-schema-restarts", "silent-auth-query-waits",
  "advertised-path-disagreements",
]);
const RATIO_ROWS = Object.freeze([
  "semantic-correction-actions", "output-tokens", "m1-wall-to-first-green",
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function median(values) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function range(values) {
  return values.length === 0
    ? { minimum: null, maximum: null }
    : { minimum: Math.min(...values), maximum: Math.max(...values) };
}

function numericSummary(values) {
  const numeric = values.filter(Number.isFinite);
  return { median: median(numeric), range: range(numeric), n: numeric.length };
}

function milestoneValues(record) {
  return Object.values(record.socialMessenger?.milestones ?? {});
}

function metricValue(record, rowId) {
  const milestones = milestoneValues(record);
  if (rowId === "semantic-correction-actions") {
    const values = milestones.map((milestone) => milestone.semanticActions?.byDisposition?.correction);
    return values.every(Number.isInteger) ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  if (rowId === "output-tokens") {
    const values = milestones.map((milestone) => milestone.authoring?.tokens?.output);
    return values.every(Number.isInteger) ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  if (rowId === "m1-wall-to-first-green") {
    const value = record.socialMessenger?.milestones?.M1?.authoring?.wallSeconds;
    return Number.isFinite(value) ? value : null;
  }
  throw new Error(`R3_SCORECARD_ROW_UNSUPPORTED: ${rowId}`);
}

function successful(record, cell) {
  return cell.milestones.every((milestone) => (
    record.socialMessenger?.milestones?.[milestone]?.status === "green"
  ));
}

function defaultValidator(repositoryRoot, input) {
  const [baseSchema, extensionSchema, composedSchema] = [
    "benchmarks/schema/run-record.schema.json",
    "benchmarks/schema/social-messenger/run-record-extension.schema.json",
    "benchmarks/schema/social-messenger/run-record.schema.json",
  ].map((path) => JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")));
  return validateSocialMessengerRunRecord(composedSchema, input.record, {
    schemas: [baseSchema, extensionSchema], artifactRoot: input.artifactRoot,
  });
}

function contrastDefinitions(config) {
  const scoredLegs = [...new Set(config.cells
    .filter((cell) => !cell.claimEligibility.startsWith("exploratory-"))
    .map((cell) => cell.leg))];
  return scoredLegs.flatMap((leg) => [
    ...[...new Set(config.cells.filter((cell) => cell.leg === leg).map((cell) => cell.app))]
      .map((app) => ({
        id: `explicit-minus-familiar:${leg}:${app}`,
        leg, fixed: { app }, first: { profile: "explicit" }, second: { profile: "familiar" },
      })),
    ...[...new Set(config.cells.filter((cell) => cell.leg === leg).map((cell) => cell.profile))]
      .map((profile) => ({
        id: `clique-minus-coterie:${leg}:${profile}`,
        leg, fixed: { profile }, first: { app: "Clique" }, second: { app: "Coterie" },
      })),
  ]);
}

function matches(cell, fields) {
  return Object.entries(fields).every(([key, value]) => cell[key] === value);
}

function summarizeArm(inputs, definition, arm) {
  return inputs.filter(({ cell }) => (
    cell.leg === definition.leg
    && matches(cell, definition.fixed)
    && matches(cell, definition[arm])
  ));
}

function failureRates(validated) {
  const groups = new Map();
  for (const input of validated) {
    const id = `${input.cell.leg}:${input.cell.app}:${input.cell.profile}`;
    const group = groups.get(id) ?? { attempts: 0, successful: 0, failed: 0 };
    group.attempts += 1;
    if (input.successful) group.successful += 1;
    else group.failed += 1;
    groups.set(id, group);
  }
  return Object.fromEntries([...groups].sort(([left], [right]) => left.localeCompare(right)).map(
    ([id, group]) => [id, {
      ...group, failureRate: group.attempts === 0 ? null : group.failed / group.attempts,
    }],
  ));
}

function insufficientRow({ row, definition, first, second, floor }) {
  return {
    rowId: row.id,
    contrastId: definition.id,
    status: "insufficient successful replicates",
    aggregation: row.aggregation,
    successFloor: floor,
    sides: {
      first: {
        successful: first.filter((item) => item.successful).length,
        eligibleSuccessful: first.filter((item) => item.successful && item.eligible).length,
      },
      second: {
        successful: second.filter((item) => item.successful).length,
        eligibleSuccessful: second.filter((item) => item.successful && item.eligible).length,
      },
    },
    directionConsistency: null,
    pairedSignTest: null,
  };
}

function exactPairedSignTest(differences) {
  if (!differences.every(Number.isFinite)) return null;
  const positive = differences.filter((value) => value > 0).length;
  const negative = differences.filter((value) => value < 0).length;
  const ties = differences.length - positive - negative;
  const n = positive + negative;
  if (n === 0) return { positive, negative, ties, n, exactTwoSidedPValue: 1 };
  const choose = (total, selected) => {
    let result = 1;
    for (let index = 1; index <= selected; index += 1) {
      result = (result * (total - selected + index)) / index;
    }
    return result;
  };
  const tail = Array.from({ length: Math.min(positive, negative) + 1 }, (_, index) => (
    choose(n, index) * (0.5 ** n)
  )).reduce((sum, value) => sum + value, 0);
  return { positive, negative, ties, n, exactTwoSidedPValue: Math.min(1, 2 * tail) };
}

function composeRatioRow({ row, definition, first, second, floor }) {
  const firstSuccessful = first.filter((item) => item.successful && item.eligible);
  const secondSuccessful = second.filter((item) => item.successful && item.eligible);
  if (firstSuccessful.length < floor || secondSuccessful.length < floor) {
    return insufficientRow({ row, definition, first, second, floor });
  }
  const secondByReplicate = new Map(secondSuccessful.map((item) => [item.cell.replicate, item]));
  const pairs = firstSuccessful.flatMap((left) => {
    const right = secondByReplicate.get(left.cell.replicate);
    return right === undefined ? [] : [{ replicate: left.cell.replicate, first: left, second: right }];
  });
  if (pairs.length < floor) return insufficientRow({ row, definition, first, second, floor });
  const constituents = pairs.map((pair) => {
    const firstValue = metricValue(pair.first.record, row.id);
    const secondValue = metricValue(pair.second.record, row.id);
    const complete = Number.isFinite(firstValue) && Number.isFinite(secondValue);
    return {
      replicate: pair.replicate,
      firstCellId: pair.first.cell.id,
      secondCellId: pair.second.cell.id,
      first: firstValue,
      second: secondValue,
      pairedDifference: complete ? firstValue - secondValue : null,
      pairedRatio: complete && firstValue !== 0 ? (firstValue - secondValue) / firstValue : null,
    };
  });
  const completeRatios = constituents.every((item) => Number.isFinite(item.pairedRatio));
  const firstValues = constituents.map((item) => item.first).filter(Number.isFinite);
  const secondValues = constituents.map((item) => item.second).filter(Number.isFinite);
  const ratios = completeRatios ? constituents.map((item) => item.pairedRatio) : [];
  const differences = constituents.map((item) => item.pairedDifference);
  const nonTiedDirections = differences
    .filter((value) => Number.isFinite(value) && value !== 0)
    .map((value) => Math.sign(value));
  const directionConsistency = differences.every(Number.isFinite)
    ? {
        consistent: new Set(nonTiedDirections).size <= 1,
        direction: nonTiedDirections.length === 0
          ? "all-tied"
          : nonTiedDirections[0] > 0 ? "positive" : "negative",
        nonTied: nonTiedDirections.length,
      }
    : null;
  const medianPairedRatio = completeRatios ? median(ratios) : null;
  const medianPairedPercent = medianPairedRatio === null ? null : medianPairedRatio * 100;
  return {
    rowId: row.id,
    contrastId: definition.id,
    status: completeRatios ? "computed" : "absolute-only",
    aggregation: row.aggregation,
    successFloor: floor,
    n: constituents.length,
    arms: {
      first: { median: median(firstValues), range: range(firstValues) },
      second: { median: median(secondValues), range: range(secondValues) },
    },
    medianPairedRatio,
    medianPairedPercent,
    pairedRatioRange: completeRatios ? range(ratios) : { minimum: null, maximum: null },
    contrastBarPercent: row.contrastBarPercent,
    meetsRegisteredMagnitudeBar: medianPairedPercent === null
      ? null
      : Math.abs(medianPairedPercent) >= row.contrastBarPercent,
    directionConsistency,
    pairedSignTest: exactPairedSignTest(differences),
    constituents,
  };
}

function identityCellId(cell) {
  const family = { "codex-sol": "sol", "claude-opus5": "opus", "grok-46": "grok" }[cell.harness];
  if (family === undefined || !Number.isInteger(cell.replicate)) return null;
  return `${family}-${cell.app.toLowerCase()}-${cell.profile}-${cell.replicate}`;
}

function assertRecordIdentity({ config, cell, record }) {
  const provenance = record.socialMessenger?.meteringProvenance;
  const expected = {
    laneRunId: `${config.runId}/${cell.id}`,
    model: cell.model,
    family: cell.meteringPolicy?.capFamily,
    runScope: cell.runScope,
    driver: cell.driverId,
    encodedCellId: identityCellId(cell),
  };
  const actual = {
    laneRunId: provenance?.laneRunId,
    model: record.harness?.model,
    family: record.socialMessenger?.capFamily,
    runScope: record.socialMessenger?.runScope,
    driver: provenance?.driver?.id,
    encodedCellId: cell.id,
  };
  if (Object.keys(expected).some((key) => expected[key] === undefined || expected[key] !== actual[key])) {
    throw new Error(
      `R3_SCORECARD_INPUT_IDENTITY: ${cell.id} record does not bind its `
      + "laneRunId, model/family, app, profile, replicate, driver, and runScope",
    );
  }
}

function loadInputBytes(input) {
  if (typeof input.path !== "string" || input.path.length === 0) {
    throw new Error(`R3_SCORECARD_INPUT_IDENTITY: ${input.cellId} has no record path`);
  }
  if (input.recordBytes !== undefined) return Buffer.from(input.recordBytes);
  const path = resolve(input.path);
  if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path || !statSync(path).isFile()) {
    throw new Error(`R3_SCORECARD_INPUT_IDENTITY: ${input.cellId} record path is not canonical`);
  }
  return readFileSync(path);
}

function readStream(input, descriptor) {
  if (
    typeof descriptor?.sourceId !== "string"
    || typeof descriptor.path !== "string"
    || !SHA256.test(descriptor.sha256 ?? "")
  ) {
    throw new Error(`R3_SCORECARD_STREAM_INVALID: ${input.cellId} has a malformed stream descriptor`);
  }
  let bytes;
  if (input.evidenceStreams?.[descriptor.sourceId] !== undefined) {
    bytes = Buffer.from(input.evidenceStreams[descriptor.sourceId]);
  } else {
    const root = realpathSync(resolve(input.artifactRoot));
    const path = resolve(root, descriptor.path);
    const logical = relative(root, path);
    if (logical === ".." || logical.startsWith(`..${sep}`) || isAbsolute(logical)) {
      throw new Error(`R3_SCORECARD_STREAM_INVALID: ${descriptor.path} escapes ${input.cellId}`);
    }
    if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path || !statSync(path).isFile()) {
      throw new Error(`R3_SCORECARD_STREAM_INVALID: ${descriptor.path} is not a canonical file`);
    }
    bytes = readFileSync(path);
  }
  if (digest(bytes) !== descriptor.sha256 || !bytes.toString("utf8").endsWith("\n")) {
    throw new Error(`R3_SCORECARD_STREAM_INVALID: ${input.cellId}/${descriptor.sourceId} bytes differ`);
  }
  return bytes.toString("utf8").trimEnd().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function correctionCount(record, pattern) {
  const loops = record.correctionLoops;
  if (!Array.isArray(loops)) return null;
  return loops.filter((loop) => pattern.test(loop?.summary ?? "")).length;
}

function structuralValue(record, rowId) {
  if (rowId === "covered-fact-source-inspections") {
    const values = milestoneValues(record).map((milestone) => milestone.semanticActions?.byClass?.["source-inspection"]);
    return values.every(Number.isInteger) ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  if (rowId === "destructive-additive-schema-restarts") {
    const values = milestoneValues(record).map((milestone) => {
      const restarts = milestone.restartReseed?.restarts;
      const destructive = milestone.restartReseed?.destructiveReseeds;
      return Number.isInteger(restarts) && Number.isInteger(destructive) ? restarts + destructive : null;
    });
    return values.every(Number.isInteger) ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  if (rowId === "custom-fixed-origin-relays") {
    return correctionCount(record, /(?:custom|fixed[- ]origin).*(?:relay|binding)|(?:relay|binding).*fixed[- ]origin/iu);
  }
  if (rowId === "silent-auth-query-waits") {
    return correctionCount(record, /(?:silent|timeout).*(?:auth|query|app wait)|(?:auth|query).*timeout/iu);
  }
  if (rowId === "advertised-path-disagreements") {
    return correctionCount(record, /(?:advertised path|guide|type|codegen|runtime|client).*(?:disagree|mismatch)/iu);
  }
  throw new Error(`R3_SCORECARD_ROW_UNSUPPORTED: ${rowId}`);
}

function groupId(item) {
  return `${item.cell.leg}:${item.cell.app}:${item.cell.profile}`;
}

function summarizeConstituentRow(row, constituents, { maximum = false } = {}) {
  const values = constituents.map((item) => item.value);
  const summary = numericSummary(values);
  return {
    rowId: row.id,
    status: constituents.length === 0
      ? "incomplete"
      : values.every((value) => Number.isFinite(value))
      ? (constituents.every((item) => item.pass) ? "pass" : "fail")
      : "incomplete",
    aggregation: row.aggregation,
    ...summary,
    ...(maximum ? { maximum: summary.range.maximum } : {}),
    constituents,
  };
}

function withGroups(row, constituents, options = {}) {
  const groups = new Map();
  for (const item of constituents) {
    const values = groups.get(item.groupId) ?? [];
    values.push(item);
    groups.set(item.groupId, values);
  }
  const result = summarizeConstituentRow(row, constituents, options);
  result.groups = [...groups].sort(([left], [right]) => left.localeCompare(right))
    .map(([id, values]) => ({ id, ...summarizeConstituentRow(row, values, options) }));
  return result;
}

function composeStructuralRow(row, validated) {
  const constituents = validated.filter((item) => item.eligible).map((item) => {
    const value = structuralValue(item.record, row.id);
    return { cellId: item.cell.id, groupId: groupId(item), value, pass: value === 0 };
  });
  return withGroups(row, constituents);
}

function composeOrientationRow(row, validated) {
  const threshold = row.threshold?.bytes;
  const constituents = validated.filter((item) => item.successful && item.eligible).map((item) => {
    const value = item.record.socialMessenger?.firstProductEdit?.orientationBytes;
    return {
      cellId: item.cell.id,
      groupId: groupId(item),
      value: Number.isInteger(value) ? value : null,
      pass: Number.isInteger(value) && Number.isInteger(threshold) && value <= threshold,
    };
  });
  return { ...withGroups(row, constituents), threshold: row.threshold };
}

function composeChoreographyRow(row, validated) {
  const constituents = validated.filter((item) => item.successful && item.eligible).map((item) => {
    const descriptors = item.record.socialMessenger?.meteringProvenance?.observations
      ?.filter((source) => /(?:lane-controller|choreography)/u.test(source.sourceId)) ?? [];
    if (descriptors.length === 0) {
      return { cellId: item.cell.id, groupId: groupId(item), value: null, pass: false, assertions: [] };
    }
    const events = descriptors.flatMap((descriptor) => readStream(item, descriptor))
      .filter((event) => event.type === "assertion-wait" && event.owner === "choreography");
    const byAssertion = new Map();
    for (const event of events) {
      const id = `${event.milestone}:${event.assertion}`;
      const attempts = byAssertion.get(id) ?? new Map();
      const previous = attempts.get(event.attempt);
      if (previous !== undefined && previous.pass !== event.pass) {
        throw new Error(
          `R3_SCORECARD_STREAM_INVALID: ${item.cell.id}/${id} attempt ${event.attempt} has conflicting verdicts`,
        );
      }
      attempts.set(event.attempt, event);
      byAssertion.set(id, attempts);
    }
    const assertions = [...byAssertion].sort(([left], [right]) => left.localeCompare(right))
      .map(([assertionId, attempts]) => {
        const ordered = [...attempts.values()].sort((left, right) => left.attempt - right.attempt);
        const firstFailure = ordered.findIndex((attempt) => attempt.pass === false);
        const retries = firstFailure < 0 ? 0 : ordered.length - firstFailure - 1;
        return {
          assertionId,
          failed: firstFailure >= 0,
          retries,
          pass: firstFailure < 0 ? retries === 0 : retries <= 1,
        };
      });
    const value = assertions.reduce((maximum, assertion) => Math.max(maximum, assertion.retries), 0);
    return {
      cellId: item.cell.id,
      groupId: groupId(item),
      value,
      pass: assertions.every((assertion) => assertion.pass),
      assertions,
    };
  });
  return withGroups(row, constituents, { maximum: true });
}

function collectAdvisories(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectAdvisories(item, found);
  } else if (value && typeof value === "object") {
    if (typeof value.repairClass === "string" && Number.isInteger(value.affectedTableCount)) {
      found.push({
        repairClass: value.repairClass.trim().toLowerCase(),
        affectedTableCount: value.affectedTableCount,
      });
    }
    for (const item of Object.values(value)) collectAdvisories(item, found);
  }
  return found;
}

function composeMigrationRow(row, validated) {
  const constituents = validated.filter((item) => item.successful && item.eligible).map((item) => {
    const descriptors = item.record.socialMessenger?.meteringProvenance?.sessions ?? [];
    if (descriptors.length === 0) {
      return { cellId: item.cell.id, groupId: groupId(item), value: null, pass: false, classes: [] };
    }
    const advisories = descriptors.flatMap((descriptor) => (
      readStream(item, descriptor).flatMap((record) => collectAdvisories(record))
    ));
    const grouped = new Map();
    for (const advisory of advisories) {
      const current = grouped.get(advisory.repairClass) ?? [];
      current.push(advisory.affectedTableCount);
      grouped.set(advisory.repairClass, current);
    }
    const classes = [...grouped].sort(([left], [right]) => left.localeCompare(right))
      .map(([repairClass, counts]) => ({
        repairClass,
        affectedTableCount: counts.length === 1 ? counts[0] : null,
        occurrences: counts.length,
        observedAffectedTableCounts: counts,
        pass: counts.length === 1,
      }));
    return {
      cellId: item.cell.id,
      groupId: groupId(item),
      value: classes.length,
      pass: classes.every((candidate) => candidate.pass),
      classes,
    };
  });
  return withGroups(row, constituents);
}

// @ref LLP 0295#r3-claim-eligible-wave — the sanctioned R3 composer binds
// byte-valid inputs before emitting every preregistered scorecard class.
export function composeScorecard({
  config,
  inputs,
  repositoryRoot,
  validateRecord = (input) => defaultValidator(repositoryRoot, input),
}) {
  if (config?.scoring?.composer?.path !== "compose-scorecard.mjs") {
    throw new Error("R3_SCORECARD_CONFIG_INVALID: config.scoring does not sanction this composer");
  }
  const floor = config.scoring?.successFloor?.minimumSuccessfulReplicatesPerSide;
  if (!Number.isInteger(floor) || floor < 1) {
    throw new Error("R3_SCORECARD_CONFIG_INVALID: success floor must be a positive integer");
  }
  if (!Array.isArray(inputs)) throw new TypeError("R3 scorecard inputs must be an array");
  const cells = new Map(config.cells.map((cell) => [cell.id, cell]));
  const seenIds = new Set();
  const seenPaths = new Set();
  const seenDigests = new Map();
  const validated = inputs.map((input) => {
    const cell = cells.get(input.cellId);
    const canonicalPath = resolve(input.path ?? "");
    if (cell === undefined || seenIds.has(input.cellId)) {
      throw new Error(`R3_SCORECARD_INPUT_IDENTITY: ${input.cellId} is unknown or duplicated`);
    }
    if (seenPaths.has(canonicalPath)) {
      throw new Error(`R3_SCORECARD_INPUT_IDENTITY: duplicate record path ${input.path}`);
    }
    seenIds.add(input.cellId);
    seenPaths.add(canonicalPath);
    const recordBytes = loadInputBytes(input);
    const recordDigest = digest(recordBytes);
    if (seenDigests.has(recordDigest)) {
      throw new Error(
        `R3_SCORECARD_INPUT_IDENTITY: one record is supplied under both ${seenDigests.get(recordDigest)} and ${input.cellId}`,
      );
    }
    seenDigests.set(recordDigest, input.cellId);
    let record;
    try { record = JSON.parse(recordBytes.toString("utf8")); } catch (error) {
      throw new Error(`R3_SCORECARD_INPUT_INVALID: ${input.cellId} is not valid JSON: ${error.message}`);
    }
    if (input.record !== undefined && JSON.stringify(input.record) !== JSON.stringify(record)) {
      throw new Error(`R3_SCORECARD_INPUT_IDENTITY: ${input.cellId} object differs from its record bytes`);
    }
    const normalized = { ...input, record, recordBytes };
    const errors = validateRecord(normalized);
    if (!Array.isArray(errors) || errors.length > 0) {
      throw new Error(
        `R3_SCORECARD_INPUT_INVALID: ${input.cellId} failed validation: ${
          Array.isArray(errors) ? errors.join("; ") : "validator returned a non-array verdict"
        }`,
      );
    }
    assertRecordIdentity({ config, cell, record });
    return {
      ...normalized,
      cell,
      successful: successful(record, cell),
      eligible: record.socialMessenger.efficiencyScorecardEligibility?.eligible === true,
    };
  });

  const registeredRows = new Map(config.scoring.scorecardRows.map((row) => [row.id, row]));
  const requiredRows = [
    ...STRUCTURAL_ROWS, "bounded-orientation-packet", "choreography-retry-ceiling",
    "grouped-migration-advisories", "debug-artifact-attribution", ...RATIO_ROWS,
  ];
  if (requiredRows.some((id) => !registeredRows.has(id))) {
    throw new Error("R3_SCORECARD_CONFIG_INVALID: one or more preregistered rows are missing");
  }
  if (RATIO_ROWS.some((id) => !Number.isFinite(registeredRows.get(id).contrastBarPercent))) {
    throw new Error("R3_SCORECARD_CONFIG_INVALID: one or more ratio magnitude bars are missing");
  }
  const structuralRows = STRUCTURAL_ROWS.map((id) => composeStructuralRow(registeredRows.get(id), validated));
  const boundedOrientationRow = composeOrientationRow(registeredRows.get("bounded-orientation-packet"), validated);
  const choreographyRetryRow = composeChoreographyRow(registeredRows.get("choreography-retry-ceiling"), validated);
  const groupedMigrationAdvisoriesRow = composeMigrationRow(
    registeredRows.get("grouped-migration-advisories"), validated,
  );
  const ratioRows = contrastDefinitions(config).flatMap((definition) => {
    const first = summarizeArm(validated, definition, "first");
    const second = summarizeArm(validated, definition, "second");
    return RATIO_ROWS.map((rowId) => composeRatioRow({
      row: registeredRows.get(rowId), definition, first, second, floor,
    }));
  });
  const excludedRows = [{
    rowId: "debug-artifact-attribution",
    status: "excluded-with-rationale",
    rationale: registeredRows.get("debug-artifact-attribution").rationale,
  }];
  const scorecardRows = [
    ...structuralRows,
    boundedOrientationRow,
    choreographyRetryRow,
    groupedMigrationAdvisoriesRow,
    ...excludedRows,
    ...RATIO_ROWS.map((rowId) => ({
      rowId,
      status: "contrasts-composed",
      contrasts: ratioRows.filter((row) => row.rowId === rowId),
    })),
  ];
  return {
    version: R3_SCORECARD_VERSION,
    runId: config.runId,
    composer: config.scoring.composer,
    inputCount: validated.length,
    failureRates: failureRates(validated),
    scorecardRows,
    structuralRows,
    boundedOrientationRow,
    choreographyRetryRow,
    groupedMigrationAdvisoriesRow,
    ratioRows,
    pairedSignTests: ratioRows.map((row) => ({
      rowId: row.rowId,
      contrastId: row.contrastId,
      directionConsistency: row.directionConsistency,
      pairedSignTest: row.pairedSignTest,
    })),
    excludedRows,
  };
}

function parseArgs(argv) {
  const options = { configPath: null, outPath: null, records: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--harness-config") options.configPath = argv[++index];
    else if (arg === "--out") options.outPath = argv[++index];
    else if (arg === "--record") options.records.push(argv[++index]);
    else throw new Error(`R3_SCORECARD_USAGE: unknown argument ${arg}`);
  }
  if (options.configPath === null) throw new Error("R3_SCORECARD_USAGE: --harness-config is required");
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  const configPath = resolve(options.configPath);
  const runRoot = dirname(configPath);
  const repositoryRoot = resolve(runRoot, "../../..");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const explicit = new Map();
  for (const value of options.records) {
    const separator = value.indexOf("=");
    if (separator <= 0) throw new Error("R3_SCORECARD_USAGE: --record must be cellId=path");
    const cellId = value.slice(0, separator);
    if (explicit.has(cellId)) throw new Error(`R3_SCORECARD_INPUT_IDENTITY: duplicate explicit ID ${cellId}`);
    explicit.set(cellId, resolve(value.slice(separator + 1)));
  }
  const inputs = config.cells.flatMap((cell) => {
    const recordPath = explicit.get(cell.id) ?? resolve(runRoot, "cells", cell.id, "record.json");
    if (!existsSync(recordPath)) return [];
    const recordBytes = readFileSync(recordPath);
    return [{
      cellId: cell.id,
      record: JSON.parse(recordBytes.toString("utf8")),
      recordBytes,
      artifactRoot: dirname(recordPath),
      path: recordPath,
    }];
  });
  if (explicit.size !== inputs.filter((input) => explicit.has(input.cellId)).length) {
    throw new Error("R3_SCORECARD_INPUT_IDENTITY: one or more explicit records do not name configured cells");
  }
  const result = composeScorecard({ config, inputs, repositoryRoot });
  const bytes = `${JSON.stringify(result, null, 2)}\n`;
  if (options.outPath === null) process.stdout.write(bytes);
  else writeFileSync(resolve(options.outPath), bytes, { flag: "wx" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

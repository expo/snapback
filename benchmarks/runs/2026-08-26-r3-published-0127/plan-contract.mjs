import { createHash } from "node:crypto";

export const SCORECARD_ROW_IDS = Object.freeze([
  "covered-fact-source-inspections",
  "custom-fixed-origin-relays",
  "destructive-additive-schema-restarts",
  "silent-auth-query-waits",
  "advertised-path-disagreements",
  "bounded-orientation-packet",
  "choreography-retry-ceiling",
  "grouped-migration-advisories",
  "debug-artifact-attribution",
  "semantic-correction-actions",
  "output-tokens",
  "m1-wall-to-first-green",
]);

export const CHOREOGRAPHY_RETRY_AGGREGATION =
  "per successful eligible cell, derive retry counts by failed assertion identity from the hash-bound controller/choreography streams; require at most one retry for each failed assertion and zero retries for unaffected assertion identities; publish every constituent, maximum, median, range, and N";

export const MIGRATION_ADVISORY_AGGREGATION =
  "per successful eligible cell, group retained native-stream migration advisories by normalized repair class; require exactly one advisory per class with its exact affected-table count; publish every class/count constituent, median class count, range, and N";

export const MIGRATION_ADVISORY_RECORD_SELECTOR = Object.freeze({
  recordTypeField: "event",
  recordType: "migration-advisory",
  advisoriesPath: "migrationAdvisories[]",
});

export const SCORECARD_INSTRUMENT_DISPOSITIONS = Object.freeze({
  "covered-fact-source-inspections": Object.freeze({
    instrumentDisposition: "instrument-incomplete",
    rationale: "No registered covered-fact classifier exists; raw source-inspection actions are scope-blind.",
  }),
  "custom-fixed-origin-relays": Object.freeze({
    instrumentDisposition: "instrument-incomplete",
    rationale: "No registered typed action or advisory identifies custom fixed-origin relay/binding implementations.",
  }),
  "destructive-additive-schema-restarts": Object.freeze({
    instrumentDisposition: "instrument-incomplete",
    rationale: "Registered lifecycle counters do not classify whether a restart or destructive reseed was caused by additive schema work.",
  }),
  "silent-auth-query-waits": Object.freeze({
    instrumentDisposition: "instrument-incomplete",
    rationale: "No registered typed action or advisory identifies silent auth/query waits requiring an app timeout.",
  }),
  "advertised-path-disagreements": Object.freeze({
    instrumentDisposition: "instrument-incomplete",
    rationale: "No registered typed action or advisory identifies Guide/type/codegen/runtime/client disagreements.",
  }),
  "bounded-orientation-packet": Object.freeze({
    instrumentDisposition: "computed",
    rationale: "The registered firstProductEdit.orientationBytes field is a typed, hash-bound measurement.",
  }),
});

export function r3NamedFailure(diagnostic, message) {
  const error = new Error(`${diagnostic}: ${message}`);
  error.code = diagnostic;
  throw error;
}

export function assertSlotMapping({ actual, expected, cellId }) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    r3NamedFailure(
      "R3_PLAN_SLOT_MAPPING_DRIFT",
      `cell ${cellId} no longer matches its full ID semantics`,
    );
  }
}

export function assertPromptPin({ promptBytes, promptPin, promptFile, cellId }) {
  const actualSha256 = createHash("sha256").update(promptBytes).digest("hex");
  if (promptPin?.path !== promptFile || promptPin.sha256 !== actualSha256) {
    r3NamedFailure(
      "R3_PLAN_PROMPT_HASH_DRIFT",
      `cell ${cellId} prompt bytes differ from the registered pin`,
    );
  }
}

export function assertPristineSlot({ entries, slot, expectedSlot, cellId }) {
  if (JSON.stringify(entries) !== JSON.stringify(["cell.json"])) {
    r3NamedFailure(
      "R3_PLAN_PRIOR_ATTEMPT_STATE",
      `cell ${cellId} slot directory carries extra files`,
    );
  }
  if (JSON.stringify(slot) !== JSON.stringify(expectedSlot)) {
    r3NamedFailure(
      "R3_PLAN_PRIOR_ATTEMPT_STATE",
      `cell ${cellId} slot has prior-attempt fields or drift`,
    );
  }
}

export function assertNoRetainedFinalization(config) {
  if (Object.hasOwn(config.pins.instrument, "instrumentMigrations")) {
    r3NamedFailure(
      "R3_PLAN_RETAINED_FINALIZATION_FORBIDDEN",
      "this run must not register a retained-finalization migration entry",
    );
  }
}

export function assertSnapback0125Alias(config) {
  if (
    config.pins.snapback0125.compatibilityAliasOf !== "snapback0127"
    || config.pins.snapback0125.version !== config.pins.snapback0127.version
    || config.pins.snapback0125.closureId !== config.pins.snapback0127.closureId
  ) {
    r3NamedFailure(
      "R3_PLAN_SNAPBACK0125_ALIAS_MISMATCH",
      "pins.snapback0125 is not an exact compatibility alias of the 0.1.27 registration",
    );
  }
}

export function assertScorecardRegistration(scoring) {
  const rows = scoring?.scorecardRows;
  const choreography = rows?.find((row) => row.id === "choreography-retry-ceiling");
  const migration = rows?.find((row) => row.id === "grouped-migration-advisories");
  const excluded = rows?.filter((row) => row.excluded === true) ?? [];
  if (
    scoring?.successfulCompletion?.recordStatus !== "SUCCESSFUL"
    || scoring.successfulCompletion.validator !== "validator-clean"
    || scoring.successFloor?.minimumSuccessfulReplicatesPerSide !== 3
    || scoring.successFloor.belowFloorDisposition !== "insufficient successful replicates"
    || rows?.length !== SCORECARD_ROW_IDS.length
    || JSON.stringify(rows.map((row) => row.id)) !== JSON.stringify(SCORECARD_ROW_IDS)
    || excluded.length !== 1
    || excluded[0].id !== "debug-artifact-attribution"
    || choreography?.excluded === true
    || choreography?.source !== "controller-and-choreography-streams"
    || choreography?.aggregation !== CHOREOGRAPHY_RETRY_AGGREGATION
    || migration?.excluded === true
    || migration?.source !== "retained-native-streams"
    || migration?.aggregation !== MIGRATION_ADVISORY_AGGREGATION
    || JSON.stringify(migration?.recordSelector) !== JSON.stringify(MIGRATION_ADVISORY_RECORD_SELECTOR)
    || Object.entries(SCORECARD_INSTRUMENT_DISPOSITIONS).some(([id, expected]) => {
      const row = rows?.find((candidate) => candidate.id === id);
      return row?.instrumentDisposition !== expected.instrumentDisposition
        || row.rationale !== expected.rationale;
    })
    || scoring.composer?.path !== "compose-scorecard.mjs"
    || scoring.composer?.sanctioned !== true
  ) {
    r3NamedFailure(
      "R3_PLAN_SCORECARD_SHAPE",
      "successful-completion floor or measured/excluded scorecard registration drifted",
    );
  }
}

export function assertExecutionSafetyRegistration(execution) {
  if (execution?.perMilestoneWallSafetyLimitSeconds !== 14400) {
    r3NamedFailure(
      "R3_PLAN_MILESTONE_WALL_SAFETY_DRIFT",
      "execution.perMilestoneWallSafetyLimitSeconds must remain frozen at 14400",
    );
  }
}

export function assertSmokeSummaryBinding({
  summary,
  config,
  harnessConfigSha256,
}) {
  const expectedMeteringRoot = config.execution.sourceClosure.meteringRoot.sha256
    .replace(/^sha256:/u, "");
  const expected = {
    harnessConfigSha256,
    instrumentManifestSha256: config.pins.instrument.manifestSha256,
    materializedInstrumentRoot: config.paths.instrumentRoot,
    meteringSourceClosureSha256: expectedMeteringRoot,
    laneControllerSha256: config.pins.instrument.d06MeteringOverlay.laneControllerSha256,
    productionDriverSha256: config.pins.instrument.d06MeteringOverlay.productionDriverSha256,
  };
  if (
    summary?.version !== "snapback.r3-non-consuming-smoke-summary.v1"
    || summary.status !== "passed"
    || JSON.stringify(summary.bindings) !== JSON.stringify(expected)
    || summary.result?.scored !== false
    || summary.result.attemptConsumed !== false
    || summary.result.productionLockAcquired !== false
    || summary.result.nativeSessionLaunched !== false
    || summary.result.materializedInstrumentRoot !== undefined
    || summary.result.diskAdmission?.passed !== true
    || summary.result.diskAdmission.diagnostic !== config.execution.diskPolicy.refusalDiagnostic
  ) {
    r3NamedFailure(
      "R3_PLAN_SMOKE_SUMMARY_BINDING",
      "non-consuming smoke summary is not bound to the exact final config/instrument/controller/driver closure",
    );
  }
}

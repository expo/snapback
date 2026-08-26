import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CHOREOGRAPHY_RETRY_AGGREGATION,
  MIGRATION_ADVISORY_AGGREGATION,
  assertNoRetainedFinalization,
  assertPristineSlot,
  assertPromptPin,
  assertScorecardRegistration,
  assertSlotMapping,
  assertSmokeSummaryBinding,
  assertSnapback0125Alias,
} from "../../../../runs/2026-08-26-r3-published-0127/plan-contract.mjs";
import {
  composeScorecard,
} from "../../../../runs/2026-08-26-r3-published-0127/compose-scorecard.mjs";

const ROOT_PATH = fileURLToPath(new URL("../../../../../", import.meta.url));

function exactDiagnostic(code) {
  return (error) => error.code === code && error.message.startsWith(`${code}:`);
}

test("R3 packet negative diagnostics exercise their exact validation paths", () => {
  assert.throws(() => assertSlotMapping({
    actual: { leg: "B" },
    expected: { leg: "A" },
    cellId: "sol-clique-explicit-1",
  }), exactDiagnostic("R3_PLAN_SLOT_MAPPING_DRIFT"));

  assert.throws(() => assertPristineSlot({
    entries: ["cell.json", "record.json"],
    slot: { status: "not-started" },
    expectedSlot: { status: "not-started" },
    cellId: "sol-clique-explicit-1",
  }), exactDiagnostic("R3_PLAN_PRIOR_ATTEMPT_STATE"));

  const promptBytes = Buffer.from("frozen prompt\n");
  assert.throws(() => assertPromptPin({
    promptBytes,
    promptPin: { path: "prompts/clique-explicit.md", sha256: "0".repeat(64) },
    promptFile: "prompts/clique-explicit.md",
    cellId: "sol-clique-explicit-1",
  }), exactDiagnostic("R3_PLAN_PROMPT_HASH_DRIFT"));

  assert.throws(() => assertNoRetainedFinalization({
    pins: { instrument: { instrumentMigrations: [] } },
  }), exactDiagnostic("R3_PLAN_RETAINED_FINALIZATION_FORBIDDEN"));

  const aliasConfig = {
    pins: {
      snapback0127: { version: "0.1.27", closureId: "closure" },
      snapback0125: {
        compatibilityAliasOf: "snapback0127",
        version: "0.1.25",
        closureId: "closure",
      },
    },
  };
  assert.throws(
    () => assertSnapback0125Alias(aliasConfig),
    exactDiagnostic("R3_PLAN_SNAPBACK0125_ALIAS_MISMATCH"),
  );

  const config = {
    pins: {
      instrument: {
        manifestSha256: "manifest",
        d06MeteringOverlay: {
          laneControllerSha256: "controller",
          productionDriverSha256: "driver",
        },
      },
    },
    paths: { instrumentRoot: "/instrument" },
    execution: {
      sourceClosure: { meteringRoot: { sha256: `sha256:${"a".repeat(64)}` } },
      diskPolicy: { refusalDiagnostic: "R3_ADMISSION_DISK_FLOOR" },
    },
  };
  const expectedBindings = {
    harnessConfigSha256: "config",
    instrumentManifestSha256: "manifest",
    materializedInstrumentRoot: "/instrument",
    meteringSourceClosureSha256: "a".repeat(64),
    laneControllerSha256: "controller",
    productionDriverSha256: "driver",
  };
  assert.throws(() => assertSmokeSummaryBinding({
    summary: {
      version: "snapback.r3-non-consuming-smoke-summary.v1",
      status: "passed",
      bindings: { ...expectedBindings, productionDriverSha256: "drifted" },
      result: {
        scored: false,
        attemptConsumed: false,
        productionLockAcquired: false,
        nativeSessionLaunched: false,
        diskAdmission: { passed: true, diagnostic: "R3_ADMISSION_DISK_FLOOR" },
      },
    },
    config,
    harnessConfigSha256: "config",
  }), exactDiagnostic("R3_PLAN_SMOKE_SUMMARY_BINDING"));
});

function scoringRegistration() {
  const ids = [
    "covered-fact-source-inspections", "custom-fixed-origin-relays",
    "destructive-additive-schema-restarts", "silent-auth-query-waits",
    "advertised-path-disagreements", "bounded-orientation-packet",
    "choreography-retry-ceiling", "grouped-migration-advisories",
    "debug-artifact-attribution", "semantic-correction-actions",
    "output-tokens", "m1-wall-to-first-green",
  ];
  return {
    successfulCompletion: { recordStatus: "SUCCESSFUL", validator: "validator-clean" },
    successFloor: {
      minimumSuccessfulReplicatesPerSide: 3,
      belowFloorDisposition: "insufficient successful replicates",
    },
    composer: { path: "compose-scorecard.mjs", sanctioned: true },
    scorecardRows: ids.map((id) => {
      if (id === "choreography-retry-ceiling") return {
        id,
        source: "controller-and-choreography-streams",
        aggregation: CHOREOGRAPHY_RETRY_AGGREGATION,
      };
      if (id === "grouped-migration-advisories") return {
        id,
        source: "retained-native-streams",
        aggregation: MIGRATION_ADVISORY_AGGREGATION,
      };
      if (id === "bounded-orientation-packet") return {
        id,
        threshold: { operator: "<=", bytes: 16384 },
        aggregation: `frozen:${id}`,
      };
      if (id === "debug-artifact-attribution") return {
        id,
        excluded: true,
        rationale: "published npm wave has no debug binary",
      };
      if (["semantic-correction-actions", "output-tokens", "m1-wall-to-first-green"].includes(id)) {
        return {
          id,
          contrastBarPercent: {
            "semantic-correction-actions": 40,
            "output-tokens": 20,
            "m1-wall-to-first-green": 30,
          }[id],
          aggregation: `frozen:${id}`,
        };
      }
      return { id, aggregation: `frozen:${id}` };
    }),
  };
}

test("R3 plan requires retry/advisory rows measured and only debug attribution excluded", () => {
  const scoring = scoringRegistration();
  assert.doesNotThrow(() => assertScorecardRegistration(scoring));
  const drifted = structuredClone(scoring);
  drifted.scorecardRows.find((row) => row.id === "grouped-migration-advisories").excluded = true;
  assert.throws(
    () => assertScorecardRegistration(drifted),
    exactDiagnostic("R3_PLAN_SCORECARD_SHAPE"),
  );
});

function scorecardConfig(replicates) {
  const cells = [];
  for (const profile of ["explicit", "familiar"]) {
    for (let replicate = 1; replicate <= replicates; replicate += 1) {
      cells.push({
        id: `sol-clique-${profile}-${replicate}`,
        leg: "A",
        app: "Clique",
        profile,
        replicate,
        milestones: ["M1"],
        claimEligibility: "scored-family-and-profile-scoped",
        harness: "codex-sol",
        model: "gpt-5.6-sol",
        runScope: "full",
        driverId: "social-messenger-full-journey-native-cli-driver.v1",
        meteringPolicy: { capFamily: "gpt-frontier" },
      });
    }
  }
  return {
    runId: "fixture-r3",
    cells,
    scoring: scoringRegistration(),
  };
}

function scorecardRecord({ successful = true, output = 10, correction = 2, wall = 100 } = {}) {
  return {
    correctionLoops: [],
    socialMessenger: {
      efficiencyScorecardEligibility: { eligible: true },
      firstProductEdit: { orientationBytes: 1024 },
      milestones: {
        M1: {
          status: successful ? "green" : "capability-failure",
          authoring: {
            tokens: { input: 1, output, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
            wallSeconds: wall,
          },
          semanticActions: { byDisposition: { progress: 1, correction } },
          restartReseed: { restarts: 0, destructiveReseeds: 0 },
        },
      },
    },
  };
}

function inputsFor(config, recordFor = () => scorecardRecord()) {
  return config.cells.map((cell) => {
    const record = recordFor(cell);
    record.harness = { model: cell.model };
    record.socialMessenger.capFamily = cell.meteringPolicy.capFamily;
    record.socialMessenger.runScope = cell.runScope;
    record.socialMessenger.meteringProvenance = {
      laneRunId: `${config.runId}/${cell.id}`,
      driver: { id: cell.driverId },
      observations: [],
      sessions: [],
    };
    for (const milestone of Object.values(record.socialMessenger.milestones)) {
      milestone.semanticActions.byClass ??= { "source-inspection": 0 };
    }
    const recordBytes = Buffer.from(JSON.stringify(record));
    return {
      cellId: cell.id,
      record,
      recordBytes,
      artifactRoot: ROOT_PATH,
      path: `/virtual/${cell.id}/record.json`,
    };
  });
}

test("scorecard composer refuses ratio rows below the three-success side floor", () => {
  const config = scorecardConfig(2);
  const result = composeScorecard({
    config,
    inputs: inputsFor(config),
    repositoryRoot: ROOT_PATH,
    validateRecord: () => [],
  });
  const rows = result.ratioRows.filter((row) => (
    row.contrastId === "explicit-minus-familiar:A:Clique"
  ));
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.status === "insufficient successful replicates"));
  assert.ok(rows.every((row) => (
    row.sides.first.successful === 2 && row.sides.second.successful === 2
  )));
});

test("scorecard composer excludes a failed replicate from ratios and counts its failure rate", () => {
  const config = scorecardConfig(4);
  const result = composeScorecard({
    config,
    inputs: inputsFor(config, (cell) => scorecardRecord({
      successful: !(cell.profile === "explicit" && cell.replicate === 4),
      output: cell.profile === "explicit" ? 20 : 10,
      correction: cell.profile === "explicit" ? 4 : 2,
      wall: cell.profile === "explicit" ? 120 : 90,
    })),
    repositoryRoot: ROOT_PATH,
    validateRecord: () => [],
  });
  const output = result.ratioRows.find((row) => (
    row.rowId === "output-tokens"
    && row.contrastId === "explicit-minus-familiar:A:Clique"
  ));
  assert.equal(output.status, "computed");
  assert.equal(output.n, 3);
  assert.deepEqual(output.constituents.map((item) => item.replicate), [1, 2, 3]);
  assert.deepEqual(result.failureRates["A:Clique:explicit"], {
    attempts: 4,
    successful: 3,
    failed: 1,
    failureRate: 0.25,
  });
});

test("scorecard composer refuses the whole composition when one record fails validation", () => {
  const config = scorecardConfig(1);
  const input = {
    cellId: config.cells[0].id,
    record: {},
    recordBytes: Buffer.from("{}"),
    artifactRoot: ROOT_PATH,
    path: "/virtual/invalid-record.json",
  };
  assert.throws(() => composeScorecard({
    config,
    inputs: [input],
    repositoryRoot: ROOT_PATH,
  }), /R3_SCORECARD_INPUT_INVALID: .* failed validation/u);
});

test("scorecard composer refuses a missing success floor before computing", () => {
  const config = scorecardConfig(3);
  delete config.scoring.successFloor.minimumSuccessfulReplicatesPerSide;
  assert.throws(() => composeScorecard({
    config,
    inputs: [],
    repositoryRoot: ROOT_PATH,
    validateRecord: () => [],
  }), /R3_SCORECARD_CONFIG_INVALID: success floor/u);
});

test("scorecard composer refuses one successful record replayed under three IDs", () => {
  const config = scorecardConfig(2);
  const source = inputsFor(config)[0];
  const replayed = config.cells.slice(0, 3).map((cell, index) => ({
    ...source,
    cellId: cell.id,
    path: `/virtual/replay-${index}.json`,
  }));
  assert.throws(() => composeScorecard({
    config,
    inputs: replayed,
    repositoryRoot: ROOT_PATH,
    validateRecord: () => [],
  }), /R3_SCORECARD_INPUT_IDENTITY: one record is supplied under both/u);
});

test("absolute-only ratio nulls both medians for the reproduced null-zero-zero denominators", () => {
  const config = scorecardConfig(3);
  const denominators = [null, 0, 0];
  const result = composeScorecard({
    config,
    inputs: inputsFor(config, (cell) => scorecardRecord({
      output: cell.profile === "explicit" ? denominators[cell.replicate - 1] : 1,
    })),
    repositoryRoot: ROOT_PATH,
    validateRecord: () => [],
  });
  const row = result.ratioRows.find((candidate) => (
    candidate.rowId === "output-tokens"
    && candidate.contrastId === "explicit-minus-familiar:A:Clique"
  ));
  assert.deepEqual(row.constituents.map((item) => item.first), [null, 0, 0]);
  assert.equal(row.status, "absolute-only");
  assert.equal(row.medianPairedRatio, null);
  assert.equal(row.medianPairedPercent, null);
});

test("scorecard composes every registered row class from retained fixture streams", () => {
  const config = scorecardConfig(1);
  const inputs = inputsFor(config, (cell) => scorecardRecord({
    output: cell.profile === "explicit" ? 20 : 10,
    correction: cell.profile === "explicit" ? 4 : 2,
    wall: cell.profile === "explicit" ? 120 : 90,
  }));
  for (const input of inputs) {
    const choreographyBytes = Buffer.from([
      { type: "assertion-wait", owner: "choreography", milestone: "M1", assertion: "live", attempt: 1, pass: false },
      { type: "assertion-wait", owner: "choreography", milestone: "M1", assertion: "live", attempt: 2, pass: true },
      { type: "assertion-wait", owner: "choreography", milestone: "M1", assertion: "unaffected", attempt: 1, pass: true },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n");
    const nativeBytes = Buffer.from(`${JSON.stringify({
      event: "migration-advisory",
      migrationAdvisories: [{ repairClass: "add-index", affectedTableCount: 2 }],
    })}\n`);
    input.record.socialMessenger.meteringProvenance.observations = [{
      sourceId: `${input.cellId}-choreography`,
      path: "choreography.jsonl",
      sha256: `sha256:${createHash("sha256").update(choreographyBytes).digest("hex")}`,
    }];
    input.record.socialMessenger.meteringProvenance.sessions = [{
      sourceId: `${input.cellId}-native`,
      path: "native.jsonl",
      sha256: `sha256:${createHash("sha256").update(nativeBytes).digest("hex")}`,
    }];
    input.evidenceStreams = {
      [`${input.cellId}-choreography`]: choreographyBytes,
      [`${input.cellId}-native`]: nativeBytes,
    };
    input.recordBytes = Buffer.from(JSON.stringify(input.record));
  }
  const result = composeScorecard({
    config,
    inputs,
    repositoryRoot: ROOT_PATH,
    validateRecord: () => [],
  });
  assert.equal(result.scorecardRows.length, 12);
  assert.equal(result.structuralRows.length, 5);
  assert.ok(result.structuralRows.every((row) => row.status === "pass"));
  assert.equal(result.boundedOrientationRow.status, "pass");
  assert.equal(result.choreographyRetryRow.maximum, 1);
  assert.ok(result.choreographyRetryRow.constituents.every((item) => item.pass));
  assert.deepEqual(result.groupedMigrationAdvisoriesRow.constituents[0].classes, [{
    repairClass: "add-index",
    affectedTableCount: 2,
    occurrences: 1,
    observedAffectedTableCounts: [2],
    pass: true,
  }]);
  assert.deepEqual(result.excludedRows, [{
    rowId: "debug-artifact-attribution",
    status: "excluded-with-rationale",
    rationale: "published npm wave has no debug binary",
  }]);
});

test("paired ratio rows disclose direction consistency and exact sign test", () => {
  const config = scorecardConfig(3);
  const first = [10, 20, 30];
  const second = [5, 10, 15];
  const result = composeScorecard({
    config,
    inputs: inputsFor(config, (cell) => scorecardRecord({
      output: cell.profile === "explicit" ? first[cell.replicate - 1] : second[cell.replicate - 1],
    })),
    repositoryRoot: ROOT_PATH,
    validateRecord: () => [],
  });
  const row = result.ratioRows.find((candidate) => (
    candidate.rowId === "output-tokens"
    && candidate.contrastId === "explicit-minus-familiar:A:Clique"
  ));
  assert.deepEqual(row.directionConsistency, { consistent: true, direction: "positive", nonTied: 3 });
  assert.deepEqual(row.pairedSignTest, {
    positive: 3, negative: 0, ties: 0, n: 3, exactTwoSidedPValue: 0.25,
  });
});

test("prompt diagnostic fixture itself uses a real mismatching SHA-256", () => {
  const bytes = Buffer.from("frozen prompt\n");
  assert.notEqual(createHash("sha256").update(bytes).digest("hex"), "0".repeat(64));
});

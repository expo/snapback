import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CHOREOGRAPHY_RETRY_AGGREGATION,
  MIGRATION_ADVISORY_AGGREGATION,
  MIGRATION_ADVISORY_RECORD_SELECTOR,
  SCORECARD_INSTRUMENT_DISPOSITIONS,
  assertExecutionSafetyRegistration,
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
const TEMP_PATH = realpathSync(tmpdir());
const TEMP_ROOTS = [];

after(() => {
  for (const root of TEMP_ROOTS) rmSync(root, { recursive: true, force: true });
});

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

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
        ...SCORECARD_INSTRUMENT_DISPOSITIONS[id],
        source: "retained-native-streams",
        recordSelector: MIGRATION_ADVISORY_RECORD_SELECTOR,
        aggregation: MIGRATION_ADVISORY_AGGREGATION,
      };
      if (id === "bounded-orientation-packet") return {
        id,
        ...SCORECARD_INSTRUMENT_DISPOSITIONS[id],
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
      return {
        id,
        ...(SCORECARD_INSTRUMENT_DISPOSITIONS[id] ?? {}),
        aggregation: `frozen:${id}`,
      };
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
  const computedCoveredFact = structuredClone(scoring);
  computedCoveredFact.scorecardRows
    .find((row) => row.id === "covered-fact-source-inspections")
    .instrumentDisposition = "computed";
  assert.throws(
    () => assertScorecardRegistration(computedCoveredFact),
    exactDiagnostic("R3_PLAN_SCORECARD_SHAPE"),
  );
  const heuristicAdvisoryPath = structuredClone(scoring);
  heuristicAdvisoryPath.scorecardRows
    .find((row) => row.id === "grouped-migration-advisories")
    .recordSelector.advisoriesPath = "**.migrationAdvisories[]";
  assert.throws(
    () => assertScorecardRegistration(heuristicAdvisoryPath),
    exactDiagnostic("R3_PLAN_SCORECARD_SHAPE"),
  );
});

test("R3 plan freezes the per-milestone wall safety limit", () => {
  assert.doesNotThrow(() => assertExecutionSafetyRegistration({
    perMilestoneWallSafetyLimitSeconds: 14400,
  }));
  assert.throws(() => assertExecutionSafetyRegistration({
    perMilestoneWallSafetyLimitSeconds: 14399,
  }), exactDiagnostic("R3_PLAN_MILESTONE_WALL_SAFETY_DRIFT"));
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

function persistInput(input) {
  const recordBytes = Buffer.from(JSON.stringify(input.record));
  writeFileSync(input.path, recordBytes);
  input.recordBytes = recordBytes;
  return input;
}

function fixtureFinalizedSlotValidator({ slotPath, cellId }) {
  const recordPath = join(dirname(slotPath), "record.json");
  const recordBytes = readFileSync(recordPath);
  return {
    slot: {
      cellId,
      status: "recorded-finalized",
      record: { path: "record.json", sha256: sha256(recordBytes) },
    },
    record: JSON.parse(recordBytes.toString("utf8")),
    metering: {},
    evidencePaths: ["cell.json", "record.json"],
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
    const artifactRoot = mkdtempSync(join(TEMP_PATH, `r3-scorecard-${cell.id}-`));
    TEMP_ROOTS.push(artifactRoot);
    return persistInput({
      cellId: cell.id,
      record,
      artifactRoot,
      path: join(artifactRoot, "record.json"),
    });
  });
}

test("scorecard composer refuses ratio rows below the three-success side floor", async () => {
  const config = scorecardConfig(2);
  const result = await composeScorecard({
    config,
    inputs: inputsFor(config),
    repositoryRoot: ROOT_PATH,
    validateFinalizedSlot: fixtureFinalizedSlotValidator,
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

test("scorecard composer excludes a failed replicate from ratios and counts its failure rate", async () => {
  const config = scorecardConfig(4);
  const result = await composeScorecard({
    config,
    inputs: inputsFor(config, (cell) => scorecardRecord({
      successful: !(cell.profile === "explicit" && cell.replicate === 4),
      output: cell.profile === "explicit" ? 20 : 10,
      correction: cell.profile === "explicit" ? 4 : 2,
      wall: cell.profile === "explicit" ? 120 : 90,
    })),
    repositoryRoot: ROOT_PATH,
    validateFinalizedSlot: fixtureFinalizedSlotValidator,
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

test("scorecard composer refuses the whole composition when one record fails validation", async () => {
  const config = scorecardConfig(1);
  const artifactRoot = mkdtempSync(join(TEMP_PATH, "r3-scorecard-invalid-"));
  TEMP_ROOTS.push(artifactRoot);
  const input = persistInput({
    cellId: config.cells[0].id,
    record: {},
    artifactRoot,
    path: join(artifactRoot, "record.json"),
  });
  await assert.rejects(composeScorecard({
    config,
    inputs: [input],
    repositoryRoot: ROOT_PATH,
    validateFinalizedSlot: () => {
      throw new Error("schema replay failed");
    },
  }), /R3_SCORECARD_INPUT_INVALID: .* failed finalized-slot validation/u);
});

test("scorecard composer refuses a recovered-finalized input", async () => {
  const config = scorecardConfig(1);
  await assert.rejects(composeScorecard({
    config,
    inputs: inputsFor(config),
    repositoryRoot: ROOT_PATH,
    validateFinalizedSlot: (input) => {
      const finalized = fixtureFinalizedSlotValidator(input);
      finalized.slot.status = "recovered-finalized";
      return finalized;
    },
  }), exactDiagnostic("R3_SCORECARD_RECOVERED_FINALIZED_REFUSED"));
});

test("scorecard composer refuses a missing success floor before computing", async () => {
  const config = scorecardConfig(3);
  delete config.scoring.successFloor.minimumSuccessfulReplicatesPerSide;
  await assert.rejects(composeScorecard({
    config,
    inputs: [],
    repositoryRoot: ROOT_PATH,
  }), /R3_SCORECARD_CONFIG_INVALID: success floor/u);
});

test("scorecard composer refuses an identity-rewritten and rehashed replay under three IDs", async () => {
  const config = scorecardConfig(2);
  const source = inputsFor(config)[0];
  const originalCellId = "forged-original-cell";
  const replayed = config.cells.slice(0, 3).map((cell) => {
    const record = structuredClone(source.record);
    record.harness.model = cell.model;
    record.socialMessenger.capFamily = cell.meteringPolicy.capFamily;
    record.socialMessenger.runScope = cell.runScope;
    record.socialMessenger.meteringProvenance.laneRunId = `${config.runId}/${cell.id}`;
    record.socialMessenger.meteringProvenance.driver.id = cell.driverId;
    const artifactRoot = mkdtempSync(join(TEMP_PATH, `r3-scorecard-replay-${cell.id}-`));
    TEMP_ROOTS.push(artifactRoot);
    writeFileSync(join(artifactRoot, "cell.json"), `${JSON.stringify({
      schemaVersion: "snapback.r2-cell-slot.v1",
      cellId: originalCellId,
      status: "recorded-finalized",
      attemptCount: 1,
      campaignCellRerun: false,
    })}\n`);
    return persistInput({
      cellId: cell.id,
      record,
      artifactRoot,
      path: join(artifactRoot, "record.json"),
    });
  });
  let received;
  await assert.rejects(composeScorecard({
    config,
    inputs: replayed,
    repositoryRoot: ROOT_PATH,
  }), (error) => {
    received = error.message;
    return /R3_SCORECARD_INPUT_INVALID: .* failed finalized-slot validation: .* is not an exact finalized single-attempt cell slot/u
      .test(error.message);
  });
  assert.doesNotMatch(received, /app|profile|replicate/u);
});

test("scorecard composer refuses a symlinked forged record even when bytes are supplied", async () => {
  const config = scorecardConfig(1);
  const target = inputsFor(config)[0];
  const cloneRoot = mkdtempSync(join(TEMP_PATH, "r3-scorecard-symlink-"));
  TEMP_ROOTS.push(cloneRoot);
  const symlinkPath = join(cloneRoot, "record.json");
  symlinkSync(target.path, symlinkPath);
  let validatorCalled = false;
  await assert.rejects(composeScorecard({
    config,
    inputs: [{ ...target, path: symlinkPath }],
    repositoryRoot: ROOT_PATH,
    validateFinalizedSlot: () => {
      validatorCalled = true;
      return fixtureFinalizedSlotValidator({
        slotPath: join(cloneRoot, "cell.json"),
        cellId: target.cellId,
      });
    },
  }), /R3_SCORECARD_INPUT_IDENTITY: .* record path is not canonical/u);
  assert.equal(validatorCalled, false);
});

test("absolute-only ratio nulls both medians for the reproduced null-zero-zero denominators", async () => {
  const config = scorecardConfig(3);
  const denominators = [null, 0, 0];
  const result = await composeScorecard({
    config,
    inputs: inputsFor(config, (cell) => scorecardRecord({
      output: cell.profile === "explicit" ? denominators[cell.replicate - 1] : 1,
    })),
    repositoryRoot: ROOT_PATH,
    validateFinalizedSlot: fixtureFinalizedSlotValidator,
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

test("scorecard composes every registered row class from retained fixture streams", async () => {
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
    })}\n${JSON.stringify({
      event: "tool-result",
      payload: {
        repairClass: "add-index",
        affectedTableCount: 999,
        migrationAdvisories: [{ repairClass: "nested-payload", affectedTableCount: 999 }],
      },
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
    persistInput(input);
  }
  const result = await composeScorecard({
    config,
    inputs,
    repositoryRoot: ROOT_PATH,
    validateFinalizedSlot: fixtureFinalizedSlotValidator,
  });
  assert.equal(result.scorecardRows.length, 12);
  assert.equal(result.structuralRows.length, 5);
  assert.ok(result.structuralRows.every((row) => row.status === "instrument-incomplete"));
  assert.ok(result.structuralRows.every((row) => row.constituents.length === 0));
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

test("empty correction loops and raw source inspections cannot manufacture structural zeros or failures", async () => {
  const config = scorecardConfig(1);
  const inputs = inputsFor(config);
  for (const input of inputs) {
    input.record.correctionLoops = [];
    input.record.socialMessenger.milestones.M1.semanticActions.byClass["source-inspection"] = 7;
    persistInput(input);
  }
  const result = await composeScorecard({
    config,
    inputs,
    repositoryRoot: ROOT_PATH,
    validateFinalizedSlot: fixtureFinalizedSlotValidator,
  });
  const coveredFact = result.structuralRows.find((row) => (
    row.rowId === "covered-fact-source-inspections"
  ));
  assert.equal(coveredFact.status, "instrument-incomplete");
  assert.deepEqual(coveredFact.constituents, []);
  assert.ok(result.structuralRows.every((row) => row.status === "instrument-incomplete"));
});

test("bounded orientation computes from its registered typed signal", async () => {
  const config = scorecardConfig(1);
  const inputs = inputsFor(config);
  inputs[0].record.socialMessenger.firstProductEdit.orientationBytes = 16384;
  inputs[1].record.socialMessenger.firstProductEdit.orientationBytes = 16385;
  inputs.forEach(persistInput);
  const result = await composeScorecard({
    config,
    inputs,
    repositoryRoot: ROOT_PATH,
    validateFinalizedSlot: fixtureFinalizedSlotValidator,
  });
  assert.equal(result.boundedOrientationRow.status, "fail");
  assert.deepEqual(result.boundedOrientationRow.constituents.map((item) => ({
    value: item.value,
    pass: item.pass,
  })), [
    { value: 16384, pass: true },
    { value: 16385, pass: false },
  ]);
});

async function composeWithStreams({ choreographyEvents = [], nativeEvents = [] }) {
  const config = scorecardConfig(1);
  const inputs = inputsFor(config);
  for (const input of inputs) {
    const choreographyBytes = Buffer.from(`${choreographyEvents.map(JSON.stringify).join("\n")}\n`);
    const nativeBytes = Buffer.from(`${nativeEvents.map(JSON.stringify).join("\n")}\n`);
    input.record.socialMessenger.meteringProvenance.observations = [{
      sourceId: `${input.cellId}-choreography`,
      path: "choreography.jsonl",
      sha256: sha256(choreographyBytes),
    }];
    input.record.socialMessenger.meteringProvenance.sessions = [{
      sourceId: `${input.cellId}-native`,
      path: "native.jsonl",
      sha256: sha256(nativeBytes),
    }];
    input.evidenceStreams = {
      [`${input.cellId}-choreography`]: choreographyBytes,
      [`${input.cellId}-native`]: nativeBytes,
    };
    persistInput(input);
  }
  return composeScorecard({
    config,
    inputs,
    repositoryRoot: ROOT_PATH,
    validateFinalizedSlot: fixtureFinalizedSlotValidator,
  });
}

test("passing assertion attempts one and two count as an unaffected retry and fail", async () => {
  const result = await composeWithStreams({
    choreographyEvents: [
      { type: "assertion-wait", owner: "choreography", milestone: "M1", assertion: "unaffected", attempt: 1, pass: true },
      { type: "assertion-wait", owner: "choreography", milestone: "M1", assertion: "unaffected", attempt: 2, pass: true },
    ],
  });
  assert.equal(result.choreographyRetryRow.status, "fail");
  assert.ok(result.choreographyRetryRow.constituents.every((item) => (
    item.assertions[0].failed === false
    && item.assertions[0].retries === 1
    && item.assertions[0].pass === false
  )));
});

test("more than one retry after a failed assertion fails the retry ceiling", async () => {
  const result = await composeWithStreams({
    choreographyEvents: [
      { type: "assertion-wait", owner: "choreography", milestone: "M1", assertion: "live", attempt: 1, pass: false },
      { type: "assertion-wait", owner: "choreography", milestone: "M1", assertion: "live", attempt: 2, pass: true },
      { type: "assertion-wait", owner: "choreography", milestone: "M1", assertion: "live", attempt: 3, pass: true },
    ],
  });
  assert.equal(result.choreographyRetryRow.status, "fail");
  assert.ok(result.choreographyRetryRow.constituents.every((item) => (
    item.assertions[0].retries === 2 && item.assertions[0].pass === false
  )));
});

test("retry attempt ordinals with a gap refuse composition", async () => {
  await assert.rejects(composeWithStreams({
    choreographyEvents: [
      { type: "assertion-wait", owner: "choreography", milestone: "M1", assertion: "live", attempt: 1, pass: false },
      { type: "assertion-wait", owner: "choreography", milestone: "M1", assertion: "live", attempt: 3, pass: true },
    ],
  }), exactDiagnostic("R3_SCORECARD_RETRY_ORDINAL_INVALID"));
});

test("duplicate retry attempt ordinals refuse composition", async () => {
  await assert.rejects(composeWithStreams({
    choreographyEvents: [
      { type: "assertion-wait", owner: "choreography", milestone: "M1", assertion: "live", attempt: 1, pass: false },
      { type: "assertion-wait", owner: "choreography", milestone: "M1", assertion: "live", attempt: 1, pass: false },
    ],
  }), exactDiagnostic("R3_SCORECARD_RETRY_ORDINAL_INVALID"));
});

test("duplicate migration repair classes fail and nested tool payloads do not become advisories", async () => {
  const result = await composeWithStreams({
    nativeEvents: [
      {
        event: "migration-advisory",
        migrationAdvisories: [
          { repairClass: "add-index", affectedTableCount: 2 },
          { repairClass: "ADD-INDEX", affectedTableCount: 3 },
        ],
      },
      {
        event: "tool-result",
        payload: {
          repairClass: "nested-only",
          affectedTableCount: 88,
          migrationAdvisories: [{ repairClass: "nested-only", affectedTableCount: 88 }],
        },
      },
    ],
  });
  assert.equal(result.groupedMigrationAdvisoriesRow.status, "fail");
  assert.ok(result.groupedMigrationAdvisoriesRow.constituents.every((item) => (
    item.classes.length === 1
    && item.classes[0].repairClass === "add-index"
    && item.classes[0].occurrences === 2
    && item.classes[0].pass === false
  )));
});

test("native sessions without a typed migration-advisory carrier are instrument-incomplete", async () => {
  const result = await composeWithStreams({
    nativeEvents: [{
      event: "tool-result",
      payload: { migrationAdvisories: [], repairClass: "nested-only", affectedTableCount: 1 },
    }],
  });
  assert.equal(result.groupedMigrationAdvisoriesRow.status, "instrument-incomplete");
  assert.ok(result.groupedMigrationAdvisoriesRow.constituents.every((item) => (
    item.carrierPresent === false && item.value === null && item.pass === false
  )));
});

test("an explicit empty migration-advisory carrier computes a zero-count pass", async () => {
  const result = await composeWithStreams({
    nativeEvents: [{ event: "migration-advisory", migrationAdvisories: [] }],
  });
  assert.equal(result.groupedMigrationAdvisoriesRow.status, "pass");
  assert.ok(result.groupedMigrationAdvisoriesRow.constituents.every((item) => (
    item.carrierPresent === true && item.value === 0 && item.pass === true
  )));
});

test("paired ratio rows disclose direction consistency and exact sign test", async () => {
  const config = scorecardConfig(3);
  const first = [10, 20, 30];
  const second = [5, 10, 15];
  const result = await composeScorecard({
    config,
    inputs: inputsFor(config, (cell) => scorecardRecord({
      output: cell.profile === "explicit" ? first[cell.replicate - 1] : second[cell.replicate - 1],
    })),
    repositoryRoot: ROOT_PATH,
    validateFinalizedSlot: fixtureFinalizedSlotValidator,
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

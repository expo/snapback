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
      if (id === "debug-artifact-attribution") return {
        id,
        excluded: true,
        rationale: "published npm wave has no debug binary",
      };
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
    socialMessenger: {
      efficiencyScorecardEligibility: { eligible: true },
      milestones: {
        M1: {
          status: successful ? "green" : "capability-failure",
          authoring: {
            tokens: { input: 1, output, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
            wallSeconds: wall,
          },
          semanticActions: { byDisposition: { progress: 1, correction } },
        },
      },
    },
  };
}

function inputsFor(config, recordFor = () => scorecardRecord()) {
  return config.cells.map((cell) => ({
    cellId: cell.id,
    record: recordFor(cell),
    artifactRoot: ROOT_PATH,
  }));
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
    artifactRoot: ROOT_PATH,
  };
  assert.throws(() => composeScorecard({
    config,
    inputs: [input],
    repositoryRoot: ROOT_PATH,
  }), /R3_SCORECARD_INPUT_INVALID: .* failed validation/u);
});

test("prompt diagnostic fixture itself uses a real mismatching SHA-256", () => {
  const bytes = Buffer.from("frozen prompt\n");
  assert.notEqual(createHash("sha256").update(bytes).digest("hex"), "0".repeat(64));
});

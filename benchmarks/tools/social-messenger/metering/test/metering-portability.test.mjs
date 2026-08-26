import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { joinUsageToMilestones } from "../joiner.mjs";
import { bindFullJourneyAccounting } from "../manifest.mjs";
import { recoverCodexSignalSettlements } from "../codex-native-evidence.mjs";
import { composeRunRecord, runNonConsumingSmoke } from "../lane-controller.mjs";
import {
  R2_PROVISIONING_CONTENT_VERSION,
  R2_PROVISIONING_MANIFEST_VERSION,
  allCampaignPorts,
  currentHostIdentity,
  inspectNonConsumingAdmissionSmoke,
  measureProvisionedSourceTree,
  probeLaunchQuiet,
  resolveSourceIdentity,
} from "../r2-cell-admission.mjs";
import { finalizeExisting } from "../r2-finalize-existing.mjs";
import {
  r2CellDriverTestHooks,
  resolveCellJourney,
} from "../r2-cell-driver.mjs";
import {
  CURRENT_INSTRUMENT_PIN,
  CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION,
} from "../observations.mjs";
import { validateSocialMessengerRunRecord } from "../../record-validator.mjs";

const ROOT = new URL("../../../../../", import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);

function tokenCounts(input, output) {
  return { input, output, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}

function nullCounts() {
  return { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null };
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function gitObjectDigest(type, bytes, algorithm = "sha1") {
  return createHash(algorithm)
    .update(Buffer.from(`${type} ${bytes.byteLength}\0`))
    .update(bytes)
    .digest("hex");
}

function fullJourneyConfig() {
  return {
    milestones: ["M1", "M2", "M3", "M4", "M5", "M6", "M8", "M7"],
    cell: { m7Ports: [48_600, 48_659] },
    harnessConfig: {
      execution: {
        sessionShape: {
          continuous: ["M1", "M2", "M3", "M4", "M5", "M6", "M8"],
          fresh: ["M7"],
          m7FreshSessionRequired: true,
          m7BackendState: "fresh-starter-only-pre-replay",
        },
      },
    },
  };
}

test("full journey composes continuous D0.6 blocks and a separately clocked fresh M7", () => {
  const journey = resolveCellJourney(fullJourneyConfig());
  assert.equal(journey.runScope, "full");
  assert.deepEqual(journey.continuous, ["M1", "M2", "M3", "M4", "M5", "M6", "M8"]);
  assert.deepEqual(journey.fresh, ["M7"]);

  const executionOrder = ["M1", "M2", "M3", "M4", "M5", "M6", "M8", "M7"];
  const origin = Date.parse("2026-08-25T12:00:00.000Z");
  const boundaries = Object.fromEntries(executionOrder.map((milestone, index) => {
    const terminalAt = new Date(origin + ((index + 1) * 1_000)).toISOString();
    return [milestone, {
      status: "green",
      firstGreenAt: terminalAt,
      suitePassAt: terminalAt,
      choreoPassAt: terminalAt,
      terminalAt,
      terminalSequence: index + 1,
      terminalReason: "green",
    }];
  }));
  boundaries.M7.firstGreenAt = "2026-08-25T12:00:35.000Z";
  boundaries.M7.suitePassAt = boundaries.M7.firstGreenAt;
  boundaries.M7.choreoPassAt = boundaries.M7.firstGreenAt;
  boundaries.M7.terminalAt = boundaries.M7.firstGreenAt;
  const turns = executionOrder.map((milestone, index) => ({
    id: `${milestone}-native-turn`,
    sourceId: milestone === "M7" ? "fresh-m7" : "builder",
    completedAt: boundaries[milestone].terminalAt,
    usage: tokenCounts(10, 1),
  }));
  const patch = joinUsageToMilestones({
    channel: {
      source: "codex-rollout-token-count",
      turns,
      unavailableReason: null,
    },
    boundaries,
    firstProductEdit: null,
    wallClockOrigin: new Date(origin).toISOString(),
    milestoneWallStarts: { M7: "2026-08-25T12:00:30.000Z" },
    provenance: {
      laneRunId: "full-journey-fixture",
      driver: {
        id: "social-messenger-full-journey-native-cli-driver.v1",
        startedAt: new Date(origin).toISOString(),
        stampedAt: boundaries.M7.terminalAt,
      },
    },
  });
  const base = {
    socialMessenger: {
      runScope: "full",
      milestones: Object.fromEntries(executionOrder.map((milestone) => [milestone, {
        caps: { wallCapSeconds: 3_600, tokenCap: 100_000 },
      }])),
      clocks: {
        grading: { sessions: [{ wallSeconds: 0, tokens: nullCounts() }] },
        replay: { attempted: true, wallSeconds: 20, capSeconds: 60, capFractionUsed: 1 / 3, capExhausted: false, probeWallSecondsExcluded: 0 },
        m7Session: { wallSeconds: null, tokens: nullCounts() },
      },
    },
  };
  const record = composeRunRecord({ base, patch, expectedMilestones: executionOrder });
  for (const milestone of executionOrder) {
    assert.deepEqual(record.socialMessenger.milestones[milestone].authoring.tokens, tokenCounts(10, 1));
  }
  assert.equal(record.socialMessenger.milestones.M8.authoring.wallSeconds, 1);
  assert.equal(record.socialMessenger.milestones.M7.authoring.wallSeconds, 5);
  assert.deepEqual(record.socialMessenger.clocks.m7Session, {
    wallSeconds: 5,
    tokens: tokenCounts(10, 1),
  });
  assert.equal(record.socialMessenger.runScope, "full");
});

test("fresh M7 prompt and process state carry handoff-only context", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "r2-fresh-m7-")));
  try {
    await writeFile(join(root, "m7-handoff.md"), "Sealed M7 instructions only.\n");
    const originalSessionId = "continuous-session-id";
    const state = {
      root,
      config: {
        repositoryRoot: ROOT_PATH,
        cell: { harness: "codex-sol", m7Ports: [48_600, 48_659] },
      },
      exit: Promise.resolve({ code: 0, signal: null }),
      closed: Promise.resolve({ code: 0, signal: null }),
      streamWriteQueue: Promise.resolve(),
      currentSession: { nativeSessionId: originalSessionId },
      nativeSessionId: originalSessionId,
      child: { stale: true },
      m7Handoff: null,
      m7HandoffSource: null,
    };
    await r2CellDriverTestHooks.beginFreshM7Session(state);
    assert.equal(state.currentSession.sourceId, "fresh-m7");
    assert.equal(state.currentSession.role, "builder-descendant");
    assert.equal(state.currentSession.parentSourceId, "builder");
    assert.notEqual(state.currentSession.nativeSessionId, originalSessionId);
    assert.equal(state.child, null);
    assert.match(state.currentSession.renderedPrompt, /Sealed M7 instructions only/u);
    assert.doesNotMatch(state.currentSession.renderedPrompt, /continuous-session-id/u);
    assert.equal(state.m7Handoff.contextPolicy, "fresh-native-session-handoff-only.v1");
    assert.equal(state.m7Handoff.backendState, "fresh-starter-only-pre-replay");
    assert.equal((await readFile(join(root, "rendered-m7-prompt.md"), "utf8")), state.currentSession.renderedPrompt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("full-journey manifest binding excludes replay turns before fresh M7 accounting", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "r2-full-accounting-")));
  try {
    const attempts = [{
      attempt: 1,
      continuationOf: null,
      disposition: "completed",
      startedAt: "2026-08-25T12:00:05.000Z",
      finishedAt: "2026-08-25T12:00:15.000Z",
      settledPrefix: 100,
    }];
    const scaleValue = {
      version: "snapback.full-journey-scale-replay.v1",
      attempted: true,
      wallSeconds: 9,
      capSeconds: 60,
      capFractionUsed: 0.15,
      capExhausted: false,
      probeWallSecondsExcluded: 1,
      attempts,
    };
    const scaleBytes = Buffer.from(`${JSON.stringify(scaleValue)}\n`);
    const handoffBytes = Buffer.from("fresh handoff\n");
    const promptBytes = Buffer.from("fresh prompt\n");
    await writeFile(join(root, "scale-replay.json"), scaleBytes);
    await writeFile(join(root, "m7-handoff.md"), handoffBytes);
    await writeFile(join(root, "rendered-m7-prompt.md"), promptBytes);
    const manifest = {
      driver: { id: "social-messenger-full-journey-native-cli-driver.v1" },
      freshSessionHandoff: {
        contextPolicy: "fresh-native-session-handoff-only.v1",
        backendState: "fresh-starter-only-pre-replay",
        source: { path: "m7-handoff.md", sha256: digest(handoffBytes) },
        renderedPrompt: { path: "rendered-m7-prompt.md", sha256: digest(promptBytes) },
      },
      scaleReplay: {
        path: "scale-replay.json",
        sha256: digest(scaleBytes),
        clock: {
          attempted: true,
          wallSeconds: 9,
          capSeconds: 60,
          capFractionUsed: 0.15,
          capExhausted: false,
          probeWallSecondsExcluded: 1,
        },
        attempts,
      },
    };
    const result = await bindFullJourneyAccounting({
      manifest,
      manifestDirectory: root,
      boundaryValue: {
        milestones: {
          M8: { status: "green", terminalAt: "2026-08-25T12:00:02.000Z" },
          M7: { status: "green", terminalAt: "2026-08-25T12:00:25.000Z" },
        },
      },
      driverCompatibility: {
        usageSettlements: [{
          milestone: "M8",
          usageAvailable: true,
          usageSettledAt: "2026-08-25T12:00:04.000Z",
        }],
      },
      loadedSessions: [
        { sourceId: "builder", startedAt: "2026-08-25T12:00:00.000Z" },
        { sourceId: "fresh-m7", startedAt: "2026-08-25T12:00:20.000Z" },
      ],
      channel: {
        turns: [
          { id: "m8", sourceId: "builder", completedAt: "2026-08-25T12:00:04.000Z", usage: tokenCounts(10, 1) },
          { id: "scale", sourceId: "builder", completedAt: "2026-08-25T12:00:10.000Z", usage: tokenCounts(20, 2) },
          { id: "m7", sourceId: "fresh-m7", completedAt: "2026-08-25T12:00:25.000Z", usage: tokenCounts(30, 3) },
        ],
      },
    });
    assert.deepEqual(result.channel.turns.map((turn) => turn.id), ["m8", "m7"]);
    assert.deepEqual(result.milestoneWallStarts, { M7: "2026-08-25T12:00:20.000Z" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M8 closes at its first post-signal usage settlement while replay usage trails", () => {
  const records = [{
    ordinal: 0,
    timestamp: "2026-08-25T12:00:02.000Z",
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: {
        id: "m8-signal",
        type: "CommandExecution",
        status: "completed",
        exit_code: 0,
        command: ["node", "/fixture/r2-cell-signal.mjs", "--milestone", "M8"],
      },
    },
  }, {
    ordinal: 1,
    timestamp: "2026-08-25T12:00:04.000Z",
    type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: {} } },
  }, {
    ordinal: 2,
    timestamp: "2026-08-25T12:00:10.000Z",
    type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: {} } },
  }, {
    ordinal: 3,
    timestamp: "2026-08-25T12:00:16.000Z",
    type: "event_msg",
    payload: { type: "task_complete" },
  }];
  const recovered = recoverCodexSignalSettlements({
    records,
    boundaryValue: {
      M8: {
        status: "green",
        terminalAt: "2026-08-25T12:00:02.000Z",
        terminalSequence: 1,
      },
    },
    closingSettlementSelection: "first",
    allowTrailingUsage: true,
  });
  assert.equal(recovered.usageSettlements[0].usageRecordOrdinal, 1);
  assert.equal(recovered.usageSettlements[0].settlementKind, "closing-signal-first-token-count");
});

test("retained M1-M3 mode keeps its driver identity and finalized R2 record schema validity", async () => {
  assert.deepEqual(resolveCellJourney({ milestones: ["M1", "M2", "M3"] }), {
    runScope: "reduced",
    driverId: "social-messenger-r2-native-cli-driver.v1",
    continuous: ["M1", "M2", "M3"],
    fresh: [],
  });
  const cellRoot = fileURLToPath(new URL(
    "benchmarks/runs/2026-08-23-r2-published-0125/cells/sol-clique-explicit/",
    ROOT,
  ));
  const record = JSON.parse(await readFile(join(cellRoot, "record.json"), "utf8"));
  const schemas = await Promise.all([
    "benchmarks/schema/run-record.schema.json",
    "benchmarks/schema/social-messenger/run-record-extension.schema.json",
    "benchmarks/schema/social-messenger/run-record.schema.json",
  ].map(async (path) => JSON.parse(await readFile(new URL(path, ROOT), "utf8"))));
  assert.deepEqual(validateSocialMessengerRunRecord(schemas[2], record, {
    schemas: schemas.slice(0, 2),
    artifactRoot: cellRoot,
  }), []);
});

test("host identity dispatch probes Linux without fabricating unavailable fields", () => {
  let sysctlCalls = 0;
  const linux = currentHostIdentity({
    platform: () => "linux",
    hostname: () => "linux-runner",
    release: () => "6.8.12-test",
    arch: () => "x64",
    cpus: () => [{}, {}, {}, {}],
    totalmem: () => 68_719_476_736,
    sysctlValue: () => { sysctlCalls += 1; throw new Error("must not run"); },
    readTextFile: () => [
      "processor : 0",
      "physical id : 0",
      "core id : 0",
      "model name : Portable CPU",
      "",
      "processor : 1",
      "physical id : 0",
      "core id : 1",
      "model name : Portable CPU",
      "",
    ].join("\n"),
  });
  assert.deepEqual(linux, {
    hostname: "linux-runner",
    platform: "linux",
    release: "6.8.12-test",
    arch: "x64",
    hardwareModel: null,
    chip: "Portable CPU",
    physicalCpuCount: 2,
    logicalCpuCount: 4,
    memoryBytes: 68_719_476_736,
  });
  assert.equal(sysctlCalls, 0);

  const keys = [];
  const darwin = currentHostIdentity({
    platform: () => "darwin",
    hostname: () => "mac-runner",
    release: () => "25.6.0",
    arch: () => "arm64",
    cpus: () => Array(10).fill({}),
    totalmem: () => 34_359_738_368,
    sysctlValue: (key) => {
      keys.push(key);
      return { "hw.model": "MacBookPro18,3", "machdep.cpu.brand_string": "Apple M1 Pro", "hw.physicalcpu": "10" }[key];
    },
  });
  assert.equal(darwin.hardwareModel, "MacBookPro18,3");
  assert.equal(darwin.chip, "Apple M1 Pro");
  assert.equal(darwin.physicalCpuCount, 10);
  assert.deepEqual(keys, ["hw.model", "machdep.cpu.brand_string", "hw.physicalcpu"]);
});

test("gitless provisioning binds exact tree bytes and is shared by finalization", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-provisioning-")));
  const repositoryRoot = join(temp, "source");
  const manifestPath = join(temp, "provisioning.json");
  const configPath = join(repositoryRoot, "harness-config.json");
  try {
    await mkdir(join(repositoryRoot, "nested"), { recursive: true });
    await mkdir(join(repositoryRoot, "vendor", "uninitialized-submodule"), { recursive: true });
    await writeFile(join(repositoryRoot, "nested", "bytes.txt"), "byte-bound source\n");
    await writeFile(configPath, "{}\n");
    const gitlinks = [{
      path: "vendor/uninitialized-submodule",
      oid: "c".repeat(40),
    }];
    const content = measureProvisionedSourceTree({ repositoryRoot, gitlinks });
    const commitBytes = Buffer.from([
      `tree ${content.gitTree.oid}`,
      "author Provisioner <provisioner@example.com> 1787688000 +0000",
      "committer Provisioner <provisioner@example.com> 1787688000 +0000",
      "",
      "gitless deployment fixture",
      "",
    ].join("\n"));
    const commit = gitObjectDigest("commit", commitBytes);
    await writeFile(manifestPath, `${JSON.stringify({
      version: R2_PROVISIONING_MANIFEST_VERSION,
      source: {
        objectFormat: "sha1",
        commit,
        tree: content.gitTree.oid,
        gitlinks,
        commitObject: { encoding: "base64", data: commitBytes.toString("base64") },
      },
      content,
    }, null, 2)}\n`);
    const source = resolveSourceIdentity({ repositoryRoot, provisioningManifestPath: manifestPath });
    assert.equal(source.binding.content.algorithm, R2_PROVISIONING_CONTENT_VERSION);
    assert.equal(source.gitRead(["rev-parse", "HEAD"], repositoryRoot), commit);
    assert.equal(
      source.gitRead(["show", "HEAD:nested/bytes.txt"], repositoryRoot).toString("utf8"),
      "byte-bound source\n",
    );

    const accepted = new Error("accepted-provisioning-reader-reached-finalizer");
    await assert.rejects(finalizeExisting({
      harnessConfigPath: configPath,
      cellId: "fixture-cell",
      provisioningManifestPath: manifestPath,
      dependencies: {
        repositoryRoot,
        assertCommittedConfig: ({ gitRead }) => {
          assert.equal(gitRead(["rev-parse", "HEAD"], repositoryRoot), commit);
          throw accepted;
        },
      },
    }), (error) => error === accepted);
    await assert.rejects(finalizeExisting({
      harnessConfigPath: configPath,
      cellId: "fixture-cell",
      dependencies: {
        repositoryRoot,
        gitRead: () => { throw new Error("git executable absent"); },
      },
    }), /R2_FINALIZE_PROVISIONING_REQUIRED.*--provisioning-manifest/u);

    await writeFile(join(repositoryRoot, "nested", "bytes.txt"), "mutated source\n");
    assert.throws(
      () => resolveSourceIdentity({ repositoryRoot, provisioningManifestPath: manifestPath }),
      /R2_ADMISSION_PROVISIONING_MISMATCH/u,
    );
    assert.throws(
      () => resolveSourceIdentity({
        repositoryRoot,
        gitRead: () => { throw new Error("git executable absent"); },
      }),
      /R2_ADMISSION_PROVISIONING_REQUIRED.*--provisioning-manifest/u,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("campaign quiet probe includes every M7 port block", async () => {
  const harnessConfig = {
    cells: [
      { id: "one", ports: [41_000, 41_001], m7Ports: [42_000, 42_001] },
      { id: "two", ports: [43_000, 43_000], m7Ports: [44_000, 44_001] },
    ],
  };
  const expected = [41_000, 41_001, 42_000, 42_001, 43_000, 44_000, 44_001];
  assert.deepEqual(allCampaignPorts(harnessConfig), expected);
  const probed = [];
  const result = await probeLaunchQuiet({
    harnessConfig,
    seriality: { committedPrefix: [] },
    processProbe: () => ({ recorded: { pids: [], isolatedProcessGroups: [] }, active: [] }),
    portProbe: async (port) => { probed.push(port); return true; },
    now: () => Date.parse("2026-08-25T12:00:00.000Z"),
  });
  assert.deepEqual(probed.sort((left, right) => left - right), expected);
  assert.deepEqual(result.ports.values, expected);
});

test("current-pin smoke starts the controller and composes without lock or attempt consumption", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-non-consuming-smoke-")));
  const repositoryRoot = join(temp, "source");
  const privateRoot = join(temp, "private");
  const configPath = join(temp, "harness-config.json");
  const instrumentPath = join(repositoryRoot, "instrument.json");
  try {
    await mkdir(repositoryRoot);
    await mkdir(privateRoot);
    await writeFile(instrumentPath, '{"instrumentPin":"social-messenger@0.3.4-m8"}\n');
    const host = {
      hostname: "smoke-host",
      platform: "linux",
      release: "6.8.12-smoke",
      arch: "x64",
      hardwareModel: null,
      chip: "Smoke CPU",
      physicalCpuCount: 4,
      logicalCpuCount: 8,
      memoryBytes: 34_359_738_368,
    };
    const harnessConfig = {
      schemaVersion: "snapback.r2-harness-config.v1",
      status: "serial-per-cell-admission",
      runId: "smoke-run",
      cellOrder: ["smoke-cell"],
      pins: {
        instrument: {
          instrumentPin: CURRENT_INSTRUMENT_PIN,
          manifestPath: "instrument.json",
          d06MeteringOverlay: {
            laneControllerSha256: "1".repeat(64),
            productionDriverSha256: "2".repeat(64),
          },
        },
      },
      paths: { privateExecutionRoot: privateRoot, committedRunRoot: join(temp, "committed") },
      execution: {
        serial: true,
        maxConcurrentCells: 1,
        milestones: ["M1", "M2", "M3"],
        loadIsolation: {
          policies: {
            quiet: {
              policyId: "quiet",
              allowedHostId: "linux-smoke",
              sampleEverySeconds: 60,
              ceilingInclusive: { loadavg1: 10, loadavg5: 10, loadavg15: 10 },
            },
          },
        },
      },
      cells: [{
        id: "smoke-cell",
        harness: "codex-sol",
        allowedHostId: "linux-smoke",
        loadCeilingId: "quiet",
        ports: [45_000, 45_001],
      }],
      machines: { "linux-smoke": { id: "linux-smoke", ...host } },
      harnesses: { "codex-sol": { binary: "/fixture/codex", observedVersion: "0.149.0" } },
    };
    await writeFile(configPath, `${JSON.stringify(harnessConfig, null, 2)}\n`);
    let lockCalls = 0;
    const admissionDependencies = {
      repositoryRoot,
      resolveSourceIdentity: () => ({ gitRead: () => Buffer.from("{}\n"), binding: null }),
      assertCommittedConfig: () => {},
      inspectSeriality: async () => ({
        gitHead: "fixture-head",
        committedPrefix: [],
        requestedIndex: 0,
        laterPristine: [],
        landedDispositions: [],
        privateCellState: "absent",
      }),
      configuredExecutionBinding: () => ({
        node: { path: process.execPath, sha256: `sha256:${"3".repeat(64)}`, bytes: 123_456 },
        controller: { sha256: `sha256:${"1".repeat(64)}` },
        driver: { sha256: `sha256:${"2".repeat(64)}` },
        sourceClosure: { version: "fixture" },
      }),
      currentHostIdentity: () => host,
      harnessEvidence: () => ({ version: { ok: true }, auth: { ok: true } }),
      resolveInstrument: () => ({ root: "fixture", manifest: { sha256: "4".repeat(64) } }),
      probeLaunchQuiet: async () => ({
        priorProcessClosure: { closed: true },
        ports: { values: [45_000, 45_001], unbound: true },
      }),
      loadavg: () => [1, 2, 3],
      now: () => Date.parse("2026-08-25T12:00:00.000Z"),
      acquireExclusiveHostLock: () => { lockCalls += 1; throw new Error("production lock forbidden"); },
    };
    const readiness = await inspectNonConsumingAdmissionSmoke({
      harnessConfigPath: configPath,
      cellId: "smoke-cell",
      dependencies: admissionDependencies,
    });
    assert.equal(readiness.execution.node.bytes, 123_456);
    assert.equal(readiness.host.observed.release, "6.8.12-smoke");
    assert.equal(readiness.host.observed.memoryBytes, 34_359_738_368);
    assert.equal(lockCalls, 0);

    const firstProductEdit = {
      at: null,
      orientationBytes: null,
      orientationTokens: nullCounts(),
      selectedSkills: [],
    };
    const smoke = await runNonConsumingSmoke({
      harnessConfigPath: configPath,
      cellId: "smoke-cell",
      driverPath: join(ROOT_PATH, "benchmarks/tools/social-messenger/metering/r2-cell-driver.mjs"),
      dependencies: {
        inspectAdmissionSmoke: async () => readiness,
        importDriver: async () => ({
          driver: {},
          preflight: {
            recordBase: {
              socialMessenger: {
                runScope: "reduced",
                instrumentVersion: CURRENT_INSTRUMENT_PIN,
                typingObservationBoundaryVersion: CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION,
                firstProductEdit,
                milestones: { M1: { caps: { wallCapSeconds: 60, tokenCap: null } } },
                clocks: { grading: { sessions: [{ wallSeconds: 0, tokens: nullCounts() }] } },
              },
            },
          },
        }),
        now: () => new Date("2026-08-25T12:00:00.000Z"),
      },
    });
    assert.equal(smoke.status, "non-scored");
    assert.equal(smoke.scored, false);
    assert.equal(smoke.attemptConsumed, false);
    assert.equal(smoke.productionLockAcquired, false);
    assert.equal(smoke.controller.initialized, true);
    assert.equal(smoke.controller.nativeSessionLaunched, false);
    assert.equal(smoke.recordComposition.instrumentPin, CURRENT_INSTRUMENT_PIN);
    assert.equal(lockCalls, 0);
    await assert.rejects(stat(join(privateRoot, "cells", "smoke-cell")), { code: "ENOENT" });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

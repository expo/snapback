import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";

import {
  recoverCodexFileChanges,
  recoverCodexSignalSettlements,
} from "./codex-native-evidence.mjs";
import { validateCoverageManifestBytes } from "./coverage-manifest.mjs";
import { parseJsonLines } from "./jsonl.mjs";
import { suiteReceiptVerdict } from "./manifest.mjs";
import { CURRENT_INSTRUMENT_PIN } from "./observations.mjs";
import { scrubR2NodeLoaderEnvironment } from "./r2-execution-environment.mjs";

// @ref LLP 0295#r2-load-isolated-calibration-rerun — each preregistered cell
// runs one exact native harness session behind controller-owned milestone gates.
const DRIVER_ID = "social-messenger-r2-native-cli-driver.v1";
const MARKER_FILE = "events/cell-milestones.jsonl";
const states = new Map();

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Prefixed(value) {
  return `sha256:${sha256(value)}`;
}

function logicalPath(root, path) {
  const value = relative(resolve(root), resolve(path));
  if (value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new Error(`R2 driver artifact escapes the cell root: ${path}`);
  }
  return value.split(sep).join("/");
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function capFamily(harnessKey) {
  if (harnessKey === "codex-sol") return "gpt-frontier";
  if (harnessKey === "claude-opus5") return "claude-frontier";
  if (harnessKey === "grok-46") return "grok-advisory";
  throw new Error(`unsupported R2 harness ${harnessKey}`);
}

function nullCounts() {
  return { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null };
}

function renderPrompt(config, cellRoot) {
  const source = resolve(config.planDirectory, requiredString(config.cell.promptFile, "cell.promptFile"));
  return readFile(source, "utf8").then((prompt) => {
    const rendered = prompt
      .replaceAll("{{LANE_ID}}", config.cell.id)
      .replaceAll("{{MODEL}}", config.cell.model)
      .replaceAll("{{PORT_BASE}}", String(config.cell.ports[0]))
      .replaceAll("{{PORT_MAX}}", String(config.cell.ports[1]));
    const signal = join(config.repositoryRoot, "benchmarks/tools/social-messenger/metering/r2-cell-signal.mjs");
    const appendix = `

## Observation-controller handoff (instrument 0.3.3-m8)

The external lane controller owns the authoring clock and is already running.
For each milestone, run the suite and choreography with their required typed
observation outputs, then make this your final command for that milestone:

  node ${JSON.stringify(signal)} --root ${JSON.stringify(cellRoot)} --milestone M1 \\
    --status green --terminal-reason green \\
    --suite-status suite-status.json \\
    --suite-observations receipts/m1-suite.observations.jsonl \\
    --choreography-receipt receipts/m1-choreography.jsonl \\
    --choreography-observations receipts/m1-choreography.jsonl.observations.jsonl

Replace M1/m1 for M2 and M3. The signal validates paths and blocks until the
controller opens the next milestone, preserving one continuous native harness
session while preventing observation windows from overlapping. For a terminal
failure, use status aborted/terminal-reason abort, or capability-failure with
terminal-reason wall-cap or token-cap, and retain every sidecar that exists.
Never hand-author aggregate metering or record fields; the controller derives
them from the native stream, typed observations, receipts, and these terminal
signals. Finish diary.md, essay.md, and final-report.md before sending M3;
the M3 signal is the last authoring action before the native harness exits.
`;
    return `${rendered.trimEnd()}${appendix}`;
  });
}

function recordBase(
  config,
  renderedPrompt,
  promptPath,
  instrumentManifest,
  instrumentManifestText,
) {
  const promptBytes = Buffer.byteLength(renderedPrompt);
  const promptDigest = sha256(renderedPrompt);
  const assertion = instrumentManifest.artifacts.assertions;
  const milestones = Object.fromEntries(config.milestones.map((milestone) => [
    milestone,
    {
      caps: {
        wallCapSeconds: config.harnessConfig.execution.perMilestoneWallSafetyLimitSeconds,
        tokenCap: null,
      },
    },
  ]));
  return {
    schemaVersion: 1,
    lane: "snapback",
    laneVariant: "skill",
    brief: "social-messenger",
    harness: {
      name: `${config.cell.harness} ${config.harness.observedVersion}`,
      model: config.cell.model,
      effort: config.cell.effort === "needs-ruling" ? null : config.cell.effort,
      environment: {
        node: config.allowedMachine.node.version,
        snapback: config.harnessConfig.pins.snapback0125.version,
        instrument: CURRENT_INSTRUMENT_PIN,
        ...(config.harness.versionFlag
          ? { harnessVersionFlag: config.harness.versionFlag }
          : {}),
      },
    },
    timestamps: { startedAt: "1970-01-01T00:00:00.000Z", finishedAt: "1970-01-01T00:00:00.000Z" },
    firstGreenProofAt: null,
    wallClock: {
      totalSeconds: 0,
      phases: { orientation: 0, authoring: 0, verification: 0, diagnosis: 0 },
    },
    tokens: {
      input: null,
      output: null,
      source: null,
      phases: { orientation: null, authoring: null, verification: null, diagnosis: null },
    },
    toolUses: null,
    correctionLoops: [],
    handAuthoredLoc: { lines: 0, files: 0 },
    diary: "diary.md",
    socialMessenger: {
      extensionVersion: 2,
      instrumentVersion: CURRENT_INSTRUMENT_PIN,
      orientation: {
        schemaVersion: "benchmark-orientation.v1",
        laneKind: "snapback-web-clique",
        instrument: {
          pin: CURRENT_INSTRUMENT_PIN,
          manifest: {
            path: "instrument.manifest.json",
            sha256: sha256(instrumentManifestText),
          },
          versions: instrumentManifest.versions,
        },
        selectedSkills: ["snapback-authoring"],
        artifacts: [{
          id: "rendered-cell-prompt",
          kind: "orientation",
          path: basename(promptPath),
          bytes: promptBytes,
          sha256: promptDigest,
          deduplicated: false,
        }],
        uniqueBytes: promptBytes,
        deliveredBytes: promptBytes,
        preflightWarnings: [],
      },
      runScope: "reduced",
      capFamily: capFamily(config.cell.harness),
      deploymentPosture: "local-dev-server",
      milestones,
      termination: { terminatedEarly: false, reason: null, afterMilestone: null },
      compaction: { policy: `${config.cell.harness}-native-default`, events: [] },
      firstProductEdit: {
        at: null,
        orientationBytes: null,
        orientationTokens: nullCounts(),
        selectedSkills: [],
      },
      meteringProvenance: {},
      coverageManifest: { path: "coverage-manifest.json", sha256: null, validated: false },
      assertionManifest: {
        path: assertion.path,
        version: instrumentManifest.versions.schema,
        sha256: assertion.sha256,
      },
      clocks: { grading: { sessions: [{ wallSeconds: 0, tokens: nullCounts() }] } },
      grading: {
        graderReportPath: null,
        graderFamily: null,
        sameFamilyGraded: false,
        usableGradingRecord: false,
      },
    },
  };
}

function harnessInvocation(state) {
  const argv = [...(state.config.harness.argvTemplate ?? [])];
  const promptFile = state.promptPath;
  const promptMode = state.config.harness.promptDelivery;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "{renderedPrompt}") argv[index] = promptFile;
  }
  if (state.config.cell.harness === "claude-opus5") {
    argv.push("--session-id", state.nativeSessionId, state.renderedPrompt);
  }
  return {
    binary: requiredString(state.config.harness.binary, "harness.binary"),
    argv,
    stdin: promptMode === "stdin" ? state.renderedPrompt : null,
  };
}

function deepValues(value, keyNames, found = []) {
  if (Array.isArray(value)) {
    for (const child of value) deepValues(child, keyNames, found);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (keyNames.has(key)) found.push(child);
      deepValues(child, keyNames, found);
    }
  }
  return found;
}

function deepObjects(value, predicate, found = []) {
  if (Array.isArray(value)) {
    for (const child of value) deepObjects(child, predicate, found);
  } else if (value && typeof value === "object") {
    if (predicate(value)) found.push(value);
    for (const child of Object.values(value)) deepObjects(child, predicate, found);
  }
  return found;
}

function commandFrom(record) {
  return deepValues(record, new Set(["command", "cmd"]))
    .find((value) => typeof value === "string" && value.length > 0) ?? null;
}

function exitCodeFrom(record) {
  return deepValues(record, new Set(["exit_code", "exitCode", "status_code"]))
    .find((value) => Number.isInteger(value)) ?? null;
}

function actionClass(command) {
  if (/\bsnapback\s+guide\b/u.test(command)) return "guide-lookup";
  if (/\b(choreography\.mjs|CHOREO_)\b/u.test(command)) return "choreography";
  if (/\b(acceptance|npm\s+(?:run\s+)?test|node\s+--test|bun\s+test)\b/u.test(command)) return "suite";
  if (/\b(codegen|generate|scaffold|create-snapback-app)\b/u.test(command)) return "generate";
  if (/\b(reseed|seed|reset.*(?:db|store|database))\b/u.test(command)) return "reseed";
  if (/\b(apply_patch|writeFile|write|edit|notebookedit|sed\s+-i|tee\b)\b/iu.test(command)) return "edit";
  if (/\b(rg|grep|cat|sed\s+-n|find|ls)\b/u.test(command)) return "source-inspection";
  return "process";
}

function queueObservation(state, operation) {
  // A queued observation runs outside the controller's guarded finalization
  // flow; an unhandled throw here previously exited the process before any
  // failure-shaped record could be written. Route failures into the state so
  // finalization fails closed with the named cause instead.
  const guarded = async () => {
    try {
      await operation();
    } catch (error) {
      state.observationFailure ??= error;
    }
  };
  state.observationQueue = state.observationQueue.then(guarded, guarded);
}

async function drainObservationQueue(state, milestone) {
  await state.observationQueue;
  if (state.observationFailure) {
    throw new Error(
      `${milestone} observation stream failed: ${state.observationFailure.message}`,
      { cause: state.observationFailure },
    );
  }
}

function queueStreamWrite(state, operation) {
  state.streamWriteQueue = state.streamWriteQueue.then(operation, operation);
}

function handleNativeRecord(state, record) {
  if (
    state.config.cell.harness === "codex-sol"
    && record?.type === "thread.started"
    && typeof record.thread_id === "string"
  ) {
    state.nativeSessionId = record.thread_id;
  }
  if (!state.controls) return;
  if (typeof record?.type === "string" && record.type.endsWith(".started")) return;
  const toolResult = deepObjects(record, (value) => (
    value.type === "tool_result"
    && typeof value.tool_use_id === "string"
    && state.pendingNativeTools.has(value.tool_use_id)
  ))[0] ?? null;
  const toolUse = toolResult === null
    ? deepObjects(record, (value) => (
        value.type === "tool_use"
        && typeof value.id === "string"
        && typeof value.name === "string"
      ))[0] ?? null
    : null;
  if (toolUse !== null) {
    state.pendingNativeTools.set(
      toolUse.id,
      typeof toolUse.input?.command === "string"
        ? toolUse.input.command
        : `${toolUse.name} ${JSON.stringify(toolUse.input ?? {})}`,
    );
    return;
  }
  const command = toolResult === null
    ? commandFrom(record)
    : state.pendingNativeTools.get(toolResult.tool_use_id);
  if (command === null) {
    const errorText = JSON.stringify(record);
    if (/rate.?limit|overloaded|api.?error|connection.?reset/iu.test(errorText)) {
      const requestId = `native-api-${++state.apiSequence}`;
      queueObservation(state, async () => {
        try {
          await state.controls.apiRequest({
            provider: state.config.cell.harness,
            operation: "native-harness-turn",
            requestId,
            retryOf: state.lastFailedApiRequest,
          }, async () => { throw new Error("native harness reported an API interruption"); });
        } catch {
          state.lastFailedApiRequest = requestId;
        }
      });
    }
    return;
  }
  if (toolResult !== null) state.pendingNativeTools.delete(toolResult.tool_use_id);
  // @ref LLP 0186#amendment-2026-08-21-d06--matrix-efficiency-targets-registered — the controller's
  // milestone signal is instrumentation, not a product-process action.
  if (/(?:^|[/\\])r2-cell-signal\.mjs(?:["']|\s)/u.test(command)) return;
  const nativeActionId = deepValues(record, new Set([
    "item_id",
    "itemId",
    "tool_use_id",
    "toolUseId",
    "id",
  ])).find((value) => typeof value === "string" && value.length > 0) ?? command;
  const nativeActionKey = `${nativeActionId}\0${command}`;
  if (state.seenNativeActions.has(nativeActionKey)) return;
  state.seenNativeActions.add(nativeActionKey);
  const klass = actionClass(command);
  const exitCode = toolResult === null
    ? exitCodeFrom(record)
    : (toolResult.is_error === true ? 1 : 0);
  const failed = exitCode !== null && exitCode !== 0;
  const pending = state.pendingEpisodes.get(klass) ?? null;
  const retry = pending !== null && pending.actionClass === klass;
  const episodeId = failed
    ? (pending?.episodeId ?? `episode-${state.currentMilestone.toLowerCase()}-${++state.episodeSequence}`)
    : (retry ? pending.episodeId : null);
  const actionId = `native-${state.currentMilestone.toLowerCase()}-${++state.actionSequence}`;
  queueObservation(state, async () => {
    await state.controls.semanticAction({
      actionId,
      actionClass: retry ? "retry" : klass,
      disposition: failed || retry ? "correction" : "progress",
      episodeId,
      retriedClass: retry ? klass : null,
      // binaryExcavation is a source-inspection sub-attribution; a RETRY of a
      // source-inspection carries the retriedClass linkage instead — stamping
      // the flag on a retry event contradicts the observation schema.
      binaryExcavation: !retry
        && klass === "source-inspection"
        && /node_modules|\.codex|\.claude/iu.test(command),
    });
    if (klass === "reseed") {
      await state.controls.reseed({ destructive: /reset|drop|delete/iu.test(command) }, async () => {});
    } else if (klass === "process" && /\b(restart|kill|shutdown)\b/iu.test(command)) {
      await state.controls.restart(async () => {});
    }
    if (failed) {
      state.pendingEpisodes.set(klass, {
        episodeId,
        actionClass: klass,
        actionCount: (pending?.actionCount ?? 0) + 1,
      });
    } else if (retry) {
      const actionCount = pending.actionCount + 1;
      await state.controls.recoveryEpisode({
        episodeId,
        carrier: "other",
        attribution: "ambiguous",
        subAttribution: null,
        outcome: "recovered",
        recoveredAt: new Date().toISOString(),
        actionCount,
      });
      state.correctionLoops.push({
        attribution: "ambiguous",
        summary: `Native ${klass} action failed and recovered on retry`,
        evidence: "events/harness.stdout.jsonl",
      });
      state.pendingEpisodes.delete(klass);
    }
  });
}

async function launchHarness(state) {
  const invocation = harnessInvocation(state);
  await access(invocation.binary, constants.X_OK);
  const stdoutPath = join(state.root, "events", "harness.stdout.jsonl");
  const stderrPath = join(state.root, "events", "harness.stderr.log");
  await writeFile(stdoutPath, "", "utf8");
  await writeFile(stderrPath, "", "utf8");
  const child = spawn(invocation.binary, invocation.argv, {
    cwd: state.root,
    env: {
      ...scrubR2NodeLoaderEnvironment(process.env),
      R2_LANE_RUN_ID: state.config.laneRunId,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  state.child = child;
  state.exit = new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
    child.once("error", (error) => resolveExit({
      code: null,
      signal: null,
      error: error.message,
    }));
  });
  state.closed = new Promise((resolveClose) => {
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  if (!Number.isInteger(child.pid)) {
    const failure = await state.exit;
    await state.closed;
    throw new Error(`R2 native harness failed to spawn: ${failure.error ?? "missing child PID"}`);
  }
  const ownershipPath = join(state.root, "process-ownership.json");
  try {
    const ownership = JSON.parse(await readFile(ownershipPath, "utf8"));
    ownership.nativeHarnessPid = child.pid;
    ownership.nativeHarnessStartedAt = new Date().toISOString();
    ownership.updatedAt = ownership.nativeHarnessStartedAt;
    const nextPath = `${ownershipPath}.next`;
    await writeFile(nextPath, `${JSON.stringify(ownership, null, 2)}\n`, { flag: "wx" });
    await rename(nextPath, ownershipPath);
  } catch (error) {
    child.kill("SIGTERM");
    await state.closed;
    throw new Error(`R2 driver cannot bind native process ownership: ${error.message}`);
  }
  const stdout = createInterface({ input: child.stdout });
  stdout.on("line", (line) => {
    queueStreamWrite(state, () => appendFile(stdoutPath, `${line}\n`, "utf8"));
    try {
      handleNativeRecord(state, JSON.parse(line));
    } catch {
      // The raw stream remains authoritative evidence even when one line is
      // not a structured native event understood by this bounded classifier.
    }
  });
  child.stderr.on("data", (chunk) => {
    queueStreamWrite(state, () => appendFile(stderrPath, chunk));
  });
  if (invocation.stdin !== null) child.stdin.end(invocation.stdin);
  else child.stdin.end();
}

async function readMarkers(state) {
  try {
    const text = await readFile(join(state.root, MARKER_FILE), "utf8");
    return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function controllerTerminalTimes(state) {
  const path = join(state.root, "events", "lane-controller-observations.jsonl");
  const records = (await readFile(path, "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const byMilestone = new Map();
  for (const record of records) {
    if (record.laneRunId !== state.config.laneRunId) {
      throw new Error("lane-controller observation belongs to another lane run");
    }
    if (!/^M[1-8]$/u.test(record.milestone ?? "")) continue;
    const previous = byMilestone.get(record.milestone);
    if (previous === undefined || Date.parse(record.at) > Date.parse(previous)) {
      byMilestone.set(record.milestone, record.at);
    }
  }
  return byMilestone;
}

async function waitForMarker(state, milestone) {
  while (true) {
    const marker = (await readMarkers(state)).find((candidate) => candidate.milestone === milestone);
    if (marker) return marker;
    const exit = await Promise.race([
      state.exit.then((value) => ({ type: "exit", value })),
      new Promise((resolveWait) => setTimeout(() => resolveWait({ type: "poll" }), 250)),
    ]);
    if (exit.type === "exit") {
      throw new Error(
        `native ${state.config.cell.harness} CLI exited before ${milestone} terminal signal (${JSON.stringify(exit.value)})`,
      );
    }
  }
}

async function retainedDescriptor(root, path) {
  const absolute = resolve(root, requiredString(path, "retained artifact path"));
  const bytes = await readFile(absolute);
  return { path: logicalPath(root, absolute), sha256: sha256Prefixed(bytes) };
}

async function refusalTimeSuiteStatus(root, suiteStatusPath, marker, receipt) {
  const segment = marker.milestone.toLowerCase();
  const suite = receipt?.summary?.suite;
  if (
    typeof suite?.pass !== "boolean"
    || typeof suite?.receipt !== "string"
    || suite.receipt.length === 0
    || typeof suite?.receiptSha256 !== "string"
  ) {
    throw new Error(`${marker.milestone} choreography summary lacks suite verdict identity`);
  }
  const absolute = resolve(dirname(resolve(root, suiteStatusPath)), suite.receipt);
  const bytes = await readFile(absolute);
  const artifact = {
    path: logicalPath(root, absolute),
    sha256: sha256Prefixed(bytes),
  };
  let verdict = null;
  let verdictError = null;
  try {
    verdict = suiteReceiptVerdict(bytes, marker.milestone, `suite-status ${segment}.receipt`);
  } catch (error) {
    verdictError = error;
  }
  if (verdict !== null && verdict !== suite.pass) {
    throw new Error(
      `suite-status ${segment} verdict changed after choreography refusal-check: refusal-time=${suite.pass} retained-receipt=${verdict}`,
    );
  }
  if (artifact.sha256 !== suite.receiptSha256) {
    throw new Error(
      `suite-status ${segment}.receipt identity changed after choreography refusal-check: refusal-time=${suite.receiptSha256} final=${artifact.sha256}`,
    );
  }
  if (verdictError !== null) throw verdictError;
  return { pass: suite.pass, receipt: suite.receipt };
}

// @ref LLP 0201#d2--quantitative-instrument — a green boundary is bound to
// the suite verdict and receipt hash captured by choreography. Later suite
// runs may replace the aggregate status file, but cannot replace that identity.
export async function reconcileSuiteStatuses({
  root,
  suiteStatusPath = "suite-status.json",
  markers,
  receipts,
  statuses,
}) {
  if (!statuses || Array.isArray(statuses) || typeof statuses !== "object") {
    throw new TypeError("suite-status must contain an object keyed by milestone");
  }
  const reconciled = structuredClone(statuses);
  const byMilestone = new Map(receipts.map((receipt) => [receipt.milestone, receipt]));
  for (const marker of markers) {
    const segment = marker.milestone.toLowerCase();
    if (marker.status !== "green") {
      reconciled[segment] = { pass: false, receipt: null };
      continue;
    }
    const bound = await refusalTimeSuiteStatus(
      root,
      suiteStatusPath,
      marker,
      byMilestone.get(marker.milestone),
    );
    if (bound.pass !== true) {
      throw new Error(
        `suite-status ${segment} verdict conflicts with green terminal: terminal=true refusal-time=${bound.pass}`,
      );
    }
    const final = reconciled[segment];
    if (final !== undefined) {
      if (!final || typeof final !== "object" || typeof final.pass !== "boolean") {
        throw new Error(`suite-status ${segment} lacks a boolean final verdict`);
      }
      const unboundRollover = final.pass === false
        && (final.receipt === null || final.receipt === undefined);
      if (!unboundRollover && final.pass !== bound.pass) {
        throw new Error(
          `suite-status ${segment} verdict changed after choreography refusal-check: refusal-time=${bound.pass} final=${final.pass}`,
        );
      }
      if (
        !unboundRollover
        && (final.receipt ?? null) !== bound.receipt
      ) {
        throw new Error(
          `suite-status ${segment}.receipt path changed after choreography refusal-check: refusal-time=${bound.receipt} final=${final.receipt ?? null}`,
        );
      }
    }
    reconciled[segment] = bound;
  }
  return reconciled;
}

async function receiptDescriptor(state, marker) {
  if (!marker.choreographyReceipt) return null;
  const artifact = await retainedDescriptor(state.root, marker.choreographyReceipt);
  const records = (await readFile(resolve(state.root, marker.choreographyReceipt), "utf8"))
    .split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  const summary = records.find((record) => (
    record.type === "segment-summary"
    && record.segment?.toUpperCase() === marker.milestone
  ));
  if (!summary) throw new Error(`${marker.milestone} choreography receipt has no segment-summary`);
  return {
    sourceId: `${marker.milestone.toLowerCase()}-choreography`,
    runId: requiredString(summary.runId, "choreography runId"),
    milestone: marker.milestone,
    ...artifact,
    summary,
  };
}

async function findCodexRollout(state) {
  const searchRoot = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const candidates = [];
  async function visit(directory, depth = 0) {
    if (depth > 6) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const status = await stat(path);
        if (status.mtimeMs >= Date.parse(state.startedAt) - 5_000) candidates.push(path);
      }
    }
  }
  await visit(join(searchRoot, "sessions"));
  for (const path of candidates.sort()) {
    const text = await readFile(path, "utf8");
    const meta = text.split(/\r?\n/u).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).find((record) => record?.type === "session_meta" && typeof record?.payload?.id === "string");
    if (!meta || meta.payload.id !== state.nativeSessionId) continue;
    const target = join(state.root, "events", "codex-rollout.jsonl");
    await copyFile(path, target);
    return {
      adapter: "codex",
      sessions: [{
        sourceId: "builder",
        parentSourceId: null,
        role: "builder",
        nativeSessionId: meta.payload.id,
        nativeAgentId: null,
        ...(await retainedDescriptor(state.root, target)),
      }],
      unavailableReason: null,
    };
  }
  return null;
}

async function meteringSession(state) {
  if (state.config.cell.harness === "grok-46") return null;
  if (state.config.cell.harness === "codex-sol") return findCodexRollout(state);
  const path = join(state.root, "events", "harness.stdout.jsonl");
  const text = await readFile(path, "utf8");
  const records = text.split(/\r?\n/u).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const carriesSession = records.some((record) => (
    record.sessionId === state.nativeSessionId || record.session_id === state.nativeSessionId
  ));
  const carriesUsage = records.some((record) => record?.message?.usage);
  if (!carriesSession || !carriesUsage) return null;
  return {
    adapter: "claude",
    sessions: [{
      sourceId: "builder",
      parentSourceId: null,
      role: "builder",
      nativeSessionId: state.nativeSessionId,
      nativeAgentId: null,
      ...(await retainedDescriptor(state.root, path)),
    }],
    unavailableReason: null,
  };
}

async function writeTerminalArtifacts(state, error) {
  if (state.closed !== null) await state.closed;
  await state.streamWriteQueue;
  await state.observationQueue;
  if (state.controls) {
    for (const [toolUseId, command] of state.pendingNativeTools.entries()) {
      const klass = actionClass(command);
      const episodeId = `episode-${state.currentMilestone.toLowerCase()}-${++state.episodeSequence}`;
      await state.controls.semanticAction({
        actionId: `native-${state.currentMilestone.toLowerCase()}-${++state.actionSequence}`,
        actionClass: klass,
        disposition: "correction",
        episodeId,
        retriedClass: null,
        binaryExcavation: false,
      });
      await state.controls.recoveryEpisode({
        episodeId,
        carrier: "other",
        attribution: "ambiguous",
        subAttribution: null,
        outcome: "unresolved",
        recoveredAt: null,
        actionCount: 1,
      });
      state.correctionLoops.push({
        attribution: "ambiguous",
        summary: `Native ${klass} action ${toolUseId} ended without a retained result`,
        evidence: "events/harness.stdout.jsonl",
      });
    }
    state.pendingNativeTools.clear();
    for (const pending of state.pendingEpisodes.values()) {
      await state.controls.recoveryEpisode({
        episodeId: pending.episodeId,
        carrier: "other",
        attribution: "ambiguous",
        subAttribution: null,
        outcome: "unresolved",
        recoveredAt: null,
        actionCount: pending.actionCount,
      });
      state.correctionLoops.push({
        attribution: "ambiguous",
        summary: `Native ${pending.actionClass} action failed without a successful retry`,
        evidence: "events/harness.stdout.jsonl",
      });
    }
    state.pendingEpisodes.clear();
  }
  const markers = await readMarkers(state);
  const terminalTimes = await controllerTerminalTimes(state);
  if (error && state.currentMilestone) {
    const existing = markers.find((item) => item.milestone === state.currentMilestone);
    const failure = {
      milestone: state.currentMilestone,
      status: "aborted",
      terminalReason: "abort",
      recordedAt: new Date().toISOString(),
      suiteStatus: state.suiteStatusPath,
    };
    if (existing) {
      Object.assign(existing, failure);
      delete existing.choreographyReceipt;
      delete existing.choreographyObservations;
      delete existing.suiteObservations;
    }
    else markers.push(failure);
  }
  if (markers.length === 0) throw new Error("R2 driver has no attempted milestone to record");
  const session = await meteringSession(state);
  const adapter = session?.adapter ?? "unavailable";
  const boundaries = {
    laneRunId: state.config.laneRunId,
    driverId: DRIVER_ID,
    milestones: {},
  };
  const receipts = [];
  let suiteStatusPath = null;
  const driverFinalizedAt = new Date().toISOString();
  for (const [index, marker] of markers.entries()) {
    const receipt = await receiptDescriptor(state, marker);
    if (receipt) receipts.push(receipt);
    if (marker.suiteStatus) suiteStatusPath = marker.suiteStatus;
    const firstGreenAt = marker.status === "green"
      ? (receipt?.summary?.recordedAt ?? marker.recordedAt)
      : null;
    const terminalAt = marker.status === "green"
      ? firstGreenAt
      : terminalTimes.get(marker.milestone)
        ?? marker.recordedAt
        ?? driverFinalizedAt;
    if (firstGreenAt !== null && Date.parse(firstGreenAt) > Date.parse(terminalAt)) {
      throw new Error(`${marker.milestone} first-green evidence follows its controller terminal`);
    }
    boundaries.milestones[marker.milestone] = {
      status: marker.status,
      firstGreenAt,
      suitePassAt: firstGreenAt,
      choreoPassAt: firstGreenAt,
      terminalAt,
      terminalSequence: index + 1,
      terminalReason: marker.terminalReason,
    };
  }
  let firstProductEdit = null;
  if (adapter === "codex") {
    const builder = session.sessions.find((candidate) => candidate.role === "builder");
    if (builder === undefined) throw new Error("Codex finalization lacks its builder session");
    const rolloutPath = resolve(state.root, builder.path);
    const records = parseJsonLines(await readFile(rolloutPath, "utf8"), builder.path);
    recoverCodexSignalSettlements({
      records,
      boundaryValue: boundaries,
      streamClosedAt: markers.some((marker) => marker.status !== "green")
        ? driverFinalizedAt
        : null,
    });
    const recoveredFileChanges = recoverCodexFileChanges({
      records,
      boundaryValue: boundaries,
      laneRunId: state.config.laneRunId,
      productRoot: state.root,
      sourceId: builder.sourceId,
      nativeSessionId: builder.nativeSessionId,
      nativeStreamSha256: builder.sha256,
    });
    firstProductEdit = recoveredFileChanges.firstProductEdit;
    if (recoveredFileChanges.events.length > 0) {
      const fileChangePath = join(state.root, "events", "codex-file-change-observations.jsonl");
      await writeFile(
        fileChangePath,
        `${recoveredFileChanges.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        "utf8",
      );
      state.observationSources.push({
        sourceId: "codex-file-change-observations",
        path: fileChangePath,
      });
    }
  }
  await writeFile(
    join(state.root, "terminal-boundaries.json"),
    `${JSON.stringify(boundaries, null, 2)}\n`,
  );
  if (firstProductEdit !== null) {
    await writeFile(
      join(state.root, "first-product-edit.json"),
      `${JSON.stringify(firstProductEdit, null, 2)}\n`,
    );
  }
  if (suiteStatusPath === null) {
    suiteStatusPath = "suite-status.json";
  }
  let statuses = {};
  try {
    statuses = JSON.parse(await readFile(join(state.root, suiteStatusPath), "utf8"));
  } catch {
    statuses = {};
  }
  statuses = await reconcileSuiteStatuses({
    root: state.root,
    suiteStatusPath,
    markers,
    receipts,
    statuses,
  });
  await writeFile(join(state.root, suiteStatusPath), `${JSON.stringify(statuses, null, 2)}\n`);
  const base = JSON.parse(await readFile(join(state.root, "record-base.json"), "utf8"));
  let coverage = null;
  const assertionBytes = await readFile(join(state.root, "schema/social-messenger/assertions.json"));
  try {
    const coverageBytes = await readFile(join(state.root, "coverage-manifest.json"));
    coverage = validateCoverageManifestBytes({
      coverageBytes,
      assertionBytes,
      expectedMilestones: state.config.milestones,
      runScope: base.socialMessenger.runScope,
      instrumentPin: CURRENT_INSTRUMENT_PIN,
    });
  } catch (coverageError) {
    if (coverageError.code !== "ENOENT" || markers.every((marker) => marker.status === "green")) {
      throw coverageError;
    }
  }
  base.socialMessenger.coverageManifest = coverage === null
    ? { path: "coverage-manifest.json", sha256: null, validated: false }
    : { path: "coverage-manifest.json", sha256: coverage.sha256, validated: true };
  base.correctionLoops = state.correctionLoops;
  await writeFile(join(state.root, "record-base.json"), `${JSON.stringify(base, null, 2)}\n`);
  const manifestStampedAt = new Date().toISOString();
  const manifest = {
    manifestVersion: "social-messenger-metering-manifest.v1",
    laneRunId: state.config.laneRunId,
    capFamily: capFamily(state.config.cell.harness),
    adapter,
    unavailableReason: adapter === "unavailable"
      ? (state.config.harness.meteringUnavailableReason ?? "retained-session-stream-missing")
      : null,
    sessions: session?.sessions ?? [],
    receipts: receipts.map(({ summary: _summary, ...receipt }) => receipt),
    observations: [],
    suiteStatus: await retainedDescriptor(state.root, suiteStatusPath),
    boundaries: await retainedDescriptor(state.root, "terminal-boundaries.json"),
    firstProductEdit: firstProductEdit === null
      ? null
      : await retainedDescriptor(state.root, "first-product-edit.json"),
    coverageManifest: coverage === null
      ? null
      : { path: "coverage-manifest.json", sha256: coverage.sha256 },
    recordBase: await retainedDescriptor(state.root, "record-base.json"),
    driver: {
      id: DRIVER_ID,
      startedAt: state.startedAt,
      stampedAt: manifestStampedAt,
      instrumentationCommandsObserved: false,
    },
    clockCorrelation: {
      method: "rfc3339-with-bounded-skew",
      maxSkewMillis: adapter === "codex" ? 5_000 : 0,
      evidence: adapter === "codex"
        ? "controller and native CLI use the same host clock; 5s covers receipt-to-final-sample handoff"
        : "native CLI and controller stamps use the shared host system clock; closing terminalAt is stamped only after the native process and stream have closed",
    },
  };
  const ownershipPath = join(state.root, "process-ownership.json");
  const ownership = JSON.parse(await readFile(ownershipPath, "utf8"));
  if (!Number.isInteger(ownership.nativeHarnessPid) || ownership.nativeHarnessPid <= 0) {
    throw new Error("R2 driver cannot finalize without its launched native process identity");
  }
  ownership.nativeHarness = {
    pid: ownership.nativeHarnessPid,
    harnessKey: state.config.cell.harness,
    adapter,
    sessions: manifest.sessions.map((candidate) => ({
      sourceId: candidate.sourceId,
      parentSourceId: candidate.parentSourceId,
      role: candidate.role,
      nativeSessionId: candidate.nativeSessionId,
      nativeAgentId: candidate.nativeAgentId ?? null,
    })),
    driverStartedAt: state.startedAt,
    driverStampedAt: manifestStampedAt,
  };
  ownership.updatedAt = manifestStampedAt;
  const ownershipNextPath = `${ownershipPath}.next`;
  await writeFile(ownershipNextPath, `${JSON.stringify(ownership, null, 2)}\n`, { flag: "wx" });
  await rename(ownershipNextPath, ownershipPath);
  await writeFile(join(state.root, "metering-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  state.terminalMarkers = markers;
}

export async function preflight({ config, configDirectory }) {
  const root = resolve(configDirectory);
  const renderedPrompt = await renderPrompt(config, root);
  const promptPath = join(root, "rendered-prompt.md");
  const instrumentManifestPath = join(config.repositoryRoot, "benchmarks/instrument.manifest.json");
  const instrumentManifestText = await readFile(instrumentManifestPath, "utf8");
  const instrumentManifest = JSON.parse(instrumentManifestText);
  if (instrumentManifest.instrumentPin !== CURRENT_INSTRUMENT_PIN) {
    throw new Error(`production driver requires ${CURRENT_INSTRUMENT_PIN}`);
  }
  const assertionPath = resolve(config.repositoryRoot, "benchmarks", instrumentManifest.artifacts.assertions.path);
  const assertionBytes = await readFile(assertionPath);
  if (sha256(assertionBytes) !== instrumentManifest.artifacts.assertions.sha256) {
    throw new Error("production driver assertion manifest differs from the instrument registration");
  }
  const base = recordBase(
    config,
    renderedPrompt,
    promptPath,
    instrumentManifest,
    instrumentManifestText,
  );
  return {
    version: "social-messenger-r2-driver-preflight.v1",
    root,
    renderedPrompt,
    promptPath,
    instrumentManifest,
    instrumentManifestText,
    assertionPath,
    assertionBytes,
    recordBase: base,
  };
}

export async function prepare({ config, configDirectory, preflight: prepared = null }) {
  const plan = prepared ?? await preflight({ config, configDirectory });
  const root = resolve(configDirectory);
  if (plan.version !== "social-messenger-r2-driver-preflight.v1" || plan.root !== root) {
    throw new Error("R2 production driver requires its exact pre-attempt preflight result");
  }
  await mkdir(join(root, "events"), { recursive: true });
  await mkdir(join(root, "receipts"), { recursive: true });
  await mkdir(join(root, "gates"), { recursive: true });
  const {
    renderedPrompt,
    promptPath,
    instrumentManifest,
    instrumentManifestText,
  } = plan;
  await writeFile(promptPath, renderedPrompt, "utf8");
  await writeFile(join(root, "instrument.manifest.json"), instrumentManifestText, "utf8");
  const retainedAssertionPath = join(root, instrumentManifest.artifacts.assertions.path);
  await mkdir(dirname(retainedAssertionPath), { recursive: true });
  await writeFile(retainedAssertionPath, plan.assertionBytes, { flag: "wx" });
  await writeFile(
    join(root, "record-base.json"),
    `${JSON.stringify(plan.recordBase, null, 2)}\n`,
  );
  states.set(config.laneRunId, {
    config,
    root,
    renderedPrompt,
    promptPath,
    startedAt: new Date().toISOString(),
    nativeSessionId: randomUUID(),
    child: null,
    exit: null,
    closed: null,
    controls: null,
    currentMilestone: null,
    observationQueue: Promise.resolve(),
    streamWriteQueue: Promise.resolve(),
    actionSequence: 0,
    episodeSequence: 0,
    apiSequence: 0,
    lastFailedApiRequest: null,
    pendingEpisodes: new Map(),
    pendingNativeTools: new Map(),
    seenNativeActions: new Set(),
    correctionLoops: [],
    suiteStatusPath: null,
    observationSources: [],
    terminalMarkers: [],
  });
}

export function claimOptions() {
  return {
    semanticActionsClaimed: true,
    recoveryEpisodesClaimed: true,
    restartReseedClaimed: true,
    apiInterruptionsClaimed: true,
    // Suite and choreography assertion claims come from their own typed
    // sidecars. Null deliberately emits no competing controller claim.
    suiteAssertionWaitClaimed: null,
  };
}

export async function runMilestone({ milestone, controls, config }) {
  const state = states.get(config.laneRunId);
  if (!state) throw new Error("R2 production driver was not prepared");
  state.currentMilestone = milestone;
  state.controls = controls;
  await writeFile(join(state.root, "gates", milestone), `${new Date().toISOString()}\n`);
  if (state.child === null) {
    await controls.apiRequest({
      provider: config.cell.harness,
      operation: "launch-native-cell",
      requestId: `launch-${config.cell.id}`,
      retryOf: null,
    }, () => launchHarness(state));
    await controls.semanticAction({
      actionId: `native-${milestone.toLowerCase()}-${++state.actionSequence}`,
      actionClass: "process",
      disposition: "progress",
      episodeId: null,
      retriedClass: null,
      binaryExcavation: false,
    });
  }
  const marker = await waitForMarker(state, milestone);
  state.suiteStatusPath = marker.suiteStatus ?? state.suiteStatusPath;
  for (const [suffix, path] of [
    ["suite", marker.suiteObservations],
    ["choreography", marker.choreographyObservations],
  ]) {
    if (path) {
      state.observationSources.push({
        sourceId: `${milestone.toLowerCase()}-${suffix}-observations`,
        path,
      });
    }
  }
  // Attribute a queued schema/writer refusal to the milestone whose native
  // observation caused it. Waiting until finalize() would let a later
  // milestone run and misattribute the failure to the last attempted one.
  await drainObservationQueue(state, milestone);
  if (marker.status === "green" && (!marker.suiteObservations || !marker.choreographyObservations)) {
    throw new Error(`${milestone} green signal lacks suite/choreography observation sidecars`);
  }
  if (milestone === config.milestones.at(-1)) {
    const exit = await state.exit;
    if (exit.error || exit.code !== 0) {
      throw new Error(
        `native ${config.cell.harness} CLI exited ${exit.error ?? exit.code ?? exit.signal}`,
      );
    }
  }
}

export async function finalize({ config, error }) {
  const state = states.get(config.laneRunId);
  if (!state) throw new Error("R2 production driver was not prepared");
  if (error && state.child && state.child.exitCode === null && state.child.signalCode === null) {
    state.child.kill("SIGTERM");
    await state.closed;
  }
  // Drain the observation queue so late queued failures are captured, then
  // fail closed on the first observation failure with its named cause.
  await state.observationQueue.catch(() => {});
  const effectiveError = error
    ?? (state.observationFailure
      ? new Error(`observation stream failed: ${state.observationFailure.message}`, { cause: state.observationFailure })
      : null);
  await writeTerminalArtifacts(state, effectiveError);
}

export function observationSources({ config }) {
  const state = states.get(config.laneRunId);
  return state?.observationSources ?? [];
}

export const r2CellDriverTestHooks = Object.freeze({
  handleNativeRecord,
  installState(laneRunId, state) {
    states.set(laneRunId, state);
  },
  removeState(laneRunId) {
    states.delete(laneRunId);
  },
});

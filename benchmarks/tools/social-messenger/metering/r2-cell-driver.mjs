import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  appendFile as unsafeAppendFile,
  copyFile as unsafeCopyFile,
  lstat,
  mkdir as unsafeMkdir,
  readFile,
  readdir,
  rename as unsafeRename,
  stat,
  writeFile as unsafeWriteFile,
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
import { resolveConfigJourney } from "./journey-contract.mjs";
import { suiteReceiptVerdict } from "./manifest.mjs";
import {
  CURRENT_INSTRUMENT_PIN,
  CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION,
} from "./observations.mjs";
import { scrubR2NodeLoaderEnvironment } from "./r2-execution-environment.mjs";
import { validateScaleReplayEvidence } from "./scale-replay-evidence.mjs";
import { adaptClaudeSession } from "./adapters/claude-session.mjs";
import { adaptCodexSessionTree } from "./adapters/codex-session.mjs";
import { capTokenCount } from "./counts.mjs";
import { TokenCapEnforcedError, TokenCapWatchdog } from "./watchdog.mjs";
import { ALLOW_CELL_MUTATIONS } from "./mutation-guard.mjs";

const MARKER_FILE = "events/cell-milestones.jsonl";
const states = new Map();
const mutationGuards = new Map();

function mutationGuardFor(path) {
  const absolute = resolve(path);
  return [...mutationGuards.entries()]
    .filter(([root]) => absolute === root || absolute.startsWith(`${root}${sep}`))
    .sort(([left], [right]) => right.length - left.length)[0]?.[1]
    ?? ALLOW_CELL_MUTATIONS;
}

function assertWrite(path, operation) {
  mutationGuardFor(path).assertMutationAllowed(operation);
}

async function appendFile(path, ...args) {
  assertWrite(path, `driver append ${path}`);
  return unsafeAppendFile(path, ...args);
}

async function copyFile(source, target, ...args) {
  assertWrite(target, `driver copy ${target}`);
  return unsafeCopyFile(source, target, ...args);
}

async function mkdir(path, ...args) {
  assertWrite(path, `driver directory mutation ${path}`);
  return unsafeMkdir(path, ...args);
}

async function rename(source, target, ...args) {
  assertWrite(source, `driver rename source ${source}`);
  assertWrite(target, `driver rename target ${target}`);
  return unsafeRename(source, target, ...args);
}

async function writeFile(path, ...args) {
  assertWrite(path, `driver write ${path}`);
  return unsafeWriteFile(path, ...args);
}

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

function transitionStage({ transition, abortSignal }, stage) {
  if (typeof transition === "function") return transition(`driver-${stage}`);
  if (abortSignal?.aborted === true) {
    const error = new Error(
      `R3_CELL_WALL_CAP_ABORTED: refused driver stage transition ${stage} after cancellation`,
    );
    error.code = "R3_CELL_WALL_CAP_ABORTED";
    error.rootCauseClass = "cell-wall-cap";
    error.stage = `driver-${stage}`;
    throw error;
  }
  return stage;
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

// @ref LLP 0201#d1--the-app-and-why-this-app — full scope is a continuous
// M1-M6+M8 builder followed by a genuinely fresh, handoff-only M7 session.
// The original M1-M3 R2 shape remains a distinct, unchanged reduced mode.
export function resolveCellJourney(config) {
  return resolveConfigJourney(config);
}

function renderPrompt(config, cellRoot) {
  const source = resolve(config.planDirectory, requiredString(config.cell.promptFile, "cell.promptFile"));
  return readFile(source, "utf8").then((prompt) => {
    const registeredSha256 = config.harnessConfig.prompts?.[config.cell.promptFile]?.sha256;
    if (registeredSha256 !== undefined && sha256(prompt) !== registeredSha256) {
      throw new Error(`R2_DRIVER_PROMPT_PIN: ${config.cell.promptFile} differs from its registered SHA-256`);
    }
    const rendered = prompt
      .replaceAll("{{LANE_ID}}", config.cell.id)
      .replaceAll("{{MODEL}}", config.cell.model)
      .replaceAll("{{PORT_BASE}}", String(config.cell.ports[0]))
      .replaceAll("{{PORT_MAX}}", String(config.cell.ports[1]))
      .replaceAll("{{M7_PORT_BASE}}", String(config.cell.m7Ports?.[0] ?? ""))
      .replaceAll("{{M7_PORT_MAX}}", String(config.cell.m7Ports?.[1] ?? ""));
    const signal = join(config.repositoryRoot, "benchmarks/tools/social-messenger/metering/r2-cell-signal.mjs");
    const journey = resolveCellJourney(config);
    const reducedAppendix = `

## Observation-controller handoff (instrument 0.3.8-m8)

The external lane controller owns the authoring clock and is already running.
For each milestone, run the suite and choreography with their required typed
observation outputs and the same retained \`setup-identity.json\`, then make this
your final command for that milestone. Choreography refuses before browser or
receipt startup unless both \`--suite-status suite-status.json\` and
\`--setup-identity setup-identity.json\` are present. The setup file must use
\`social-messenger.setup-identity.v1\` and distinguish qualified binary from
wrapper, package/prepack closure, declared toolchains, backend, and host.

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
    const fullAppendix = `

## Full-journey observation-controller handoff (instrument 0.3.8-m8)

The external lane controller owns the authoring clocks and is already running.
This native session is the continuous builder only: complete M1, M2, M3, M4,
M5, M6, then M8 in order. For each milestone, run the suite and choreography
with their typed observation outputs and the same retained setup-identity.json,
then signal the boundary with r2-cell-signal.mjs exactly as shown below (replace
M1/m1 for the active milestone):

  node ${JSON.stringify(signal)} --root ${JSON.stringify(cellRoot)} --milestone M1 \\
    --status green --terminal-reason green \\
    --suite-status suite-status.json \\
    --suite-observations receipts/m1-suite.observations.jsonl \\
    --choreography-receipt receipts/m1-choreography.jsonl \\
    --choreography-observations receipts/m1-choreography.jsonl.observations.jsonl

Send the M8 signal immediately when M8's suite and choreography are green; that
signal ends M8's authoring clock. After it returns, run the separately clocked
scale replay and write scale-replay.json using
snapback.full-journey-scale-replay.v1. It must carry attempted=true, the replay
   cap/probe-exclusion fields, a chronological attempts array, and a receipt
   descriptor (relative path plus SHA-256) for a
   snapback.full-journey-scale-replay-receipt.v1 adapter receipt. That receipt
   must name the fixture pack's exact scale-log SHA-256/action count, every
   reached 10%/50% checkpoint prefix/hash, the final settled prefix, and failed
   action count. Attempts are
numbered from 1; every non-final attempt has disposition=continued; each later
attempt names the immediately preceding attempt in continuationOf; the final
attempt is completed or aborted. Every attempt records startedAt, finishedAt,
and settledPrefix. Then prepare the fresh starter-state backend plus a
self-contained handoff at m7-handoff.md. That file must contain every
instruction and context the fresh M7 agent needs; the driver hash-binds its
bytes and does not forward this session's prompt or conversation. Exit after
both files are complete. Do not build M7 here. For a terminal failure, use
status aborted/terminal-reason abort, or capability-failure with terminal-reason
wall-cap or token-cap, and retain every sidecar that exists. Never hand-author
aggregate metering or record fields; the controller composes them from retained
native evidence.
`;
    return `${rendered.trimEnd()}${journey.runScope === "reduced" ? reducedAppendix : fullAppendix}`;
  });
}

async function renderFreshM7Prompt(state) {
  const handoffPath = join(state.root, "m7-handoff.md");
  let status;
  try {
    status = await lstat(handoffPath);
  } catch (error) {
    throw new Error(`R2_DRIVER_M7_HANDOFF: m7-handoff.md is absent: ${error.message}`);
  }
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new Error("R2_DRIVER_M7_HANDOFF: m7-handoff.md must be a regular non-symlink file");
  }
  const handoff = await readFile(handoffPath, "utf8");
  if (handoff.trim().length === 0) {
    throw new Error("R2_DRIVER_M7_HANDOFF: m7-handoff.md must not be empty");
  }
  state.m7HandoffSource = {
    path: "m7-handoff.md",
    sha256: sha256Prefixed(handoff),
  };
  const signal = join(
    state.config.repositoryRoot,
    "benchmarks/tools/social-messenger/metering/r2-cell-signal.mjs",
  );
  return `# Fresh-session M7 handoff

This is a new native harness session. The prior builder prompt and conversation
were not forwarded. Work only from the byte-bound handoff below and the files it
names. Use only ports ${state.config.cell.m7Ports[0]}-${state.config.cell.m7Ports[1]};
start a fresh backend seeded from starter state, never the scale database.

Handoff SHA-256: ${sha256Prefixed(handoff)}

--- BEGIN BUILDER HANDOFF ---
${handoff.trimEnd()}
--- END BUILDER HANDOFF ---

Complete only M7. Run its regression suite and standalone choreography with
typed sidecars, write the M7 diary/essay/final report required by the handoff,
then make this the final command before exiting:

  node ${JSON.stringify(signal)} --root ${JSON.stringify(state.root)} --milestone M7 \\
    --status green --terminal-reason green \\
    --suite-status suite-status.json \\
    --suite-observations receipts/m7-suite.observations.jsonl \\
    --choreography-receipt receipts/m7-choreography.jsonl \\
    --choreography-observations receipts/m7-choreography.jsonl.observations.jsonl

For a terminal failure, signal aborted/abort or capability-failure with wall-cap
or token-cap and retain every sidecar that exists.
`;
}

function recordBase(
  config,
  renderedPrompt,
  promptPath,
  instrumentManifest,
  instrumentManifestText,
) {
  const journey = resolveCellJourney(config);
  const promptBytes = Buffer.byteLength(renderedPrompt);
  const promptDigest = sha256(renderedPrompt);
  const assertion = instrumentManifest.artifacts.assertions;
  const milestones = Object.fromEntries(config.milestones.map((milestone) => [
    milestone,
    {
      caps: {
        wallCapSeconds: config.harnessConfig.execution.perMilestoneWallSafetyLimitSeconds,
        tokenCap: configuredTokenCap(config, milestone),
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
      typingObservationBoundaryVersion: CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION,
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
      runScope: journey.runScope,
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
      clocks: {
        grading: { sessions: [{ wallSeconds: 0, tokens: nullCounts() }] },
        ...(journey.runScope === "full" ? {
          replay: {
            attempted: false,
            wallSeconds: null,
            capSeconds: null,
            capFractionUsed: null,
            capExhausted: null,
            probeWallSecondsExcluded: null,
          },
          m7Session: { wallSeconds: null, tokens: nullCounts() },
        } : {}),
      },
      grading: {
        graderReportPath: null,
        graderFamily: null,
        sameFamilyGraded: false,
        usableGradingRecord: false,
      },
    },
  };
}

function configuredTokenCap(config, milestone) {
  const registration = config.harnessConfig?.execution?.tokenCapsByLeg?.[config.cell.leg];
  if (registration === undefined) return null;
  if (
    registration.capFamily !== capFamily(config.cell.harness)
    || !Object.hasOwn(registration.perMilestone, milestone)
  ) {
    throw new Error(`R2_DRIVER_TOKEN_CAP_REGISTRATION: ${config.cell.id}/${milestone} has no exact leg cap`);
  }
  const cap = registration.perMilestone[milestone];
  if (cap !== null && (!Number.isInteger(cap) || cap <= 0)) {
    throw new Error(`R2_DRIVER_TOKEN_CAP_REGISTRATION: ${config.cell.id}/${milestone} cap is invalid`);
  }
  return cap;
}

function harnessInvocation(state) {
  const argv = [...(state.config.harness.argvTemplate ?? [])];
  const promptFile = state.currentSession.promptPath;
  const promptMode = state.config.harness.promptDelivery;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "{renderedPrompt}") argv[index] = promptFile;
  }
  if (state.config.cell.harness === "claude-opus5") {
    argv.push(
      "--session-id",
      state.currentSession.nativeSessionId,
      state.currentSession.renderedPrompt,
    );
  }
  return {
    binary: requiredString(state.config.harness.binary, "harness.binary"),
    argv,
    stdin: promptMode === "stdin" ? state.currentSession.renderedPrompt : null,
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

async function terminateNativeProcessTree(state, reason = "controller-stop") {
  const child = state?.child;
  if (!child || !Number.isInteger(child.pid) || child.exitCode !== null || child.signalCode !== null) {
    return {
      acknowledged: true,
      acknowledgedAt: new Date().toISOString(),
      evidence: `no-live-native-process:${reason}`,
    };
  }
  const signalTree = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") child.kill(signal);
    }
  };
  signalTree("SIGTERM");
  let closed = await Promise.race([
    state.closed.then(() => true),
    new Promise((resolveWait) => setTimeout(() => resolveWait(false), 5_000)),
  ]);
  if (!closed) {
    signalTree("SIGKILL");
    closed = await Promise.race([
      state.closed.then(() => true),
      new Promise((resolveWait) => setTimeout(() => resolveWait(false), 5_000)),
    ]);
  }
  if (!closed) throw new Error("R2_DRIVER_PROCESS_TERMINATION: native process tree did not close");
  return {
    acknowledged: true,
    acknowledgedAt: new Date().toISOString(),
    evidence: `isolated-native-process-group:${child.pid}:${reason}`,
  };
}

function observeUsageTurns(state, turns) {
  if (!state.tokenWatchdog) return;
  for (const turn of turns) state.tokenWatchdog.observe(turn, { inFlight: true });
}

function createSessionTokenWatchdog(state) {
  return new TokenCapWatchdog({
    enforcementController: {
      id: "social-messenger-r2-native-process-group-controller.v1",
      terminate: (trip) => terminateNativeProcessTree(state, `${trip.milestone}-token-cap`),
    },
  });
}

function ensureSessionTokenWatchdog(state) {
  requiredString(state.currentSession?.sourceId, "native session sourceId");
  if (state.tokenWatchdogSessionSourceId === state.currentSession.sourceId) return;
  if (state.tokenWatchdog !== null && state.tokenWatchdog !== undefined && state.tokenWatchdog.state !== null) {
    throw new Error("R2_DRIVER_TOKEN_WATCHDOG_SESSION: native session changed with an armed milestone");
  }
  state.tokenWatchdog = createSessionTokenWatchdog(state);
  state.tokenWatchdogSessionSourceId = state.currentSession.sourceId;
  state.settledUsage = { turnIds: new Set(), usageRecordOrdinal: null };
}

async function pollNativeUsage(state) {
  if (state.tokenWatchdog?.state?.armed !== true || state.config.cell.harness !== "codex-sol") return;
  const records = await (state.readLiveCodexRecords ?? readLiveCodexRecords)(state);
  if (records === null) return;
  const adapted = adaptCodexSessionTree([{
    sourceId: state.currentSession.sourceId,
    nativeSessionId: state.currentSession.nativeSessionId,
    records,
  }]);
  observeUsageTurns(state, adapted.turns);
}

function settlementDeadline(state) {
  const capSeconds = state.config.harnessConfig?.execution
    ?.perMilestoneWallSafetyLimitSeconds;
  if (!Number.isFinite(capSeconds) || capSeconds <= 0) {
    throw new Error(
      "R2_DRIVER_USAGE_SETTLEMENT_TIMEOUT: native usage settlement requires a positive recorded wall cap",
    );
  }
  const now = state.now ?? Date.now;
  const startedAtMs = now();
  return {
    now,
    deadlineMs: startedAtMs + capSeconds * 1_000,
    deadlineAt: new Date(startedAtMs + capSeconds * 1_000).toISOString(),
    capSeconds,
  };
}

async function settlementPause(state, remainingMs) {
  const sleep = state.settlementSleep
    ?? ((millis) => new Promise((resolveWait) => setTimeout(resolveWait, millis)));
  await sleep(Math.min(250, remainingMs));
}

function retainedTurnTokens(turns) {
  return turns.reduce((total, turn) => {
    const tokens = capTokenCount(turn.usage);
    if (tokens === null) {
      throw new Error(`R2_DRIVER_USAGE_SETTLEMENT_INVALID: ${turn.id} lacks cap-bearing usage`);
    }
    return total + tokens;
  }, 0);
}

async function waitForCodexMilestoneUsage(state, marker) {
  const deadline = settlementDeadline(state);
  while (true) {
    const records = await (state.readLiveCodexRecords ?? readLiveCodexRecords)(state);
    if (records !== null) {
      const adapted = adaptCodexSessionTree([{
        sourceId: state.currentSession.sourceId,
        nativeSessionId: state.currentSession.nativeSessionId,
        records,
      }]);
      observeUsageTurns(state, adapted.turns);
      try {
        const recovery = recoverCodexSignalSettlements({
          records,
          boundaryValue: {
            [marker.milestone]: {
              status: marker.status,
              terminalAt: marker.recordedAt,
              terminalSequence: 1,
            },
          },
          closingSettlementSelection: "first",
          allowTrailingUsage: true,
          allowOpenWithoutTaskComplete: true,
        });
        const settlement = recovery.usageSettlements[0];
        const lowerOrdinal = state.settledUsage.usageRecordOrdinal;
        const retainedTurns = adapted.turns.filter((turn) => (
          Number.isInteger(turn.nativeRecordOrdinal)
          && turn.nativeRecordOrdinal <= settlement.usageRecordOrdinal
          && (lowerOrdinal === null || turn.nativeRecordOrdinal > lowerOrdinal)
        ));
        if (!retainedTurns.some((turn) => (
          turn.nativeRecordOrdinal === settlement.usageRecordOrdinal
        ))) {
          throw new Error(
            `${marker.milestone} settlement token_count does not produce an independently retained usage turn`,
          );
        }
        return {
          retainedTokens: retainedTurnTokens(retainedTurns),
          usageSettledAt: settlement.usageSettledAt,
          commit: () => {
            state.settledUsage.usageRecordOrdinal = settlement.usageRecordOrdinal;
            for (const turn of retainedTurns) state.settledUsage.turnIds.add(turn.id);
          },
        };
      } catch (error) {
        if (
          !/exactly one successful .* signal|no native token_count settlement after its signal/u
            .test(error.message)
        ) {
          throw error;
        }
      }
    }
    const remainingMs = deadline.deadlineMs - deadline.now();
    if (remainingMs <= 0) {
      const error = new Error(
        `R2_DRIVER_USAGE_SETTLEMENT_TIMEOUT: no post-${marker.milestone} native usage before ${deadline.deadlineAt}`,
      );
      error.code = "R2_DRIVER_USAGE_SETTLEMENT_TIMEOUT";
      error.rootCauseClass = "native-usage-settlement-timeout";
      error.capSeconds = deadline.capSeconds;
      error.deadlineAt = deadline.deadlineAt;
      throw error;
    }
    await settlementPause(state, remainingMs);
  }
}

async function readLiveClaudeRecords(state) {
  await state.streamWriteQueue;
  if (state.currentSession.stdoutPath === null) return null;
  const text = await readFile(state.currentSession.stdoutPath, "utf8");
  if (!text.endsWith("\n")) return null;
  return parseJsonLines(text, state.currentSession.stdoutPath);
}

async function waitForClaudeMilestoneUsage(state, marker) {
  const deadline = settlementDeadline(state);
  let markerTurnNativeId = null;
  while (true) {
    const records = await (state.readLiveClaudeRecords ?? readLiveClaudeRecords)(state);
    if (records !== null) {
      const markerRecord = records.findLast((record) => {
        const command = commandFrom(record);
        if (typeof command !== "string") return false;
        const matched = command.match(
          /\br2-cell-signal(?:\.mjs)?\b[\s\S]*?--milestone(?:=|\s+)["']?(M[1-8])\b/u,
        );
        return matched?.[1] === marker.milestone
          && typeof record?.message?.id === "string";
      });
      if (markerRecord !== undefined) markerTurnNativeId = markerRecord.message.id;
      const adapted = adaptClaudeSession(records);
      observeUsageTurns(state, adapted.turns);
      const retainedTurns = adapted.turns.filter((turn) => !state.settledUsage.turnIds.has(turn.id));
      const settledTurn = retainedTurns.findLast((turn) => turn.nativeId === markerTurnNativeId);
      if (settledTurn !== undefined) {
        const retainedThroughMarkerTurn = retainedTurns.filter((turn) => (
          Date.parse(turn.completedAt) <= Date.parse(settledTurn.completedAt)
        ));
        return {
          retainedTokens: retainedTurnTokens(retainedThroughMarkerTurn),
          usageSettledAt: settledTurn.completedAt,
          commit: () => {
            for (const turn of retainedThroughMarkerTurn) state.settledUsage.turnIds.add(turn.id);
          },
        };
      }
    }
    const remainingMs = deadline.deadlineMs - deadline.now();
    if (remainingMs <= 0) {
      const error = new Error(
        `R2_DRIVER_USAGE_SETTLEMENT_TIMEOUT: no usage settlement for the ${marker.milestone} `
        + `marker-writing Claude assistant turn before ${deadline.deadlineAt}`,
      );
      error.code = "R2_DRIVER_USAGE_SETTLEMENT_TIMEOUT";
      error.rootCauseClass = "native-usage-settlement-timeout";
      error.capSeconds = deadline.capSeconds;
      error.deadlineAt = deadline.deadlineAt;
      error.milestone = marker.milestone;
      throw error;
    }
    await settlementPause(state, remainingMs);
  }
}

async function waitForMilestoneUsage(state, marker) {
  if (state.tokenWatchdog?.state?.armed !== true) return null;
  if (state.config.cell.harness === "codex-sol") {
    return waitForCodexMilestoneUsage(state, marker);
  }
  if (state.config.cell.harness === "claude-opus5") {
    return waitForClaudeMilestoneUsage(state, marker);
  }
  throw new Error(`R2_DRIVER_USAGE_SETTLEMENT_UNSUPPORTED: ${state.config.cell.harness}`);
}

async function finishTokenWatchdog(state, marker) {
  let retained;
  try {
    retained = await waitForMilestoneUsage(state, marker);
  } catch (error) {
    error.milestone ??= marker.milestone;
    throw error;
  }
  if (state.usageFailure) throw state.usageFailure;
  const watchdogState = state.tokenWatchdog?.state;
  if (watchdogState?.tripped === true) {
    const acknowledgement = await state.tokenWatchdog.waitForTermination();
    state.failureDisposition = "token-cap";
    throw new TokenCapEnforcedError(watchdogState.trip, acknowledgement);
  }
  if (watchdogState?.armed === true) {
    state.tokenWatchdog.reconcileMilestone({
      retainedTokens: retained.retainedTokens,
      terminalAt: retained.usageSettledAt,
    });
    retained.commit();
  }
  const completed = state.tokenWatchdog?.disarm();
  if (completed !== undefined) {
    state.tokenWatchdogHistory ??= [];
    state.tokenWatchdogHistory.push(completed);
  }
}

function handleNativeRecord(state, record) {
  if (
    state.config.cell.harness === "codex-sol"
    && record?.type === "thread.started"
    && typeof record.thread_id === "string"
  ) {
    state.currentSession.nativeSessionId = record.thread_id;
    state.nativeSessionId = record.thread_id;
  }
  if (state.config.cell.harness === "claude-opus5" && state.tokenWatchdog) {
    try {
      observeUsageTurns(state, adaptClaudeSession([record]).turns);
    } catch (error) {
      state.usageFailure ??= error;
    }
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
  const suffix = state.currentSession.sourceId === "builder"
    && state.journey.runScope === "reduced"
    ? ""
    : `.${state.currentSession.sourceId}`;
  const stdoutPath = join(state.root, "events", `harness${suffix}.stdout.jsonl`);
  const stderrPath = join(state.root, "events", `harness${suffix}.stderr.log`);
  await writeFile(stdoutPath, "", "utf8");
  await writeFile(stderrPath, "", "utf8");
  state.currentSession.startedAt = new Date().toISOString();
  state.currentSession.stdoutPath = stdoutPath;
  state.currentSession.stderrPath = stderrPath;
  const child = spawn(invocation.binary, invocation.argv, {
    cwd: state.root,
    env: {
      ...scrubR2NodeLoaderEnvironment(process.env),
      R2_LANE_RUN_ID: state.config.laneRunId,
    },
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  state.child = child;
  state.currentSession.child = child;
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
  state.currentSession.pid = child.pid;
  state.sessionRuns.push(state.currentSession);
  const ownershipPath = join(state.root, "process-ownership.json");
  try {
    const ownership = JSON.parse(await readFile(ownershipPath, "utf8"));
    ownership.nativeHarnessPid = child.pid;
    ownership.nativeHarnessPids = [...new Set([
      ...(ownership.nativeHarnessPids ?? []),
      child.pid,
    ])];
    ownership.nativeHarnessProcessGroupIds = [...new Set([
      ...(ownership.nativeHarnessProcessGroupIds ?? []),
      child.pid,
    ])];
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

async function beginFreshM7Session(state) {
  const continuousExit = await state.exit;
  await state.closed;
  await state.streamWriteQueue;
  if (continuousExit.error || continuousExit.code !== 0) {
    throw new Error(
      `continuous native ${state.config.cell.harness} CLI exited ${continuousExit.error ?? continuousExit.code ?? continuousExit.signal}`,
    );
  }
  const renderedPrompt = await renderFreshM7Prompt(state);
  const promptPath = join(state.root, "rendered-m7-prompt.md");
  await writeFile(promptPath, renderedPrompt, { encoding: "utf8", flag: "wx" });
  state.m7Handoff = {
    source: state.m7HandoffSource,
    renderedPrompt: await retainedDescriptor(state.root, promptPath),
    contextPolicy: "fresh-native-session-handoff-only.v1",
    backendState: "fresh-starter-only-pre-replay",
  };
  state.currentSession = {
    kind: "fresh-m7",
    sourceId: "fresh-m7",
    parentSourceId: "builder",
    role: "builder-descendant",
    nativeSessionId: randomUUID(),
    renderedPrompt,
    promptPath,
    startedAt: null,
    stdoutPath: null,
    stderrPath: null,
    pid: null,
    child: null,
  };
  state.nativeSessionId = state.currentSession.nativeSessionId;
  state.child = null;
  state.exit = null;
  state.closed = null;
  state.tokenWatchdogSessionSourceId = null;
  ensureSessionTokenWatchdog(state);
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
    await pollNativeUsage(state);
    if (state.usageFailure) throw state.usageFailure;
    if (state.tokenWatchdog?.state?.tripped === true) {
      const acknowledgement = await state.tokenWatchdog.waitForTermination();
      state.failureDisposition = "token-cap";
      throw new TokenCapEnforcedError(state.tokenWatchdog.state.trip, acknowledgement);
    }
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

async function waitForScaleReplay(state, { notBefore }) {
  const path = join(state.root, "scale-replay.json");
  while (true) {
    try {
      const status = await lstat(path);
      if (status.isSymbolicLink() || !status.isFile()) {
        throw new Error("R2_DRIVER_SCALE_REPLAY: scale-replay.json must be a regular non-symlink file");
      }
      const bytes = await readFile(path);
      const value = JSON.parse(bytes.toString("utf8"));
      const receiptPath = resolve(
        state.root,
        requiredString(value.receipt?.path, "scale replay receipt.path"),
      );
      const logicalReceiptPath = logicalPath(state.root, receiptPath);
      const receiptStatus = await lstat(receiptPath);
      if (receiptStatus.isSymbolicLink() || !receiptStatus.isFile()) {
        throw new Error("R2_DRIVER_SCALE_REPLAY: replay receipt must be a regular non-symlink file");
      }
      const receiptBytes = await readFile(receiptPath);
      const receiptSha256 = sha256Prefixed(receiptBytes);
      if (receiptSha256 !== value.receipt.sha256) {
        throw new Error("R2_DRIVER_SCALE_REPLAY: replay receipt differs from its declared SHA-256");
      }
      const replay = validateScaleReplayEvidence(
        value,
        JSON.parse(receiptBytes.toString("utf8")),
      );
      if (Date.parse(replay.firstStartedAt) < Date.parse(notBefore)) {
        throw new Error(
          "R2_DRIVER_SCALE_REPLAY: scale replay starts before M8 native usage settles",
        );
      }
      state.scaleReplay = {
        clock: replay.clock,
        attempts: replay.attempts,
        receipt: { path: logicalReceiptPath, sha256: receiptSha256 },
        artifact: { path: "scale-replay.json", sha256: sha256Prefixed(bytes) },
      };
      return state.scaleReplay;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const exit = await Promise.race([
      state.exit.then((value) => ({ type: "exit", value })),
      new Promise((resolveWait) => setTimeout(() => resolveWait({ type: "poll" }), 250)),
    ]);
    if (exit.type === "exit") {
      throw new Error(
        `R2_DRIVER_SCALE_REPLAY: continuous native session exited before scale-replay.json (${JSON.stringify(exit.value)})`,
      );
    }
  }
}

async function retainScaleReplayFailure(state, error, startedAt, {
  outcome = "aborted",
  capSeconds = null,
  deadlineAt = null,
  cause = null,
} = {}) {
  const finishedAt = new Date().toISOString();
  const wallSeconds = Math.max(0, (Date.parse(finishedAt) - Date.parse(startedAt)) / 1_000);
  const value = {
    version: "snapback.full-journey-scale-replay-failure.v1",
    outcome,
    startedAt,
    finishedAt,
    ...(deadlineAt === null ? {} : { deadlineAt }),
    clock: {
      attempted: true,
      wallSeconds,
      capSeconds,
      capFractionUsed: capSeconds === null ? null : wallSeconds / capSeconds,
      capExhausted: capSeconds === null ? null : wallSeconds >= capSeconds,
      probeWallSecondsExcluded: 0,
    },
    failure: {
      name: error?.name ?? "Error",
      message: error?.message ?? String(error),
      ...(cause === null ? {} : { cause }),
    },
  };
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const path = join(state.root, "scale-replay-failure.json");
  await writeFile(path, bytes, { flag: "wx" });
  state.scaleReplayFailure = {
    value,
    artifact: { path: "scale-replay-failure.json", sha256: sha256Prefixed(bytes) },
  };
  state.failureDisposition = outcome === "settlement-timeout"
    ? "scale-replay-settlement-timeout"
    : "scale-replay-aborted";
  return state.scaleReplayFailure;
}

async function releaseNativeSignalForExecutionOrder(state, milestone) {
  const numericNext = `M${Number(milestone.slice(1)) + 1}`;
  const configuredNext = state.config.milestones[
    state.config.milestones.indexOf(milestone) + 1
  ];
  if (numericNext !== configuredNext && numericNext !== "M4") {
    await writeFile(join(state.root, "gates", numericNext), `${new Date().toISOString()}\n`);
  }
}

async function findCodexRolloutPath(nativeSession) {
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
        if (status.mtimeMs >= Date.parse(nativeSession.startedAt) - 5_000) candidates.push(path);
      }
    }
  }
  await visit(join(searchRoot, "sessions"));
  for (const path of candidates.sort()) {
    const text = await readFile(path, "utf8");
    const meta = text.split(/\r?\n/u).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).find((record) => record?.type === "session_meta" && typeof record?.payload?.id === "string");
    if (meta?.payload.id === nativeSession.nativeSessionId) return path;
  }
  return null;
}

async function readLiveCodexRecords(state) {
  const path = state.currentSession.nativeRolloutPath
    ?? await findCodexRolloutPath(state.currentSession);
  if (path === null) return null;
  state.currentSession.nativeRolloutPath = path;
  const text = await readFile(path, "utf8");
  if (!text.endsWith("\n")) return null;
  return parseJsonLines(text, path);
}

// @ref LLP 0201#d2--quantitative-instrument — replay cannot begin until the
// same first post-M8 native token_count that closes continuous authoring has
// been observed. Reuse authoritative recovery so execution and finalization
// cannot disagree about that boundary.
async function waitForM8UsageSettlement(state, marker) {
  const capSeconds = state.config.harnessConfig?.execution
    ?.perMilestoneWallSafetyLimitSeconds;
  if (!Number.isFinite(capSeconds) || capSeconds <= 0) {
    throw new Error("R2_DRIVER_M8_SETTLEMENT_TIMEOUT: replay settlement wait requires a positive recorded wall cap");
  }
  const startedAt = new Date().toISOString();
  const deadlineMs = Date.parse(startedAt) + capSeconds * 1_000;
  const deadlineAt = new Date(deadlineMs).toISOString();
  while (true) {
    const records = await (state.readLiveCodexRecords ?? readLiveCodexRecords)(state);
    if (records !== null) {
      try {
        const recovery = recoverCodexSignalSettlements({
          records,
          boundaryValue: {
            M8: {
              status: marker.status,
              terminalAt: marker.recordedAt,
              terminalSequence: 1,
            },
          },
          closingSettlementSelection: "first",
          allowTrailingUsage: true,
          allowOpenWithoutTaskComplete: true,
        });
        return recovery.usageSettlements[0];
      } catch (error) {
        if (!/exactly one successful M8 signal|no native token_count settlement/u.test(error.message)) {
          throw error;
        }
      }
    }
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      const error = new Error(
        `R2_DRIVER_M8_SETTLEMENT_TIMEOUT: no post-M8 token_count before the recorded replay wall-cap deadline ${deadlineAt}`,
      );
      error.code = "R2_DRIVER_M8_SETTLEMENT_TIMEOUT";
      error.causeCode = "missing-post-m8-token-count";
      error.startedAt = startedAt;
      error.deadlineAt = deadlineAt;
      error.capSeconds = capSeconds;
      throw error;
    }
    const exit = await Promise.race([
      state.exit.then((value) => ({ type: "exit", value })),
      new Promise((resolveWait) => setTimeout(
        () => resolveWait({ type: "poll" }),
        Math.min(250, remainingMs),
      )),
    ]);
    if (exit.type === "exit") {
      throw new Error(
        `R2_DRIVER_SCALE_REPLAY: continuous native session exited before M8 usage settlement (${JSON.stringify(exit.value)})`,
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

async function findCodexRollout(state, nativeSession) {
  const path = nativeSession.nativeRolloutPath ?? await findCodexRolloutPath(nativeSession);
  if (path !== null) {
    nativeSession.nativeRolloutPath = path;
    const text = await readFile(path, "utf8");
    const meta = text.split(/\r?\n/u).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).find((record) => record?.type === "session_meta" && typeof record?.payload?.id === "string");
    const target = join(
      state.root,
      "events",
      nativeSession.sourceId === "builder" && state.journey.runScope === "reduced"
        ? "codex-rollout.jsonl"
        : `codex-rollout.${nativeSession.sourceId}.jsonl`,
    );
    await copyFile(path, target);
    return {
      sourceId: nativeSession.sourceId,
      parentSourceId: nativeSession.parentSourceId,
      role: nativeSession.role,
      startedAt: nativeSession.startedAt,
      nativeSessionId: meta.payload.id,
      nativeAgentId: null,
      ...(await retainedDescriptor(state.root, target)),
    };
  }
  return null;
}

async function meteringSession(state) {
  if (state.config.cell.harness === "grok-46") return null;
  if (state.config.cell.harness === "codex-sol") {
    const sessions = [];
    for (const nativeSession of state.sessionRuns) {
      const retained = await findCodexRollout(state, nativeSession);
      if (retained === null) return null;
      sessions.push(retained);
    }
    return { adapter: "codex", sessions, unavailableReason: null };
  }
  const sessions = [];
  for (const nativeSession of state.sessionRuns) {
    const text = await readFile(nativeSession.stdoutPath, "utf8");
    const records = text.split(/\r?\n/u).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    const carriesSession = records.some((record) => (
      record.sessionId === nativeSession.nativeSessionId
      || record.session_id === nativeSession.nativeSessionId
    ));
    const carriesUsage = records.some((record) => record?.message?.usage);
    if (!carriesSession || !carriesUsage) return null;
    sessions.push({
      sourceId: nativeSession.sourceId,
      parentSourceId: nativeSession.parentSourceId,
      role: nativeSession.role,
      startedAt: nativeSession.startedAt,
      nativeSessionId: nativeSession.nativeSessionId,
      nativeAgentId: null,
      ...(await retainedDescriptor(state.root, nativeSession.stdoutPath)),
    });
  }
  return { adapter: "claude", sessions, unavailableReason: null };
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
  if (error && state.currentMilestone && !state.failureDisposition?.startsWith("scale-replay-")) {
    const existing = markers.find((item) => item.milestone === state.currentMilestone);
    const failureDisposition = error?.code === "SOCIAL_MESSENGER_TOKEN_CAP_ENFORCED"
      ? "token-cap"
      : error?.code === "R3_CELL_WALL_CAP_TIMEOUT"
        ? "wall-cap"
        : error?.code === "R2_DRIVER_USAGE_SETTLEMENT_TIMEOUT"
          ? "native-usage-settlement-timeout"
        : null;
    if (failureDisposition !== null) state.failureDisposition = failureDisposition;
    const failure = {
      milestone: state.currentMilestone,
      status: failureDisposition === null ? "aborted" : "capability-failure",
      terminalReason: failureDisposition ?? "abort",
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
    driverId: state.journey.driverId,
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
    const fileChangeEvents = [];
    for (const nativeSession of session.sessions) {
      const rolloutPath = resolve(state.root, nativeSession.path);
      const records = parseJsonLines(
        await readFile(rolloutPath, "utf8"),
        nativeSession.path,
      );
      const sessionMilestones = nativeSession.sourceId === "fresh-m7"
        ? ["M7"]
        : state.journey.continuous;
      const sessionBoundaries = {
        ...boundaries,
        milestones: Object.fromEntries(sessionMilestones.flatMap((milestone) => (
          boundaries.milestones[milestone] === undefined
            ? []
            : [[milestone, boundaries.milestones[milestone]]]
        ))),
      };
      if (Object.keys(sessionBoundaries.milestones).length > 0) {
        const replayFailed = state.journey.runScope === "full"
          && nativeSession.sourceId === "builder"
          && state.scaleReplayFailure !== null;
        const settlementTimedOut = replayFailed
          && state.scaleReplayFailure.value.outcome === "settlement-timeout";
        recoverCodexSignalSettlements({
          records,
          boundaryValue: sessionBoundaries,
          streamClosedAt: replayFailed
            || Object.values(sessionBoundaries.milestones)
              .some((boundary) => boundary.status !== "green")
            ? driverFinalizedAt
            : null,
          ...(state.journey.runScope === "full" && nativeSession.sourceId === "builder"
            ? {
                closingSettlementSelection: "first",
                allowTrailingUsage: true,
                ...(replayFailed ? { allowClosedWithoutTaskComplete: true } : {}),
                ...(settlementTimedOut ? { allowMissingClosingSettlement: true } : {}),
              }
            : {}),
        });
      }
      const recoveredFileChanges = recoverCodexFileChanges({
        records,
        boundaryValue: boundaries,
        laneRunId: state.config.laneRunId,
        productRoot: state.root,
        sourceId: nativeSession.sourceId,
        nativeSessionId: nativeSession.nativeSessionId,
        nativeStreamSha256: nativeSession.sha256,
      });
      fileChangeEvents.push(...recoveredFileChanges.events);
      if (
        recoveredFileChanges.firstProductEdit !== null
        && (
          firstProductEdit === null
          || Date.parse(recoveredFileChanges.firstProductEdit.at) < Date.parse(firstProductEdit.at)
        )
      ) {
        firstProductEdit = recoveredFileChanges.firstProductEdit;
      }
    }
    if (fileChangeEvents.length > 0) {
      fileChangeEvents.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
      const fileChangePath = join(state.root, "events", "codex-file-change-observations.jsonl");
      await writeFile(
        fileChangePath,
        `${fileChangeEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
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
  if (state.journey.runScope === "full") {
    const m8Green = markers.some((marker) => marker.milestone === "M8" && marker.status === "green");
    if (m8Green && state.scaleReplay === null && state.scaleReplayFailure === null) {
      throw new Error("R2_DRIVER_SCALE_REPLAY: full journey cannot finalize without scale replay custody");
    }
    if (state.scaleReplay !== null) {
      base.socialMessenger.clocks.replay = state.scaleReplay.clock;
    }
    if (state.scaleReplayFailure !== null) {
      base.socialMessenger.clocks.replay = state.scaleReplayFailure.value.clock;
      base.socialMessenger.termination.reason = state.failureDisposition;
    }
  }
  if (state.failureDisposition !== null) {
    base.socialMessenger.termination.reason = state.failureDisposition;
  }
  const retainedSetups = receipts
    .map((receipt) => receipt.summary?.setup)
    .filter((setup) => setup !== undefined);
  if (retainedSetups.length > 0) {
    const canonicalSetup = JSON.stringify(retainedSetups[0]);
    if (retainedSetups.some((setup) => JSON.stringify(setup) !== canonicalSetup)) {
      throw new Error("choreography summaries disagree on structured setup identity");
    }
    base.socialMessenger.setup = retainedSetups[0];
  }
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
    ...(state.m7Handoff === null ? {} : { freshSessionHandoff: state.m7Handoff }),
    ...(state.scaleReplay === null ? {} : { scaleReplay: {
      ...state.scaleReplay.artifact,
      clock: state.scaleReplay.clock,
      attempts: state.scaleReplay.attempts,
      receipt: state.scaleReplay.receipt,
    } }),
    ...(state.scaleReplayFailure === null
      ? {}
      : { scaleReplayFailure: {
          ...state.scaleReplayFailure.artifact,
          outcome: state.scaleReplayFailure.value.outcome,
        } }),
    driver: {
      id: state.journey.driverId,
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
    pids: ownership.nativeHarnessPids ?? [ownership.nativeHarnessPid],
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
  const journey = resolveCellJourney(config);
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
    journey,
  };
}

export async function prepare({
  config,
  configDirectory,
  preflight: prepared = null,
  abortSignal = null,
  transition = null,
  mutationGuard = ALLOW_CELL_MUTATIONS,
}) {
  const cancellation = { abortSignal, transition };
  transitionStage(cancellation, "prepare-preflight");
  const plan = prepared ?? await preflight({ config, configDirectory });
  const root = resolve(configDirectory);
  mutationGuards.set(root, mutationGuard);
  if (plan.version !== "social-messenger-r2-driver-preflight.v1" || plan.root !== root) {
    throw new Error("R2 production driver requires its exact pre-attempt preflight result");
  }
  transitionStage(cancellation, "prepare-directories");
  await mkdir(join(root, "events"), { recursive: true });
  await mkdir(join(root, "receipts"), { recursive: true });
  await mkdir(join(root, "gates"), { recursive: true });
  const {
    renderedPrompt,
    promptPath,
    instrumentManifest,
    instrumentManifestText,
  } = plan;
  const initialSessionId = randomUUID();
  transitionStage(cancellation, "prepare-prompt-and-instrument-write");
  await writeFile(promptPath, renderedPrompt, "utf8");
  await writeFile(join(root, "instrument.manifest.json"), instrumentManifestText, "utf8");
  const retainedAssertionPath = join(root, instrumentManifest.artifacts.assertions.path);
  transitionStage(cancellation, "prepare-assertion-write");
  await mkdir(dirname(retainedAssertionPath), { recursive: true });
  await writeFile(retainedAssertionPath, plan.assertionBytes, { flag: "wx" });
  transitionStage(cancellation, "prepare-record-base-write");
  await writeFile(
    join(root, "record-base.json"),
    `${JSON.stringify(plan.recordBase, null, 2)}\n`,
  );
  transitionStage(cancellation, "prepare-state-install");
  states.set(config.laneRunId, {
    config,
    root,
    journey: plan.journey ?? resolveCellJourney(config),
    renderedPrompt,
    promptPath,
    startedAt: new Date().toISOString(),
    nativeSessionId: initialSessionId,
    currentSession: {
      kind: plan.recordBase.socialMessenger.runScope === "reduced" ? "reduced" : "continuous",
      sourceId: "builder",
      parentSourceId: null,
      role: "builder",
      nativeSessionId: initialSessionId,
      renderedPrompt,
      promptPath,
      startedAt: null,
      stdoutPath: null,
      stderrPath: null,
      pid: null,
      child: null,
    },
    sessionRuns: [],
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
    m7HandoffSource: null,
    m7Handoff: null,
    scaleReplay: null,
    scaleReplayFailure: null,
    failureDisposition: null,
    tokenWatchdog: null,
    tokenWatchdogSessionSourceId: null,
    settledUsage: { turnIds: new Set(), usageRecordOrdinal: null },
    tokenWatchdogHistory: [],
    usageFailure: null,
  });
  const state = states.get(config.laneRunId);
  ensureSessionTokenWatchdog(state);
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

export async function runMilestone({
  milestone,
  controls,
  config,
  abortSignal = null,
  transition = null,
}) {
  const cancellation = { abortSignal, transition };
  transitionStage(cancellation, `${milestone}-enter`);
  const state = states.get(config.laneRunId);
  if (!state) throw new Error("R2 production driver was not prepared");
  state.currentMilestone = milestone;
  state.controls = controls;
  if (
    milestone === "M7"
    && state.journey.runScope === "full"
    && state.currentSession.kind !== "fresh-m7"
  ) {
    transitionStage(cancellation, `${milestone}-fresh-session`);
    await beginFreshM7Session(state);
  }
  transitionStage(cancellation, `${milestone}-watchdog-arm`);
  ensureSessionTokenWatchdog(state);
  const tokenCap = configuredTokenCap(config, milestone);
  state.tokenWatchdog.arm({
    capFamily: capFamily(config.cell.harness),
    milestone,
    tokenCap,
    startedAt: new Date().toISOString(),
    maxClockSkewMs: config.cell.harness === "codex-sol" ? 5_000 : 0,
  });
  transitionStage(cancellation, `${milestone}-gate-write`);
  await writeFile(join(state.root, "gates", milestone), `${new Date().toISOString()}\n`);
  if (state.child === null) {
    transitionStage(cancellation, `${milestone}-native-launch`);
    await controls.apiRequest({
      provider: config.cell.harness,
      operation: state.currentSession.kind === "fresh-m7"
        ? "launch-fresh-m7-session"
        : "launch-native-cell",
      requestId: `launch-${config.cell.id}-${state.currentSession.sourceId}`,
      retryOf: null,
    }, () => launchHarness(state));
    transitionStage(cancellation, `${milestone}-launch-observation-write`);
    await controls.semanticAction({
      actionId: `native-${milestone.toLowerCase()}-${++state.actionSequence}`,
      actionClass: "process",
      disposition: "progress",
      episodeId: null,
      retriedClass: null,
      binaryExcavation: false,
    });
  }
  transitionStage(cancellation, `${milestone}-marker-wait`);
  const marker = await waitForMarker(state, milestone);
  transitionStage(cancellation, `${milestone}-usage-settlement`);
  await finishTokenWatchdog(state, marker);
  transitionStage(cancellation, `${milestone}-execution-order-release`);
  await releaseNativeSignalForExecutionOrder(state, milestone);
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
  if (milestone === "M8" && state.journey.runScope === "full" && marker.status === "green") {
    transitionStage(cancellation, `${milestone}-scale-replay-settlement`);
    let settlement;
    try {
      settlement = await waitForM8UsageSettlement(state, marker);
    } catch (error) {
      if (error.code === "R2_DRIVER_M8_SETTLEMENT_TIMEOUT") {
        await retainScaleReplayFailure(state, error, error.startedAt, {
          outcome: "settlement-timeout",
          capSeconds: error.capSeconds,
          deadlineAt: error.deadlineAt,
          cause: error.causeCode,
        });
      }
      throw error;
    }
    const replayStartedAt = new Date(Math.max(
      Date.now(),
      Date.parse(settlement.usageSettledAt),
    )).toISOString();
    try {
      transitionStage(cancellation, `${milestone}-scale-replay-launch`);
      await waitForScaleReplay(state, { notBefore: settlement.usageSettledAt });
    } catch (error) {
      await retainScaleReplayFailure(state, error, replayStartedAt);
      throw error;
    }
  }
  if (milestone === config.milestones.at(-1)) {
    transitionStage(cancellation, `${milestone}-native-exit-custody`);
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
    await terminateNativeProcessTree(state, "driver-finalize-error");
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

export async function terminate({ config, reason }) {
  const state = states.get(config.laneRunId);
  return terminateNativeProcessTree(state, reason?.code ?? "controller-timeout");
}

export function observationSources({ config }) {
  const state = states.get(config.laneRunId);
  return state?.observationSources ?? [];
}

export const r2CellDriverTestHooks = Object.freeze({
  beginFreshM7Session,
  ensureSessionTokenWatchdog,
  finishTokenWatchdog,
  handleNativeRecord,
  renderFreshM7Prompt,
  installMutationGuard(root, mutationGuard) {
    mutationGuards.set(resolve(root), mutationGuard);
  },
  guardedWriteFile(path, bytes) {
    return writeFile(path, bytes);
  },
  installState(laneRunId, state) {
    states.set(laneRunId, state);
  },
  removeState(laneRunId) {
    states.delete(laneRunId);
  },
});

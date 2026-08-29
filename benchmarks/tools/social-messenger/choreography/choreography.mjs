#!/usr/bin/env node

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";

import { ObservationWriter } from "../metering/observations.mjs";
import { loadSetupIdentity, verifySetupToolchain } from "./setup-identity.mjs";

const VERSION = "0.3.6-m8";
const TYPING_OBSERVATION_BOUNDARY_VERSION = "v2";
const REQUIRE = createRequire(import.meta.url);
const SETTLEMENT_WAITS = new AsyncLocalStorage();
const CONTINUOUS_SEGMENTS = ["m1", "m2", "m3", "m4", "m5", "m6", "m8"];
const SEGMENTS = [...CONTINUOUS_SEGMENTS, "m7"];
const SIMULATOR_IDS = {
  m6: "ios-simulator-m6",
  m8: "ios-simulator-m8",
};
const DEFAULT_FIXTURES_DIR = fileURLToPath(
  new URL("../../../fixtures/social-messenger", import.meta.url),
);
const DEFAULT_RECEIPTS_PATH = fileURLToPath(
  new URL("./receipts.jsonl", import.meta.url),
);

export const DEFAULT_ADDED_MEMBER_HANDLE = "dave";

const DEFAULT_ADAPTER = {
  schemaVersion: "social-messenger.choreography-adapter.v1",
  routes: {
    profile: "/profile/{handle}",
    profileEdit: "/profile/edit",
    settings: "/settings",
    search: "/search",
    insights: "/insights",
    conversation: "/conversation/{handle}",
    groupConversation: "/conversation/group/{group}",
    groupSettings: "/conversation/group/{group}/settings",
  },
  fixtures: {
    directory: DEFAULT_FIXTURES_DIR,
    image: "media/img-05.png",
    background: "media/img-01.png",
    video: "media/vid-01.mp4",
    groupTitle: "Weekend Plans",
    searchToken: "coffee",
    searchExpected: "Coffee after work?",
    pollOptionId: "m7-option-a",
    pollAlternateOptionId: "m7-option-b",
    addedMemberHandle: DEFAULT_ADDED_MEMBER_HANDLE,
  },
  disappearing: {
    optionValue: "24h",
    waitMs: 300_000,
  },
};

// CONTRACT.md is the sole authority for test IDs. `testId()` refuses any ID
// outside this frozen set so later additions cannot silently invent selectors.
const CONTRACT_TEST_IDS = new Set([
  "sm-auth-email",
  "sm-auth-password",
  "sm-auth-submit",
  "sm-settings-logout",
  "sm-feed-tab-following",
  "sm-feed-tab-global",
  "sm-feed-item",
  "sm-feed-author",
  "sm-feed-author-avatar",
  "sm-feed-media",
  "sm-feed-repost-attribution",
  "sm-post-like",
  "sm-post-repost",
  "sm-post-reply",
  "sm-compose-input",
  "sm-compose-submit",
  "sm-compose-file",
  "sm-compose-attach",
  "sm-compose-attachment",
  "sm-compose-attachment-media",
  "sm-profile-follow",
  "sm-profile-edit",
  "sm-profile-save",
  "sm-profile",
  "sm-profile-heading",
  "sm-profile-nav-feed",
  "sm-profile-field-displayname",
  "sm-profile-field-bio",
  "sm-chats-item",
  "sm-chats-unread",
  "sm-convo-input",
  "sm-convo-send",
  "sm-convo-bubble",
  "sm-convo-typing",
  "sm-convo-receipt",
  "sm-convo-sender-avatar",
  "sm-convo-reaction",
  "sm-convo-reaction-chip",
  "sm-convo-react",
  "sm-convo-quote",
  "sm-convo-quote-preview",
  "sm-convo-file",
  "sm-convo-attach",
  "sm-convo-media",
  "sm-convo-edit",
  "sm-convo-delete",
  "sm-convo-tombstone",
  "sm-convo-settings",
  "sm-convo-viewonce-toggle",
  "sm-convo-viewonce",
  "sm-convo-error",
  "sm-media-viewer-image",
  "sm-media-viewer-video",
  "sm-media-viewer-close",
  "sm-chatsettings-color",
  "sm-chatsettings-background",
  "sm-chatsettings-background-preview",
  "sm-chatsettings-disappearing",
  "sm-chatsettings-member",
  "sm-chatsettings-member-add",
  "sm-chatsettings-member-candidate",
  "sm-chatsettings-member-promote",
  "sm-chatsettings-member-remove",
  "sm-chatsettings-leave",
  "sm-search-input",
  "sm-search-result",
  "sm-search-offline",
  "sm-insights-total-likes-received",
  "sm-poll-option",
  "sm-poll-tally",
  "sm-poll-total",
]);

export const UNIMPLEMENTED_ASSERTIONS = Object.freeze([]);

function usage() {
  return `Usage: node choreography.mjs [all|m1|m2|m3|m4|m5|m6|m8|m1,m3,...|m7] [options]
  --setup-identity <path>
                         required structured setup identity

Options:
  --browser <name>       chromium, firefox, or webkit (default: chromium)
  --headed               show browser windows (default: headless)
  --receipts <path>      JSONL output (default: ./receipts.jsonl beside script)
  --observations <path>  Typed assertion-wait JSONL (default: <receipts>.observations.jsonl)
  --lane-run-id <id>     Stable lane identity shared with the metering manifest
  --suite-status <path>  Required JSON suite-status linkage for selected segments
  --adapter <path>       lane navigation/fixture adapter JSON
  --simulator-status <path>
                         optional separately recorded M6/M8 simulator status
  --timeout <ms>         ordinary assertion timeout (default: 10000)
  --help                  show this help

Required environment:
  CHOREO_BASE_URL
  CHOREO_PASSWORD, or per-persona passwords (Carol is required for M5;
  Alice's password is reused by her second M8 browser context)

See README.md for every environment variable and the suite-status shape.`;
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseSegments(value) {
  if (!value || value === "all") return [...CONTINUOUS_SEGMENTS];
  const requested = value.split(",").filter(Boolean);
  if (requested.length === 0 || requested.some((item) => !SEGMENTS.includes(item))) {
    throw new Error(`invalid segment selection: ${value}`);
  }
  if (requested.includes("m7") && requested.length !== 1) {
    throw new Error("m7 is a fresh-session segment and cannot share a choreography invocation");
  }
  return [...new Set(requested)];
}

function parseArgs(argv) {
  const options = {
    browser: process.env.CHOREO_BROWSER ?? "chromium",
    headed: false,
    receiptsPath: process.env.CHOREO_RECEIPTS ?? DEFAULT_RECEIPTS_PATH,
    observationsPath: process.env.CHOREO_OBSERVATIONS ?? null,
    laneRunId: process.env.CHOREO_LANE_RUN_ID ?? null,
    suiteStatusPath: process.env.CHOREO_SUITE_STATUS ?? null,
    setupIdentityPath: process.env.CHOREO_SETUP_IDENTITY ?? null,
    adapterPath: process.env.CHOREO_ADAPTER ?? null,
    simulatorStatusPath: process.env.CHOREO_SIMULATOR_STATUS ?? null,
    timeoutMs: Number(process.env.CHOREO_TIMEOUT_MS ?? 10_000),
    segmentArg: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
    } else if (arg === "--headed") {
      options.headed = true;
    } else if (arg === "--browser") {
      options.browser = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--receipts") {
      options.receiptsPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--observations") {
      options.observationsPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--lane-run-id") {
      options.laneRunId = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--suite-status") {
      options.suiteStatusPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--setup-identity") {
      options.setupIdentityPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--adapter") {
      options.adapterPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--simulator-status") {
      options.simulatorStatusPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--timeout") {
      options.timeoutMs = Number(takeValue(argv, index, arg));
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    } else if (options.segmentArg !== null) {
      throw new Error(`unexpected second segment argument: ${arg}`);
    } else {
      options.segmentArg = arg;
    }
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout / CHOREO_TIMEOUT_MS must be a positive integer");
  }
  if (typeof options.laneRunId !== "string" || options.laneRunId.length === 0) {
    throw new Error("--lane-run-id / CHOREO_LANE_RUN_ID is required");
  }
  if (!new Set(["chromium", "firefox", "webkit"]).has(options.browser)) {
    throw new Error(`unsupported browser: ${options.browser}`);
  }

  options.segments = parseSegments(options.segmentArg);
  options.receiptsPath = resolve(options.receiptsPath);
  options.observationsPath = resolve(
    options.observationsPath ?? `${options.receiptsPath}.observations.jsonl`,
  );
  if (options.suiteStatusPath) {
    options.suiteStatusPath = resolve(options.suiteStatusPath);
  }
  if (options.setupIdentityPath) options.setupIdentityPath = resolve(options.setupIdentityPath);
  if (options.adapterPath) options.adapterPath = resolve(options.adapterPath);
  if (options.simulatorStatusPath) {
    options.simulatorStatusPath = resolve(options.simulatorStatusPath);
  }
  return options;
}

export function testId(root, id) {
  if (!CONTRACT_TEST_IDS.has(id)) {
    throw new Error(`selector is not present in CONTRACT.md: ${id}`);
  }
  return root.getByTestId(id);
}

function errorText(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replaceAll(/\s+/g, " ").slice(0, 600);
}

function writeOutcomeLine(stream, value) {
  stream.write(`CHOREOGRAPHY OUTCOME ${JSON.stringify({
    schemaVersion: "social-messenger.choreography-outcome.v1",
    ...value,
  })}\n`);
}

const OUTCOME_CLASSES = new Set(["application", "platform", "setup", "instrument"]);

function errorOutcomeClass(error, fallback = "application") {
  const value = error && typeof error === "object" ? error.outcomeClass : null;
  return OUTCOME_CLASSES.has(value) ? value : fallback;
}

export function classifyOutcome({ green, suitePass, suiteOutcomeClass, assertionReceipts }) {
  if (green) return null;
  if (suitePass === false) return suiteOutcomeClass;
  const classes = assertionReceipts
    .filter((receipt) => receipt.status === "failed")
    .map((receipt) => receipt.outcomeClass)
    .filter((value) => OUTCOME_CLASSES.has(value));
  for (const value of ["instrument", "setup", "platform", "application"]) {
    if (classes.includes(value)) return value;
  }
  return "instrument";
}

function rounded(value) {
  return Math.round(value * 10) / 10;
}

async function createReceiptWriter(path, runId) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", "utf8");
  return async (receipt) => {
    const complete = {
      version: VERSION,
      runId,
      recordedAt: new Date().toISOString(),
      ...receipt,
    };
    const line = JSON.stringify(complete);
    await appendFile(path, `${line}\n`, "utf8");
    return complete;
  };
}

async function loadSuiteStatuses(path, requiredSegments) {
  if (!path) {
    throw new Error(
      "--suite-status / CHOREO_SUITE_STATUS is required before choreography startup",
    );
  }
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("suite-status input must be an object keyed by m1..m8");
  }
  for (const [segment, status] of Object.entries(parsed)) {
    if (!SEGMENTS.includes(segment)) {
      throw new Error(`suite-status input has unknown segment: ${segment}`);
    }
    if (!status || typeof status !== "object" || typeof status.pass !== "boolean") {
      throw new Error(`suite-status ${segment}.pass must be boolean`);
    }
    if (
      status.receipt !== undefined &&
      status.receipt !== null &&
      typeof status.receipt !== "string"
    ) {
      throw new Error(`suite-status ${segment}.receipt must be string or null`);
    }
    if (status.pass && (typeof status.receipt !== "string" || status.receipt.length === 0)) {
      throw new Error(`suite-status ${segment}.receipt must name evidence when pass is true`);
    }
    if (!status.pass && !OUTCOME_CLASSES.has(status.outcomeClass)) {
      throw new Error(`suite-status ${segment}.outcomeClass is required when pass is false`);
    }
    if (status.pass && status.outcomeClass != null) {
      throw new Error(`suite-status ${segment}.outcomeClass must be absent when pass is true`);
    }
    let receiptSha256 = null;
    if (typeof status.receipt === "string" && status.receipt.length > 0) {
      if (isAbsolute(status.receipt)) {
        throw new Error(`suite-status ${segment}.receipt must be relative to the suite-status file`);
      }
      const receiptPath = resolve(dirname(path), status.receipt);
      const escaped = relative(dirname(path), receiptPath);
      if (escaped === ".." || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
        throw new Error(`suite-status ${segment}.receipt must stay beside the suite-status file`);
      }
      if ((await lstat(receiptPath)).isSymbolicLink()) {
        throw new Error(`suite-status ${segment}.receipt cannot be a symbolic link`);
      }
      const canonicalReceiptPath = await realpath(receiptPath);
      const canonicalStatusDirectory = await realpath(dirname(path));
      const canonicalEscape = relative(canonicalStatusDirectory, canonicalReceiptPath);
      if (
        canonicalEscape === ".."
        || canonicalEscape.startsWith(`..${sep}`)
        || isAbsolute(canonicalEscape)
      ) {
        throw new Error(`suite-status ${segment}.receipt escapes after canonical resolution`);
      }
      const receiptStatus = await stat(canonicalReceiptPath);
      if (!receiptStatus.isFile()) {
        throw new Error(`suite-status ${segment}.receipt must name a file`);
      }
      receiptSha256 = `sha256:${createHash("sha256")
        .update(await readFile(canonicalReceiptPath))
        .digest("hex")}`;
    }
    parsed[segment] = { ...status, outcomeClass: status.outcomeClass ?? null, receiptSha256 };
  }
  for (const segment of requiredSegments) {
    if (!Object.hasOwn(parsed, segment)) {
      throw new Error(`suite-status input is missing selected segment: ${segment}`);
    }
  }
  return parsed;
}

function assertPlainObject(value, label) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
}

async function loadAdapter(path) {
  if (!path) return structuredClone(DEFAULT_ADAPTER);
  const parsed = JSON.parse(await readFile(path, "utf8"));
  assertPlainObject(parsed, "lane adapter");
  if (parsed.schemaVersion !== DEFAULT_ADAPTER.schemaVersion) {
    throw new Error(
      `lane adapter schemaVersion must be ${DEFAULT_ADAPTER.schemaVersion}`,
    );
  }
  for (const [name, value] of [
    ["routes", parsed.routes],
    ["fixtures", parsed.fixtures],
    ["disappearing", parsed.disappearing],
  ]) {
    if (value !== undefined) assertPlainObject(value, `lane adapter ${name}`);
  }
  const adapter = {
    ...structuredClone(DEFAULT_ADAPTER),
    ...parsed,
    routes: { ...DEFAULT_ADAPTER.routes, ...parsed.routes },
    fixtures: { ...DEFAULT_ADAPTER.fixtures, ...parsed.fixtures },
    disappearing: { ...DEFAULT_ADAPTER.disappearing, ...parsed.disappearing },
  };
  for (const [name, route] of Object.entries(adapter.routes)) {
    if (typeof route !== "string" || !route.startsWith("/")) {
      throw new Error(`lane adapter routes.${name} must be an absolute URL path`);
    }
  }
  for (const name of [
    "image",
    "background",
    "video",
    "groupTitle",
    "searchToken",
    "searchExpected",
    "pollOptionId",
    "pollAlternateOptionId",
    "addedMemberHandle",
  ]) {
    if (typeof adapter.fixtures[name] !== "string" || adapter.fixtures[name].length === 0) {
      throw new Error(`lane adapter fixtures.${name} must be a non-empty string`);
    }
  }
  if (adapter.fixtures.pollOptionId === adapter.fixtures.pollAlternateOptionId) {
    throw new Error("lane adapter poll option fixture IDs must be distinct");
  }
  if (
    typeof adapter.disappearing.optionValue !== "string" ||
    adapter.disappearing.optionValue.length === 0 ||
    !Number.isInteger(adapter.disappearing.waitMs) ||
    adapter.disappearing.waitMs <= 0
  ) {
    throw new Error(
      "lane adapter disappearing requires a non-empty optionValue and positive integer waitMs",
    );
  }
  if (
    typeof adapter.fixtures.directory !== "string" ||
    adapter.fixtures.directory.length === 0
  ) {
    throw new Error("lane adapter fixtures.directory must be a non-empty string");
  }
  adapter.fixtures.directory = resolve(dirname(path), adapter.fixtures.directory);
  return adapter;
}

function missingSimulatorStatus(segment) {
  return {
    id: SIMULATOR_IDS[segment],
    pass: null,
    receipt: null,
    status: "not-recorded",
    reason: `${segment.toUpperCase()} simulator evidence is recorded separately from web green`,
  };
}

function normalizeSimulatorStatus(parsed, expectedId = null) {
  assertPlainObject(parsed, "simulator status entry");
  if (!Object.values(SIMULATOR_IDS).includes(parsed.id)) {
    throw new Error("simulator status id must be ios-simulator-m6 or ios-simulator-m8");
  }
  if (expectedId && parsed.id !== expectedId) {
    throw new Error(`simulator status entry must use id ${expectedId}`);
  }
  if (![true, false, null].includes(parsed.pass)) {
    throw new Error("simulator status pass must be boolean or null");
  }
  if (parsed.pass === true && (typeof parsed.receipt !== "string" || !parsed.receipt)) {
    throw new Error("passing simulator status must carry a receipt pointer");
  }
  if (
    parsed.receipt !== undefined &&
    parsed.receipt !== null &&
    typeof parsed.receipt !== "string"
  ) {
    throw new Error("simulator status receipt must be string or null");
  }
  if (
    parsed.reason !== undefined &&
    parsed.reason !== null &&
    typeof parsed.reason !== "string"
  ) {
    throw new Error("simulator status reason must be string or null");
  }
  return {
    id: parsed.id,
    pass: parsed.pass,
    receipt: parsed.receipt ?? null,
    status: parsed.pass === true ? "passed" : parsed.pass === false ? "failed" : "not-recorded",
    reason:
      parsed.reason ??
      (parsed.pass === null ? "simulator evidence is not recorded" : null),
  };
}

async function loadSimulatorStatuses(path) {
  const statuses = Object.fromEntries(
    Object.keys(SIMULATOR_IDS).map((segment) => [segment, missingSimulatorStatus(segment)]),
  );
  if (!path) return statuses;

  const parsed = JSON.parse(await readFile(path, "utf8"));
  let entries;
  if (Array.isArray(parsed)) {
    entries = parsed.map((entry) => ({ entry, expectedId: null }));
  } else {
    assertPlainObject(parsed, "simulator status");
    if (Object.hasOwn(parsed, "id")) {
      entries = [{ entry: parsed, expectedId: null }];
    } else {
      const unknown = Object.keys(parsed).filter((key) => !Object.hasOwn(SIMULATOR_IDS, key));
      if (unknown.length > 0) {
        throw new Error(`simulator status bundle has unknown segment: ${unknown[0]}`);
      }
      entries = Object.entries(parsed).map(([segment, entry]) => ({
        entry,
        expectedId: SIMULATOR_IDS[segment],
      }));
    }
  }

  const seen = new Set();
  for (const { entry, expectedId } of entries) {
    const status = normalizeSimulatorStatus(entry, expectedId);
    if (seen.has(status.id)) {
      throw new Error(`simulator status contains duplicate entry: ${status.id}`);
    }
    seen.add(status.id);
    const segment = Object.keys(SIMULATOR_IDS).find(
      (candidate) => SIMULATOR_IDS[candidate] === status.id,
    );
    statuses[segment] = status;
  }
  return statuses;
}

export function createCheckRunner(emit, observations, { receiptPath, observationsPath }) {
  const bySegment = new Map();
  let resetAttempt = async () => {};

  function setResetAttempt(value) {
    resetAttempt = value;
  }

  async function check(
    segment,
    assertion,
    {
      bestOf = 1,
      implemented = true,
      required = true,
      reason = null,
      typingObservationBoundaryVersion = null,
    } = {},
    attemptFn = null,
  ) {
    if (![1, 3].includes(bestOf)) {
      throw new Error(`${segment}/${assertion}: bestOf must be 1 or 3`);
    }
    if (!implemented && (typeof reason !== "string" || reason.trim().length === 0)) {
      throw new Error(`${segment}/${assertion}: skipped checks require a reason`);
    }
    if (implemented && typeof attemptFn !== "function") {
      throw new Error(`${segment}/${assertion}: implemented checks require an attempt function`);
    }

    const timings = [];
    const successful = [];
    if (implemented) {
      for (let attempt = 1; attempt <= bestOf; attempt += 1) {
        const startedAt = new Date().toISOString();
        const started = performance.now();
        const settlementIntervals = [];
        try {
          const result = (
            await SETTLEMENT_WAITS.run(settlementIntervals, () => attemptFn(attempt))
          ) ?? {};
          const pass = result.pass !== false;
          const timing = {
            attempt,
            pass,
            startedAt,
            durationMs: rounded(performance.now() - started),
            settlementWaitMs: mergedIntervalDuration(settlementIntervals),
            metrics: result.metrics ?? {},
          };
          if (result.note) timing.note = result.note;
          timings.push(timing);
          if (pass) successful.push({ timing, data: result.data });
        } catch (error) {
          timings.push({
            attempt,
            pass: false,
            startedAt,
            durationMs: rounded(performance.now() - started),
            settlementWaitMs: mergedIntervalDuration(settlementIntervals),
            metrics: {},
            error: errorText(error),
            outcomeClass: errorOutcomeClass(error),
          });
        }
        if (!timings.at(-1).pass && attempt < bestOf) await resetAttempt();
      }
    }

    successful.sort((left, right) => left.timing.durationMs - right.timing.durationMs);
    const selected = successful[0] ?? null;
    const status = !implemented ? "skipped" : selected ? "passed" : "failed";
    const failedClasses = timings
      .filter((timing) => !timing.pass)
      .map((timing) => timing.outcomeClass)
      .filter(Boolean);
    const assertionOutcomeClass = status === "passed"
      ? null
      : status === "skipped"
        ? "instrument"
        : ["instrument", "setup", "platform", "application"]
            .find((value) => failedClasses.includes(value)) ?? "application";
    const receipt = await emit({
      type: "assertion",
      segment,
      assertion,
      implemented,
      required,
      status,
      pass: implemented ? selected !== null : null,
      outcomeClass: assertionOutcomeClass,
      timings,
      bestOf,
      details: {
        selection: bestOf === 3 ? "fastest passing attempt; all three retained" : "only attempt",
        selectedAttempt: selected?.timing.attempt ?? null,
        reason,
        ...(typingObservationBoundaryVersion === null
          ? {}
          : { typingObservationBoundaryVersion }),
      },
      ...(typingObservationBoundaryVersion === null
        ? {}
        : { typingObservationBoundaryVersion }),
    });
    if (status === "failed") {
      const miss = {
        schemaVersion: "social-messenger.choreography-miss.v1",
        outcomeClass: assertionOutcomeClass,
        segment,
        assertion,
        attempts: timings.map((timing) => ({
          attempt: timing.attempt,
          durationMs: timing.durationMs,
          settlementWaitMs: timing.settlementWaitMs,
          error: (timing.error ?? "assertion returned pass:false").slice(0, 120),
        })),
        receipts: receiptPath.slice(-120),
        observations: observationsPath.slice(-120),
      };
      process.stdout.write(`STRUCTURED CHOREOGRAPHY MISS ${JSON.stringify(miss)}\n`);
    }
    for (const timing of timings) {
      await observations.assertionWait(segment.toUpperCase(), {
        owner: "choreography",
        assertion,
        attempt: timing.attempt,
        durationMs: timing.settlementWaitMs,
        pass: timing.pass,
      });
    }
    const receipts = bySegment.get(segment) ?? [];
    receipts.push(receipt);
    bySegment.set(segment, receipts);
    return { ...receipt, data: selected?.data };
  }

  return { check, bySegment, setResetAttempt };
}

function mergedIntervalDuration(intervals) {
  const sorted = intervals
    .filter(({ started, ended }) => Number.isFinite(started) && Number.isFinite(ended))
    .sort((left, right) => left.started - right.started);
  let duration = 0;
  let lower = null;
  let upper = null;
  for (const interval of sorted) {
    if (lower === null) {
      lower = interval.started;
      upper = interval.ended;
    } else if (interval.started <= upper) {
      upper = Math.max(upper, interval.ended);
    } else {
      duration += upper - lower;
      lower = interval.started;
      upper = interval.ended;
    }
  }
  if (lower !== null) duration += upper - lower;
  return rounded(duration);
}

async function settlementWait(operation) {
  const intervals = SETTLEMENT_WAITS.getStore();
  const interval = { started: performance.now(), ended: null };
  try {
    return await operation();
  } finally {
    interval.ended = performance.now();
    if (intervals) intervals.push(interval);
  }
}

function waitForLocator(locator, options) {
  return settlementWait(() => locator.waitFor(options));
}

function waitForPageEvent(page, event, options) {
  return settlementWait(() => page.waitForEvent(event, options));
}

async function waitForValue(locator, predicate, timeoutMs, description) {
  return settlementWait(async () => {
    const started = performance.now();
    while (performance.now() - started <= timeoutMs) {
      const observed = await predicate(locator);
      if (observed?.matched) {
        return { value: observed.value, elapsedMs: rounded(performance.now() - started) };
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    throw new Error(`${description} did not become observable within ${timeoutMs}ms`);
  });
}

async function observableState(locator) {
  return locator.evaluate((element) => {
    const attributes = [
      "aria-label",
      "aria-pressed",
      "aria-selected",
      "aria-valuetext",
      "title",
      "data-state",
      "data-count",
      "data-selected",
      "data-value",
      "src",
      "style",
    ]
      .map((name) => element.getAttribute(name) ?? "")
      .join("|");
    return `${element.textContent ?? ""}|${attributes}`.replace(/\s+/g, " ").trim();
  });
}

async function semanticValue(locator) {
  return locator.evaluate((element) =>
    element.getAttribute("aria-valuetext")
    ?? element.getAttribute("data-value")
    ?? element.getAttribute("data-state")
    ?? element.getAttribute("aria-label")
    ?? "",
  );
}

async function locatorWithSemanticValue(locator, expected, timeoutMs, description) {
  return settlementWait(async () => {
    const started = performance.now();
    while (performance.now() - started <= timeoutMs) {
      for (let index = 0; index < (await locator.count()); index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible() && (await semanticValue(candidate)) === expected) {
          return candidate;
        }
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    throw new Error(`${description} did not expose semantic value ${expected} within ${timeoutMs}ms`);
  });
}

async function waitForStateChange(locator, before, timeoutMs, description) {
  return waitForValue(
    locator,
    async (target) => {
      const value = await observableState(target);
      return { matched: value !== before, value };
    },
    timeoutMs,
    description,
  );
}

async function waitForCount(locator, predicate, timeoutMs, description) {
  return waitForValue(
    locator,
    async (target) => {
      const value = await target.count();
      return { matched: predicate(value), value };
    },
    timeoutMs,
    description,
  );
}

async function visibleTexts(locator) {
  const values = [];
  for (let index = 0; index < (await locator.count()); index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) values.push((await candidate.innerText()).trim());
  }
  return values;
}

async function setContextsOffline(contexts, offline) {
  const active = contexts.filter(Boolean);
  const outcomes = await Promise.allSettled(
    active.map((context) => context.setOffline(offline)),
  );
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure) {
    if (offline) {
      await Promise.allSettled(active.map((context) => context.setOffline(false)));
    }
    throw failure.reason;
  }
}

async function expectExactlyOnceInOrder(page, first, second) {
  const texts = await visibleTexts(testId(page, "sm-convo-bubble"));
  const firstMatches = texts
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => text.includes(first));
  const secondMatches = texts
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => text.includes(second));
  if (firstMatches.length !== 1 || secondMatches.length !== 1) {
    throw new Error(
      `offline convergence rendered duplicate/lost messages: first=${firstMatches.length} second=${secondMatches.length}`,
    );
  }
  if (secondMatches[0].index <= firstMatches[0].index) {
    throw new Error("offline convergence did not render messages in server-arrival order");
  }
}

async function clickVisible(locator, timeoutMs) {
  const target = locator.first();
  await waitForLocator(target, { state: "visible", timeout: timeoutMs });
  await target.click();
  return target;
}

async function login(page, baseUrl, persona, timeoutMs) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await testId(page, "sm-auth-email").fill(persona.email);
  await testId(page, "sm-auth-password").fill(persona.password);
  await testId(page, "sm-auth-submit").click();

  const authenticatedSurface = testId(page, "sm-feed-tab-following")
    .or(testId(page, "sm-feed-tab-global"))
    .or(testId(page, "sm-profile-edit"))
    .or(testId(page, "sm-chats-item"))
    .or(testId(page, "sm-convo-input"))
    .or(testId(page, "sm-search-input"));
  await waitForLocator(authenticatedSurface.first(), { state: "visible", timeout: timeoutMs });
}

async function openGlobalFeed(page, timeoutMs) {
  await clickVisible(testId(page, "sm-feed-tab-global"), timeoutMs);
  await waitForLocator(testId(page, "sm-feed-item").first(), { state: "visible", timeout: timeoutMs });
}

async function openFollowingFeed(page, timeoutMs, { requireItem = true } = {}) {
  await clickVisible(testId(page, "sm-feed-tab-following"), timeoutMs);
  if (requireItem) {
    await waitForLocator(testId(page, "sm-feed-item").first(), { state: "visible", timeout: timeoutMs });
  }
}

async function feedProjectionState(page, postText, viewer = "bob") {
  const cards = testId(page, "sm-feed-item").filter({ hasText: postText });
  let direct = false;
  let viewerRepost = false;
  let total = 0;
  for (let index = 0; index < (await cards.count()); index += 1) {
    const card = cards.nth(index);
    if (!(await card.isVisible())) continue;
    total += 1;
    const attribution = testId(card, "sm-feed-repost-attribution");
    if ((await attribution.count()) === 0) {
      direct = true;
    } else if ((await semanticValue(attribution.first())) === viewer) {
      viewerRepost = true;
    }
  }
  return { direct, viewerRepost, total };
}

async function waitForFeedProjection(page, tabId, postText, predicate, timeoutMs, description) {
  await clickVisible(testId(page, tabId), timeoutMs);
  return waitForValue(
    testId(page, "sm-feed-item"),
    async () => {
      const value = await feedProjectionState(page, postText);
      return { matched: predicate(value), value };
    },
    timeoutMs,
    description,
  );
}

async function toggleFollow(ctx, page, handle) {
  await openProfile(ctx, page, handle);
  await clickVisible(testId(page, "sm-profile-follow"), ctx.timeoutMs);
}

async function composeTextPost(page, text, timeoutMs) {
  await openGlobalFeed(page, timeoutMs);
  await testId(page, "sm-compose-input").fill(text);
  await testId(page, "sm-compose-submit").click();
  const card = testId(page, "sm-feed-item").filter({ hasText: text }).first();
  await waitForLocator(card, { state: "visible", timeout: timeoutMs });
  return card;
}

async function composeMediaPost(ctx, kind, attempt) {
  await Promise.all([
    openGlobalFeed(ctx.alicePage, ctx.timeoutMs),
    openGlobalFeed(ctx.bobPage, ctx.timeoutMs),
  ]);
  const caption = `choreo-${ctx.runId}-m2-${kind}-${attempt}`;
  await setFileThroughControl(
    ctx.alicePage,
    "sm-compose-file",
    "sm-compose-attach",
    fixturePath(ctx, kind),
    ctx.timeoutMs,
  );
  const attachment = await locatorWithSemanticValue(
    testId(ctx.alicePage, "sm-compose-attachment"),
    kind,
    ctx.timeoutMs,
    `composer ${kind} attachment`,
  );
  await waitForLoadedMedia(testId(attachment, "sm-compose-attachment-media"), "image", ctx.timeoutMs);
  await testId(ctx.alicePage, "sm-compose-input").fill(caption);
  const started = performance.now();
  await testId(ctx.alicePage, "sm-compose-submit").click();
  const remoteCard = testId(ctx.bobPage, "sm-feed-item").filter({ hasText: caption }).first();
  await waitForLocator(remoteCard, { state: "visible", timeout: ctx.timeoutMs });
  const remoteMedia = await locatorWithSemanticValue(
    testId(remoteCard, "sm-feed-media"),
    kind,
    ctx.timeoutMs,
    `remote ${kind} feed media`,
  );
  if (kind === "image") await waitForLoadedMedia(remoteMedia, "image", ctx.timeoutMs);
  return {
    metrics: { visibleMs: rounded(performance.now() - started) },
    note: `structural ${kind} attachment and two-client feed delivery`,
  };
}

async function openConversationFromAnySurface(ctx, page, counterpart) {
  await page.goto(routeUrl(ctx, "conversation", { handle: counterpart.toLowerCase() }), {
    waitUntil: "domcontentloaded",
    timeout: ctx.timeoutMs,
  });
  await waitForLocator(testId(page, "sm-convo-input"), {
    state: "visible",
    timeout: ctx.timeoutMs,
  });
}

async function openAliceBobConversation(ctx) {
  await Promise.all([
    openConversationFromAnySurface(ctx, ctx.alicePage, "Bob"),
    openConversationFromAnySurface(ctx, ctx.bobPage, "Alice"),
  ]);
}

async function openGroupConversation(ctx, page) {
  await page.goto(
    routeUrl(ctx, "groupConversation", { group: ctx.adapter.fixtures.groupTitle }),
    { waitUntil: "domcontentloaded", timeout: ctx.timeoutMs },
  );
  await waitForLocator(testId(page, "sm-convo-input"), {
    state: "visible",
    timeout: ctx.timeoutMs,
  });
}

async function openGroupSettings(ctx, page) {
  await page.goto(
    routeUrl(ctx, "groupSettings", { group: ctx.adapter.fixtures.groupTitle }),
    { waitUntil: "domcontentloaded", timeout: ctx.timeoutMs },
  );
  await waitForLocator(testId(page, "sm-chatsettings-member").first(), {
    state: "visible",
    timeout: ctx.timeoutMs,
  });
}

async function sendConversationText(page, text, timeoutMs) {
  const input = testId(page, "sm-convo-input");
  await waitForLocator(input, { state: "visible", timeout: timeoutMs });
  await input.fill(text);
  await testId(page, "sm-convo-send").click();
  const bubble = testId(page, "sm-convo-bubble").filter({ hasText: text }).last();
  await waitForLocator(bubble, { state: "visible", timeout: timeoutMs });
  return bubble;
}

function routeUrl(ctx, route, replacements = {}) {
  let pathname = ctx.adapter.routes[route];
  for (const [name, value] of Object.entries(replacements)) {
    pathname = pathname.replaceAll(`{${name}}`, encodeURIComponent(value));
  }
  if (/\{[^}]+\}/u.test(pathname)) {
    throw new Error(`lane adapter route ${route} has unresolved placeholders: ${pathname}`);
  }
  return new URL(pathname, ctx.baseUrl).href;
}

function fixturePath(ctx, name) {
  return resolve(ctx.adapter.fixtures.directory, ctx.adapter.fixtures[name]);
}

async function openProfile(ctx, page, handle) {
  await page.goto(routeUrl(ctx, "profile", { handle }), {
    waitUntil: "domcontentloaded",
    timeout: ctx.timeoutMs,
  });
  await waitForLocator(testId(page, "sm-profile"), { state: "visible", timeout: ctx.timeoutMs });
}

async function setFileThroughControl(page, directId, triggerId, path, timeoutMs) {
  const direct = testId(page, directId);
  if ((await direct.count()) > 0) {
    const isFileInput = await direct.first().evaluate(
      (element) =>
        element instanceof HTMLInputElement && element.type.toLowerCase() === "file",
    );
    if (isFileInput) {
      await direct.first().setInputFiles(path);
      return;
    }
  }
  const chooserPromise = waitForPageEvent(page, "filechooser", { timeout: timeoutMs });
  await clickVisible(
    (await direct.count()) > 0 ? direct : testId(page, triggerId),
    timeoutMs,
  );
  const chooser = await chooserPromise;
  await chooser.setFiles(path);
}

async function waitForLoadedMedia(root, kind, timeoutMs) {
  const selector = kind === "video" ? "video" : "img";
  let media = root.locator(selector).first();
  if ((await media.count()) === 0 && (await root.count()) > 0) {
    const rootIsMedia = await root
      .first()
      .evaluate((element, expected) => element.tagName.toLowerCase() === expected, selector);
    if (rootIsMedia) media = root.first();
  }
  await waitForLocator(media, { state: "visible", timeout: timeoutMs });
  await waitForValue(
    media,
    async (target) => {
      const value = await target.evaluate((element) => {
        if (element instanceof HTMLImageElement) {
          return element.complete && element.naturalWidth > 0;
        }
        if (element instanceof HTMLVideoElement) return element.readyState >= 1;
        return false;
      });
      return { matched: value, value: value ? 1 : 0 };
    },
    timeoutMs,
    `${kind} media bytes`,
  );
  if (kind === "video") {
    await media.evaluate(async (element) => {
      element.muted = true;
      await element.play();
    });
    await waitForValue(
      media,
      async (target) => {
        const value = await target.evaluate(
          (element) => element instanceof HTMLVideoElement && !element.paused,
        );
        return { matched: value, value: value ? 1 : 0 };
      },
      timeoutMs,
      "video playback",
    );
  }
}

async function openAction(page, bubble, actionId, timeoutMs) {
  const direct = testId(bubble, actionId);
  if ((await direct.count()) > 0) {
    await clickVisible(direct, timeoutMs);
    return;
  }
  await bubble.click({ delay: 700 });
  await waitForLocator(testId(page, actionId).first(), { state: "visible", timeout: timeoutMs });
  await testId(page, actionId).first().click();
}

async function reopenPersona(ctx, key) {
  const context = ctx[`${key}Context`];
  const page = await context.newPage();
  ctx[`${key}Page`] = page;
  await page.goto(ctx.baseUrl, { waitUntil: "domcontentloaded", timeout: ctx.timeoutMs });
  if ((await testId(page, "sm-auth-email").count()) > 0) {
    const persona = ctx.personas[key];
    await testId(page, "sm-auth-email").fill(persona.email);
    await testId(page, "sm-auth-password").fill(persona.password);
    await testId(page, "sm-auth-submit").click();
  }
  await waitForLocator(
    testId(page, "sm-feed-tab-following")
      .or(testId(page, "sm-chats-item"))
      .first(),
    { state: "visible", timeout: ctx.timeoutMs },
  );
  return page;
}

async function m1(ctx) {
  await ctx.check(
    "m1",
    "profile-edit-live-visibility",
    { bestOf: 3 },
    async (attempt) => {
      await openProfile(ctx, ctx.bobPage, "alice");
      await ctx.alicePage.goto(routeUrl(ctx, "profileEdit"), {
        waitUntil: "domcontentloaded",
        timeout: ctx.timeoutMs,
      });
      const displayName = `Alice Choreo ${ctx.runId.slice(0, 8)} ${attempt}`;
      const bio = `Live profile ${ctx.runId.slice(0, 8)} ${attempt}`;
      await testId(ctx.alicePage, "sm-profile-field-displayname").fill(displayName);
      await testId(ctx.alicePage, "sm-profile-field-bio").fill(bio);
      const started = performance.now();
      await testId(ctx.alicePage, "sm-profile-save").click();
      const visible = await waitForValue(
        testId(ctx.bobPage, "sm-profile"),
        async (target) => {
          const value = await target.innerText();
          return { matched: value.includes(displayName) && value.includes(bio), value };
        },
        ctx.timeoutMs,
        "Bob's live Alice profile",
      );
      const heading = testId(ctx.bobPage, "sm-profile-heading");
      await waitForLocator(heading, { state: "visible", timeout: ctx.timeoutMs });
      if ((await heading.innerText()).trim() !== displayName) {
        throw new Error("profile heading did not expose the live display name structurally");
      }
      await waitForLocator(testId(ctx.bobPage, "sm-profile-nav-feed"), {
        state: "visible",
        timeout: ctx.timeoutMs,
      });
      return {
        metrics: { visibleMs: rounded(performance.now() - started) },
        note: `other client observed display name, bio, heading, and feed navigation in ${visible.elapsedMs}ms`,
      };
    },
  );

  await ctx.check("m1", "session-persists-on-relaunch", {}, async () => {
    await ctx.alicePage.goto(ctx.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: ctx.timeoutMs,
    });
    await ctx.alicePage.reload({ waitUntil: "domcontentloaded", timeout: ctx.timeoutMs });
    await waitForLocator(
      testId(ctx.alicePage, "sm-feed-tab-following")
        .or(testId(ctx.alicePage, "sm-chats-item"))
        .first(),
      { state: "visible", timeout: ctx.timeoutMs },
    );
    if ((await testId(ctx.alicePage, "sm-auth-email").count()) > 0) {
      throw new Error("Alice returned to the auth screen after relaunch");
    }
    return {};
  });

  await ctx.check("m1", "logout-remains-signed-out-on-relaunch", {}, async () => {
    await ctx.alicePage.goto(routeUrl(ctx, "settings"), {
      waitUntil: "domcontentloaded",
      timeout: ctx.timeoutMs,
    });
    await clickVisible(testId(ctx.alicePage, "sm-settings-logout"), ctx.timeoutMs);
    await waitForLocator(testId(ctx.alicePage, "sm-auth-email"), {
      state: "visible",
      timeout: ctx.timeoutMs,
    });
    await ctx.alicePage.reload({ waitUntil: "domcontentloaded", timeout: ctx.timeoutMs });
    await waitForLocator(testId(ctx.alicePage, "sm-auth-email"), {
      state: "visible",
      timeout: ctx.timeoutMs,
    });
    await testId(ctx.alicePage, "sm-auth-email").fill(ctx.personas.alice.email);
    await testId(ctx.alicePage, "sm-auth-password").fill(ctx.personas.alice.password);
    await testId(ctx.alicePage, "sm-auth-submit").click();
    await waitForLocator(
      testId(ctx.alicePage, "sm-feed-tab-following")
        .or(testId(ctx.alicePage, "sm-chats-item"))
        .first(),
      { state: "visible", timeout: ctx.timeoutMs },
    );
    return {};
  });
}

async function m2(ctx) {
  const livePost = await ctx.check(
    "m2",
    "feed-text-post-live-update",
    { bestOf: 3 },
    async (attempt) => {
      await Promise.all([
        openGlobalFeed(ctx.alicePage, ctx.timeoutMs),
        openGlobalFeed(ctx.bobPage, ctx.timeoutMs),
      ]);
      const postText = `choreo-${ctx.runId}-m2-feed-${attempt}`;
      await testId(ctx.alicePage, "sm-compose-input").fill(postText);
      const started = performance.now();
      await testId(ctx.alicePage, "sm-compose-submit").click();
      const bobCard = testId(ctx.bobPage, "sm-feed-item").filter({ hasText: postText }).first();
      await waitForLocator(bobCard, { state: "visible", timeout: ctx.timeoutMs });
      return {
        metrics: { visibleMs: rounded(performance.now() - started) },
        data: { postText },
      };
    },
  );

  await ctx.check(
    "m2",
    "feed-image-post-live-update",
    { bestOf: 3 },
    (attempt) => composeMediaPost(ctx, "image", attempt),
  );
  await ctx.check(
    "m2",
    "feed-video-post-live-update",
    { bestOf: 3 },
    (attempt) => composeMediaPost(ctx, "video", attempt),
  );

  await ctx.check(
    "m2",
    "follow-unfollow-live-projection",
    { bestOf: 3 },
    async (attempt) => {
      const postText = `choreo-${ctx.runId}-m2-follow-${attempt}`;
      await composeTextPost(ctx.alicePage, postText, ctx.timeoutMs);
      await openGlobalFeed(ctx.bobPage, ctx.timeoutMs);
      await waitForLocator(
        testId(ctx.bobPage, "sm-feed-item")
          .filter({ hasText: postText })
          .first(),
        { state: "visible", timeout: ctx.timeoutMs },
      );

      const before = await waitForFeedProjection(
        ctx.bobPage,
        "sm-feed-tab-following",
        postText,
        () => true,
        ctx.timeoutMs,
        "Bob's Following feed",
      );
      const beforeHas = before.value.direct;

      const started = performance.now();
      await toggleFollow(ctx, ctx.bobPage, "alice");
      await waitForFeedProjection(
        ctx.bobPage,
        "sm-feed-tab-following",
        postText,
        (value) => value.direct !== beforeHas,
        ctx.timeoutMs,
        "Bob's Following projection after follow toggle",
      );
      const followVisibleMs = rounded(performance.now() - started);

      await waitForFeedProjection(
        ctx.bobPage,
        "sm-feed-tab-global",
        postText,
        (value) => value.total > 0,
        ctx.timeoutMs,
        "Alice's post remains in Global after follow toggle",
      );

      await toggleFollow(ctx, ctx.bobPage, "alice");
      const restored = await waitForFeedProjection(
        ctx.bobPage,
        "sm-feed-tab-following",
        postText,
        (value) => value.direct === beforeHas,
        ctx.timeoutMs,
        "Bob's Following projection after unfollow toggle",
      );
      await waitForFeedProjection(
        ctx.bobPage,
        "sm-feed-tab-global",
        postText,
        (value) => value.total > 0,
        ctx.timeoutMs,
        "Alice's post remains in Global after unfollow toggle",
      );

      return {
        metrics: {
          followVisibleMs,
          unfollowVisibleMs: rounded(restored.elapsedMs),
        },
      };
    },
  );

  await ctx.check("m2", "feed-author-avatar-and-display-name", {}, async () => {
    if (!livePost.data?.postText) throw new Error("live-post prerequisite did not yield a post");
    await openProfile(ctx, ctx.alicePage, "alice");
    const displayName = (await testId(ctx.alicePage, "sm-profile-heading").innerText()).trim();
    if (!displayName) {
      throw new Error("Alice's profile did not expose a display name");
    }
    await openGlobalFeed(ctx.bobPage, ctx.timeoutMs);
    const card = testId(ctx.bobPage, "sm-feed-item")
      .filter({ hasText: livePost.data.postText })
      .first();
    await waitForLocator(card, { state: "visible", timeout: ctx.timeoutMs });
    const cardText = (await card.innerText()).trim();
    if (!cardText.includes(displayName)) {
      throw new Error(
        `feed item did not render author display name ${JSON.stringify(displayName)}`,
      );
    }
    await locatorWithSemanticValue(
      testId(card, "sm-feed-author-avatar"),
      "alice",
      ctx.timeoutMs,
      "Alice feed-author avatar",
    );
    return {
      note: "structural profile heading plus exact feed-author avatar identity",
    };
  });

  await ctx.check(
    "m2",
    "like-unlike-live-count",
    { bestOf: 3 },
    async () => {
      if (!livePost.data?.postText) throw new Error("live-post prerequisite did not yield a post");
      await Promise.all([
        openGlobalFeed(ctx.alicePage, ctx.timeoutMs),
        openGlobalFeed(ctx.bobPage, ctx.timeoutMs),
      ]);
      const aliceCard = testId(ctx.alicePage, "sm-feed-item")
        .filter({ hasText: livePost.data.postText })
        .first();
      const bobCard = testId(ctx.bobPage, "sm-feed-item")
        .filter({ hasText: livePost.data.postText })
        .first();
      const aliceLike = testId(aliceCard, "sm-post-like");
      const bobLike = testId(bobCard, "sm-post-like");
      const before = await observableState(aliceLike);
      await bobLike.click();
      const liked = await waitForStateChange(
        aliceLike,
        before,
        ctx.timeoutMs,
        "Alice's live like count",
      );
      await bobLike.click();
      const unliked = await waitForValue(
        aliceLike,
        async (target) => {
          const value = await observableState(target);
          return { matched: value === before, value };
        },
        ctx.timeoutMs,
        "Alice's live unlike count",
      );
      return {
        metrics: {
          likeVisibleMs: rounded(liked.elapsedMs),
          unlikeVisibleMs: rounded(unliked.elapsedMs),
        },
      };
    },
  );

  await ctx.check(
    "m2",
    "repost-toggle-live-attribution",
    { bestOf: 3 },
    async () => {
      if (!livePost.data?.postText) throw new Error("live-post prerequisite did not yield a post");
      await Promise.all([
        openGlobalFeed(ctx.alicePage, ctx.timeoutMs),
        openGlobalFeed(ctx.bobPage, ctx.timeoutMs),
      ]);
      const aliceMatches = testId(ctx.alicePage, "sm-feed-item").filter({
        hasText: livePost.data.postText,
      });
      const bobCard = testId(ctx.bobPage, "sm-feed-item")
        .filter({ hasText: livePost.data.postText })
        .first();
      const repost = testId(bobCard, "sm-post-repost");
      const before = await aliceMatches.count();
      await repost.click();
      const added = await waitForCount(
        aliceMatches,
        (count) => count > before,
        ctx.timeoutMs,
        "attributed repost in Alice's feed",
      );
      await locatorWithSemanticValue(
        testId(aliceMatches, "sm-feed-repost-attribution"),
        "bob",
        ctx.timeoutMs,
        "Bob repost attribution",
      );
      await repost.click();
      const removed = await waitForCount(
        aliceMatches,
        (count) => count === before,
        ctx.timeoutMs,
        "repost removal in Alice's feed",
      );
      return {
        metrics: {
          repostVisibleMs: rounded(added.elapsedMs),
          unrepostVisibleMs: rounded(removed.elapsedMs),
        },
      };
    },
  );
  await ctx.check(
    "m2",
    "repost-following-feed-surface",
    { bestOf: 3 },
    async (attempt) => {
      // @ref LLP 0201#d1--the-app-and-why-this-app — viewer-repost is implicit
      // self-follow, not a follow-edge hit.
      const postText = `choreo-${ctx.runId}-m2-reproj-${attempt}`;
      await composeTextPost(ctx.alicePage, postText, ctx.timeoutMs);

      const followingBefore = await waitForFeedProjection(
        ctx.bobPage,
        "sm-feed-tab-following",
        postText,
        () => true,
        ctx.timeoutMs,
        "Bob's Following feed before follow-edge setup",
      );
      if (followingBefore.value.direct) {
        await toggleFollow(ctx, ctx.bobPage, "alice");
        await waitForFeedProjection(
          ctx.bobPage,
          "sm-feed-tab-following",
          postText,
          (value) => !value.direct,
          ctx.timeoutMs,
          "Alice original removed from Following so Bob is unfollowed",
        );
      }

      await waitForFeedProjection(
        ctx.bobPage,
        "sm-feed-tab-global",
        postText,
        (value) => value.total > 0,
        ctx.timeoutMs,
        "unfollowed author's original remains in Global",
      );

      await openGlobalFeed(ctx.bobPage, ctx.timeoutMs);
      const bobCard = testId(ctx.bobPage, "sm-feed-item").filter({ hasText: postText }).first();
      await clickVisible(testId(bobCard, "sm-post-repost"), ctx.timeoutMs);

      const afterRepost = await waitForFeedProjection(
        ctx.bobPage,
        "sm-feed-tab-following",
        postText,
        (value) => value.viewerRepost,
        ctx.timeoutMs,
        "viewer-repost of unfollowed author in Following",
      );
      if (afterRepost.value.direct) {
        throw new Error(
          "viewer-repost of an unfollowed author was counted as a direct follow-projection hit",
        );
      }

      const started = performance.now();
      await toggleFollow(ctx, ctx.bobPage, "alice");
      await waitForFeedProjection(
        ctx.bobPage,
        "sm-feed-tab-following",
        postText,
        (value) => value.direct,
        ctx.timeoutMs,
        "followed author's original via the follow edge",
      );
      return {
        metrics: { followProjectionVisibleMs: rounded(performance.now() - started) },
      };
    },
  );

  await ctx.check(
    "m2",
    "reply-live-thread-projection",
    { bestOf: 3 },
    async (attempt) => {
      if (!livePost.data?.postText) throw new Error("live-post prerequisite did not yield a post");
      await Promise.all([
        openGlobalFeed(ctx.alicePage, ctx.timeoutMs),
        openGlobalFeed(ctx.bobPage, ctx.timeoutMs),
      ]);
      const replyText = `choreo-${ctx.runId}-m2-reply-${attempt}`;
      const aliceCard = testId(ctx.alicePage, "sm-feed-item")
        .filter({ hasText: livePost.data.postText })
        .first();
      const aliceReplyState = testId(aliceCard, "sm-post-reply");
      const before = await observableState(aliceReplyState);
      const bobCard = testId(ctx.bobPage, "sm-feed-item")
        .filter({ hasText: livePost.data.postText })
        .first();
      let enteredThread = false;
      let replyCountVisibleMs = null;
      try {
        await testId(bobCard, "sm-post-reply").click();
        enteredThread = true;
        await testId(ctx.bobPage, "sm-compose-input").fill(replyText);
        await testId(ctx.bobPage, "sm-compose-submit").click();
        const changed = await waitForStateChange(
          aliceReplyState,
          before,
          ctx.timeoutMs,
          "Alice's live reply count",
        );
        const threadItems = testId(ctx.bobPage, "sm-feed-item");
        await waitForLocator(threadItems.filter({ hasText: replyText }).first(), {
          state: "visible",
          timeout: ctx.timeoutMs,
        });
        const texts = await visibleTexts(threadItems);
        const parentIndex = texts.findIndex((text) => text.includes(livePost.data.postText));
        const replyIndex = texts.findIndex((text) => text.includes(replyText));
        if (parentIndex < 0 || replyIndex <= parentIndex) {
          throw new Error("thread did not show parent followed by the direct reply");
        }
        replyCountVisibleMs = rounded(changed.elapsedMs);
      } finally {
        if (enteredThread) await ctx.bobPage.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
      }
      await openGlobalFeed(ctx.bobPage, ctx.timeoutMs);
      const visibleFeedReplies = await visibleTexts(
        testId(ctx.bobPage, "sm-feed-item").filter({ hasText: replyText }),
      );
      if (visibleFeedReplies.length > 0) {
        throw new Error("direct reply appeared in the Global feed");
      }
      await openFollowingFeed(ctx.bobPage, ctx.timeoutMs);
      const visibleFollowingReplies = await visibleTexts(
        testId(ctx.bobPage, "sm-feed-item").filter({ hasText: replyText }),
      );
      if (visibleFollowingReplies.length > 0) {
        throw new Error("direct reply appeared in the Following feed");
      }
      return { metrics: { replyCountVisibleMs } };
    },
  );
}

async function m3(ctx) {
  const liveDm = await ctx.check(
    "m3",
    "dm-live-messages",
    { bestOf: 3 },
    async (attempt) => {
      await openAliceBobConversation(ctx);
      const outbound = `choreo-${ctx.runId}-m3-live-${attempt}`;
      const started = performance.now();
      await sendConversationText(ctx.alicePage, outbound, ctx.timeoutMs);
      const bobBubble = testId(ctx.bobPage, "sm-convo-bubble")
        .filter({ hasText: outbound })
        .last();
      await waitForLocator(bobBubble, { state: "visible", timeout: ctx.timeoutMs });
      const visibleMs = rounded(performance.now() - started);
      const reply = `choreo-${ctx.runId}-m3-live-reply-${attempt}`;
      await sendConversationText(ctx.bobPage, reply, ctx.timeoutMs);
      await waitForLocator(
        testId(ctx.alicePage, "sm-convo-bubble")
          .filter({ hasText: reply })
          .last(),
        { state: "visible", timeout: ctx.timeoutMs },
      );
      return {
        metrics: { visibleMs },
        data: { outbound },
        note: "required bidirectional live DM text delivery",
      };
    },
  );
  const avatarBubble = liveDm.data?.outbound
    ? testId(ctx.bobPage, "sm-convo-bubble").filter({ hasText: liveDm.data.outbound }).last()
    : null;
  const avatar = avatarBubble === null
    ? null
    : testId(avatarBubble, "sm-convo-sender-avatar");
  const avatarRendered = avatar !== null && (await avatar.count()) > 0;
  await ctx.check(
    "m3",
    "sender-avatar-identity-when-rendered",
    {
      implemented: avatarRendered,
      required: false,
      reason: avatarRendered
        ? null
        : "The kit does not render sender avatars in the default 1:1 layout; identity is checked only when the app opts into that node.",
    },
    avatarRendered
      ? async () => {
          await locatorWithSemanticValue(
            avatar,
            "alice",
            ctx.timeoutMs,
            "Alice sender avatar",
          );
          return { note: "exact sender identity on an app-rendered avatar node" };
        }
      : null,
  );
  await ctx.check(
    "m3",
    "typing-indicator-within-2s-expires-within-5s",
    {
      bestOf: 3,
      typingObservationBoundaryVersion: TYPING_OBSERVATION_BOUNDARY_VERSION,
    },
    async (attempt) => {
      await openAliceBobConversation(ctx);
      const bobInput = testId(ctx.bobPage, "sm-convo-input");
      const aliceIndicator = testId(ctx.alicePage, "sm-convo-typing");
      await bobInput.fill("");
      await waitForLocator(aliceIndicator, { state: "hidden", timeout: 5_000 });
      const typingText = `typing-${ctx.runId}-${attempt}`;
      const typingActionStartedAt = performance.now();
      await bobInput.pressSequentially(typingText.slice(0, -1), { delay: 25 });
      // v2 boundary: the delivery clock begins at the final keystroke action,
      // not before the whole synthetic typing sequence and not after its
      // resulting render may already have happened.
      const lastKeystrokeAt = performance.now();
      await bobInput.press(typingText.at(-1));
      const lastKeystrokeSettledAt = performance.now();
      await waitForLocator(aliceIndicator, { state: "visible", timeout: 2_000 });
      const visibleAfterLastKeystrokeMs = rounded(performance.now() - lastKeystrokeAt);
      const remainingExpiryMs = Math.max(
        1,
        Math.floor(5_000 - (performance.now() - lastKeystrokeAt)),
      );
      await waitForLocator(aliceIndicator, { state: "hidden", timeout: remainingExpiryMs });
      const expiresAfterLastKeystrokeMs = rounded(performance.now() - lastKeystrokeAt);
      if (visibleAfterLastKeystrokeMs > 2_000 || expiresAfterLastKeystrokeMs > 5_000) {
        throw new Error(
          `typing timing missed ceiling: render=${visibleAfterLastKeystrokeMs}ms expires=${expiresAfterLastKeystrokeMs}ms`,
        );
      }
      return {
        metrics: {
          typingActionMs: rounded(lastKeystrokeSettledAt - typingActionStartedAt),
          finalKeystrokeActionMs: rounded(lastKeystrokeSettledAt - lastKeystrokeAt),
          visibleAfterLastKeystrokeMs,
          expiresAfterLastKeystrokeMs,
        },
        note: "typing action time is separate from post-keystroke render and expiry clocks",
      };
    },
  );

  await ctx.check("m3", "receipt-sent-delivered-read-transitions", {}, async () => {
    await openConversationFromAnySurface(ctx, ctx.alicePage, "Bob");
    await ctx.bobPage.goto(ctx.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: ctx.timeoutMs,
    });
    await setContextsOffline([ctx.bobContext], true);
    try {
      const text = `choreo-${ctx.runId}-m3-receipt`;
      const bubble = await sendConversationText(ctx.alicePage, text, ctx.timeoutMs);
      const receipt = testId(bubble, "sm-convo-receipt");
      await locatorWithSemanticValue(receipt, "sent", ctx.timeoutMs, "sent receipt");
      await setContextsOffline([ctx.bobContext], false);
      await locatorWithSemanticValue(receipt, "delivered", ctx.timeoutMs, "delivered receipt");
      await openConversationFromAnySurface(ctx, ctx.bobPage, "Alice");
      await waitForLocator(
        testId(ctx.bobPage, "sm-convo-bubble").filter({ hasText: text }).last(),
        { state: "visible", timeout: ctx.timeoutMs },
      );
      await locatorWithSemanticValue(receipt, "read", ctx.timeoutMs, "read receipt");
      return { note: "exact semantic sent/delivered/read tokens; no glyph matching" };
    } finally {
      await setContextsOffline([ctx.bobContext], false);
    }
  });

  await ctx.check("m3", "group-receipt-waits-for-slowest-member", {}, async () => {
    if (!ctx.carolPage) throw new Error("Carol's context is required for group receipt checks");
    await Promise.all([
      openGroupConversation(ctx, ctx.alicePage),
      openGroupConversation(ctx, ctx.bobPage),
    ]);
    await ctx.carolPage.goto(ctx.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: ctx.timeoutMs,
    });
    const text = `choreo-${ctx.runId}-m3-group-receipt`;
    const bubble = await sendConversationText(ctx.alicePage, text, ctx.timeoutMs);
    await waitForLocator(
      testId(ctx.bobPage, "sm-convo-bubble").filter({ hasText: text }).last(),
      { state: "visible", timeout: ctx.timeoutMs },
    );
    const receipt = testId(bubble, "sm-convo-receipt");
    await locatorWithSemanticValue(receipt, "delivered", ctx.timeoutMs, "group delivered receipt");
    await openGroupConversation(ctx, ctx.carolPage);
    await waitForLocator(
      testId(ctx.carolPage, "sm-convo-bubble").filter({ hasText: text }).last(),
      { state: "visible", timeout: ctx.timeoutMs },
    );
    await locatorWithSemanticValue(receipt, "read", ctx.timeoutMs, "group aggregate read receipt");
    return { note: "group read remains delivered until the slowest retained member reads" };
  });

  await ctx.check("m3", "member-add-promote-remove-leave-and-live-cutoff", {}, async () => {
    if (!ctx.davePage) throw new Error("Dave's context is required for membership checks");
    const handle = ctx.adapter.fixtures.addedMemberHandle;
    await openGroupSettings(ctx, ctx.alicePage);
    await clickVisible(testId(ctx.alicePage, "sm-chatsettings-member-add"), ctx.timeoutMs);
    const candidate = await locatorWithSemanticValue(
      testId(ctx.alicePage, "sm-chatsettings-member-candidate"),
      handle,
      ctx.timeoutMs,
      "addable group member",
    );
    await candidate.click();
    let member = await locatorWithSemanticValue(
      testId(ctx.alicePage, "sm-chatsettings-member"),
      `${handle}:member`,
      ctx.timeoutMs,
      "added group member",
    );
    await clickVisible(testId(member, "sm-chatsettings-member-promote"), ctx.timeoutMs);
    member = await locatorWithSemanticValue(
      testId(ctx.alicePage, "sm-chatsettings-member"),
      `${handle}:admin`,
      ctx.timeoutMs,
      "promoted group member",
    );
    await openGroupConversation(ctx, ctx.alicePage);
    await openGroupConversation(ctx, ctx.davePage);
    const retained = `choreo-${ctx.runId}-m3-before-remove`;
    await sendConversationText(ctx.alicePage, retained, ctx.timeoutMs);
    await waitForLocator(
      testId(ctx.davePage, "sm-convo-bubble").filter({ hasText: retained }).last(),
      { state: "visible", timeout: ctx.timeoutMs },
    );
    await openGroupSettings(ctx, ctx.alicePage);
    member = await locatorWithSemanticValue(
      testId(ctx.alicePage, "sm-chatsettings-member"),
      `${handle}:admin`,
      ctx.timeoutMs,
      "member selected for removal",
    );
    await clickVisible(testId(member, "sm-chatsettings-member-remove"), ctx.timeoutMs);
    const afterRemoval = `choreo-${ctx.runId}-m3-after-remove`;
    await openGroupConversation(ctx, ctx.alicePage);
    await sendConversationText(ctx.alicePage, afterRemoval, ctx.timeoutMs);
    const progressMarker = `choreo-${ctx.runId}-m3-cutoff-progress`;
    const daveProgressPage = await ctx.daveContext.newPage();
    try {
      await Promise.all([
        openConversationFromAnySurface(ctx, ctx.alicePage, "Dave"),
        openConversationFromAnySurface(ctx, daveProgressPage, "Alice"),
      ]);
      await sendConversationText(ctx.alicePage, progressMarker, ctx.timeoutMs);
      await waitForLocator(
        testId(daveProgressPage, "sm-convo-bubble").filter({ hasText: progressMarker }).last(),
        { state: "visible", timeout: ctx.timeoutMs },
      );
    } finally {
      await daveProgressPage.close();
    }
    if ((await testId(ctx.davePage, "sm-convo-bubble").filter({ hasText: afterRemoval }).count()) > 0) {
      throw new Error("removed member received a new live group message");
    }
    if ((await testId(ctx.davePage, "sm-convo-bubble").filter({ hasText: retained }).count()) !== 1) {
      throw new Error("removed member lost or duplicated retained group history");
    }

    await openGroupSettings(ctx, ctx.alicePage);
    await clickVisible(testId(ctx.alicePage, "sm-chatsettings-member-add"), ctx.timeoutMs);
    const readd = await locatorWithSemanticValue(
      testId(ctx.alicePage, "sm-chatsettings-member-candidate"),
      handle,
      ctx.timeoutMs,
      "member candidate after removal",
    );
    await readd.click();
    await locatorWithSemanticValue(
      testId(ctx.alicePage, "sm-chatsettings-member"),
      `${handle}:member`,
      ctx.timeoutMs,
      "re-added group member",
    );
    await openGroupSettings(ctx, ctx.davePage);
    await clickVisible(testId(ctx.davePage, "sm-chatsettings-leave"), ctx.timeoutMs);
    await openGroupSettings(ctx, ctx.alicePage);
    await waitForValue(
      testId(ctx.alicePage, "sm-chatsettings-member"),
      async (rows) => {
        const values = [];
        for (let index = 0; index < (await rows.count()); index += 1) {
          values.push(await semanticValue(rows.nth(index)));
        }
        return { matched: !values.some((value) => value.startsWith(`${handle}:`)), value: values };
      },
      ctx.timeoutMs,
      "voluntary member leave",
    );
    return {
      note: "live cutoff is checked only after a subsequent direct-message progress marker reaches the removed member",
    };
  });

  await ctx.check(
    "m3",
    "quoted-reply-excerpt-and-jump",
    { bestOf: 3, required: false },
    async (attempt) => {
      await openAliceBobConversation(ctx);
      const original = `choreo-${ctx.runId}-m3-original-${attempt}`;
      const reply = `choreo-${ctx.runId}-m3-quote-${attempt}`;
      await sendConversationText(ctx.alicePage, original, ctx.timeoutMs);
      const bobOriginal = testId(ctx.bobPage, "sm-convo-bubble").filter({ hasText: original }).last();
      await waitForLocator(bobOriginal, { state: "visible", timeout: ctx.timeoutMs });
      await testId(bobOriginal, "sm-convo-quote").click();
      await sendConversationText(ctx.bobPage, reply, ctx.timeoutMs);
      const aliceReply = testId(ctx.alicePage, "sm-convo-bubble").filter({ hasText: reply }).last();
      await waitForLocator(aliceReply, { state: "visible", timeout: ctx.timeoutMs });
      if (!(await aliceReply.innerText()).includes(original)) {
        throw new Error("quoted reply bubble did not render the original excerpt");
      }
      await testId(aliceReply, "sm-convo-quote-preview").click();
      const aliceOriginal = testId(ctx.alicePage, "sm-convo-bubble")
        .filter({ hasText: original })
        .last();
      await waitForLocator(aliceOriginal, { state: "visible", timeout: ctx.timeoutMs });
      const inViewport = await aliceOriginal.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      });
      if (!inViewport) throw new Error("quoted-excerpt activation did not jump to the original");
      return { note: "quoted-excerpt jump selector: sm-convo-quote-preview" };
    },
  );
}

async function m4(ctx) {
  const photo = await ctx.check(
    "m4",
    "photo-message-live-render",
    { bestOf: 3 },
    async (attempt) => {
      await openAliceBobConversation(ctx);
      const caption = `choreo-${ctx.runId}-m4-photo-${attempt}`;
      await setFileThroughControl(
        ctx.alicePage,
        "sm-convo-file",
        "sm-convo-attach",
        fixturePath(ctx, "image"),
        ctx.timeoutMs,
      );
      await testId(ctx.alicePage, "sm-convo-input").fill(caption);
      const started = performance.now();
      await testId(ctx.alicePage, "sm-convo-send").click();
      const bubble = testId(ctx.bobPage, "sm-convo-bubble").filter({ hasText: caption }).last();
      await waitForLocator(bubble, { state: "visible", timeout: ctx.timeoutMs });
      await waitForLoadedMedia(testId(bubble, "sm-convo-media"), "image", ctx.timeoutMs);
      return {
        metrics: { visibleMs: rounded(performance.now() - started) },
        data: { caption },
      };
    },
  );

  await ctx.check("m4", "video-message-live-playback", {}, async () => {
    await openAliceBobConversation(ctx);
    const caption = `choreo-${ctx.runId}-m4-video`;
    await setFileThroughControl(
      ctx.alicePage,
      "sm-convo-file",
      "sm-convo-attach",
      fixturePath(ctx, "video"),
      ctx.timeoutMs,
    );
    await testId(ctx.alicePage, "sm-convo-input").fill(caption);
    await testId(ctx.alicePage, "sm-convo-send").click();
    const bubble = testId(ctx.bobPage, "sm-convo-bubble").filter({ hasText: caption }).last();
    await waitForLocator(bubble, { state: "visible", timeout: ctx.timeoutMs });
    const inline = testId(bubble, "sm-convo-media");
    const hasInlineVideo =
      (await inline.count()) > 0 &&
      (await inline.first().evaluate(
        (element) =>
          element instanceof HTMLVideoElement || element.querySelector("video") !== null,
      ));
    if (hasInlineVideo) {
      await waitForLoadedMedia(inline, "video", ctx.timeoutMs);
    } else {
      await clickVisible(inline, ctx.timeoutMs);
      const viewer = testId(ctx.bobPage, "sm-media-viewer-video");
      await waitForLoadedMedia(viewer, "video", ctx.timeoutMs);
      await clickVisible(testId(ctx.bobPage, "sm-media-viewer-close"), ctx.timeoutMs);
    }
    return {};
  });

  await ctx.check(
    "m4",
    "reaction-live-replace-remove",
    { bestOf: 3 },
    async () => {
      if (!photo.data?.caption) throw new Error("photo prerequisite did not yield a caption");
      await openAliceBobConversation(ctx);
      const bobBubble = testId(ctx.bobPage, "sm-convo-bubble")
        .filter({ hasText: photo.data.caption })
        .last();
      const aliceBubble = testId(ctx.alicePage, "sm-convo-bubble")
        .filter({ hasText: photo.data.caption })
        .last();
      await Promise.all([
        waitForLocator(bobBubble, { state: "visible", timeout: ctx.timeoutMs }),
        waitForLocator(aliceBubble, { state: "visible", timeout: ctx.timeoutMs }),
      ]);

      const started = performance.now();
      await openAction(ctx.bobPage, bobBubble, "sm-convo-react", ctx.timeoutMs);
      await clickVisible(
        testId(ctx.bobPage, "sm-convo-reaction").filter({ hasText: "👍" }),
        ctx.timeoutMs,
      );
      const aliceThumb = testId(aliceBubble, "sm-convo-reaction-chip").filter({ hasText: "👍" });
      await waitForLocator(aliceThumb, { state: "visible", timeout: ctx.timeoutMs });
      const setVisibleMs = rounded(performance.now() - started);

      await openAction(ctx.bobPage, bobBubble, "sm-convo-react", ctx.timeoutMs);
      await clickVisible(
        testId(ctx.bobPage, "sm-convo-reaction").filter({ hasText: "❤️" }),
        ctx.timeoutMs,
      );
      await waitForLocator(aliceThumb, { state: "hidden", timeout: ctx.timeoutMs });
      const aliceHeart = testId(aliceBubble, "sm-convo-reaction-chip").filter({ hasText: "❤️" });
      await waitForLocator(aliceHeart, { state: "visible", timeout: ctx.timeoutMs });
      if ((await testId(aliceBubble, "sm-convo-reaction-chip").count()) !== 1) {
        throw new Error("reaction replacement left more than one reaction chip");
      }

      await openAction(ctx.bobPage, bobBubble, "sm-convo-react", ctx.timeoutMs);
      await clickVisible(
        testId(ctx.bobPage, "sm-convo-reaction").filter({ hasText: "❤️" }),
        ctx.timeoutMs,
      );
      await waitForLocator(aliceHeart, { state: "hidden", timeout: ctx.timeoutMs });
      return { metrics: { visibleMs: setVisibleMs } };
    },
  );

  await ctx.check(
    "m4",
    "edit-live-visibility",
    { bestOf: 3 },
    async (attempt) => {
      await openAliceBobConversation(ctx);
      const original = `choreo-${ctx.runId}-m4-edit-${attempt}`;
      const edited = `${original}-edited`;
      const aliceBubble = await sendConversationText(ctx.alicePage, original, ctx.timeoutMs);
      await waitForLocator(
        testId(ctx.bobPage, "sm-convo-bubble")
          .filter({ hasText: original })
          .last(),
        { state: "visible", timeout: ctx.timeoutMs },
      );
      await openAction(ctx.alicePage, aliceBubble, "sm-convo-edit", ctx.timeoutMs);
      await testId(ctx.alicePage, "sm-convo-input").fill(edited);
      const started = performance.now();
      await testId(ctx.alicePage, "sm-convo-send").click();
      const bobEdited = testId(ctx.bobPage, "sm-convo-bubble").filter({ hasText: edited }).last();
      await waitForLocator(bobEdited, { state: "visible", timeout: ctx.timeoutMs });
      if (!/edited/i.test(await bobEdited.innerText())) {
        throw new Error("recipient bubble did not expose the edited label");
      }
      return { metrics: { visibleMs: rounded(performance.now() - started) } };
    },
  );

  await ctx.check("m4", "delete-live-tombstone", {}, async () => {
    await openAliceBobConversation(ctx);
    const text = `choreo-${ctx.runId}-m4-delete`;
    const aliceBubble = await sendConversationText(ctx.alicePage, text, ctx.timeoutMs);
    const bobBubble = testId(ctx.bobPage, "sm-convo-bubble").filter({ hasText: text }).last();
    await waitForLocator(bobBubble, { state: "visible", timeout: ctx.timeoutMs });
    const tombstones = testId(ctx.bobPage, "sm-convo-tombstone");
    const before = await tombstones.count();
    await openAction(ctx.alicePage, aliceBubble, "sm-convo-delete", ctx.timeoutMs);
    await waitForCount(
      tombstones,
      (count) => count > before,
      ctx.timeoutMs,
      "Bob's delete-for-everyone tombstone",
    );
    const tombstoneText = await tombstones.last().innerText();
    if (!/message was deleted|deleted/i.test(tombstoneText)) {
      throw new Error(`unexpected tombstone text: ${tombstoneText}`);
    }
    return {};
  });
}

async function controlValue(locator) {
  return locator.evaluate((element) =>
    element.getAttribute("data-value") ??
    element.getAttribute("aria-valuetext") ??
    element.getAttribute("aria-label") ??
    element.getAttribute("value") ??
    (element.textContent ?? "").trim(),
  );
}

async function selectedControl(locator, value) {
  for (let index = 0; index < (await locator.count()); index += 1) {
    const candidate = locator.nth(index);
    if ((await controlValue(candidate)) !== value) continue;
    const selected = await candidate.evaluate((element) =>
      element.getAttribute("aria-pressed") === "true" ||
      element.getAttribute("aria-selected") === "true" ||
      element.getAttribute("data-selected") === "true" ||
      (element instanceof HTMLInputElement && element.checked),
    );
    if (selected) return candidate;
  }
  return null;
}

async function selectControlOption(locator, value, timeoutMs) {
  await waitForLocator(locator.first(), { state: "visible", timeout: timeoutMs });
  const firstTag = await locator.first().evaluate((element) => element.tagName.toLowerCase());
  if (firstTag === "select") {
    await locator.first().selectOption(value);
    return;
  }
  for (let index = 0; index < (await locator.count()); index += 1) {
    const candidate = locator.nth(index);
    if ((await controlValue(candidate)) === value) {
      await candidate.click();
      return;
    }
  }
  throw new Error(`control did not expose option value ${value}`);
}

async function m5(ctx) {
  await ctx.check("m5", "chat-color-background-sync", {}, async () => {
    if (!ctx.carolPage) throw new Error("Carol's context is required for chat customization");
    await Promise.all([
      openGroupConversation(ctx, ctx.alicePage),
      openGroupConversation(ctx, ctx.carolPage),
    ]);
    await Promise.all([
      clickVisible(testId(ctx.alicePage, "sm-convo-settings"), ctx.timeoutMs),
      clickVisible(testId(ctx.carolPage, "sm-convo-settings"), ctx.timeoutMs),
    ]);
    const aliceColors = testId(ctx.alicePage, "sm-chatsettings-color");
    const carolColors = testId(ctx.carolPage, "sm-chatsettings-color");
    await Promise.all([
      waitForLocator(aliceColors.first(), { state: "visible", timeout: ctx.timeoutMs }),
      waitForLocator(carolColors.first(), { state: "visible", timeout: ctx.timeoutMs }),
    ]);
    if ((await aliceColors.count()) < 2) {
      throw new Error("chat settings must expose at least two color choices");
    }
    let target = aliceColors.nth(0);
    for (let index = 0; index < (await aliceColors.count()); index += 1) {
      const candidate = aliceColors.nth(index);
      const selected = await selectedControl(aliceColors, await controlValue(candidate));
      if (!selected) {
        target = candidate;
        break;
      }
    }
    const targetValue = await controlValue(target);
    const started = performance.now();
    await target.click();
    await waitForValue(
      carolColors,
      async (controls) => ({
        matched: (await selectedControl(controls, targetValue)) !== null,
        value: targetValue,
      }),
      ctx.timeoutMs,
      `Carol's selected chat color ${targetValue}`,
    );

    const carolPreview = testId(ctx.carolPage, "sm-chatsettings-background-preview");
    const before = await observableState(carolPreview);
    await setFileThroughControl(
      ctx.alicePage,
      "sm-chatsettings-background",
      "sm-chatsettings-background",
      fixturePath(ctx, "background"),
      ctx.timeoutMs,
    );
    await waitForStateChange(
      carolPreview,
      before,
      ctx.timeoutMs,
      "Carol's synchronized chat background",
    );
    await waitForLoadedMedia(carolPreview, "image", ctx.timeoutMs);
    return { metrics: { visibleMs: rounded(performance.now() - started) } };
  });

  await ctx.check(
    "m5",
    "view-once-single-view-and-refusal",
    { required: false },
    async () => {
      await openAliceBobConversation(ctx);
      const caption = `choreo-${ctx.runId}-m5-view-once`;
      await setFileThroughControl(
        ctx.alicePage,
        "sm-convo-file",
        "sm-convo-attach",
        fixturePath(ctx, "image"),
        ctx.timeoutMs,
      );
      await clickVisible(testId(ctx.alicePage, "sm-convo-viewonce-toggle"), ctx.timeoutMs);
      await testId(ctx.alicePage, "sm-convo-input").fill(caption);
      await testId(ctx.alicePage, "sm-convo-send").click();
      const bubble = testId(ctx.bobPage, "sm-convo-bubble")
        .filter({ hasText: caption })
        .last();
      const affordance = testId(bubble, "sm-convo-viewonce");
      await waitForLocator(affordance, { state: "visible", timeout: ctx.timeoutMs });
      await affordance.click();
      const viewer = testId(ctx.bobPage, "sm-media-viewer-image");
      await waitForLoadedMedia(viewer, "image", ctx.timeoutMs);
      await clickVisible(testId(ctx.bobPage, "sm-media-viewer-close"), ctx.timeoutMs);
      await affordance.click().catch(() => {});
      const denied = testId(ctx.bobPage, "sm-convo-error");
      const state = await semanticValue(affordance).catch(() => "");
      if (state !== "opened") {
        await waitForLocator(denied.first(), { state: "visible", timeout: ctx.timeoutMs });
      }
      if ((await viewer.count()) > 0 && (await viewer.isVisible())) {
        throw new Error("view-once media rendered on the second open");
      }
      return {};
    },
  );

  await ctx.check("m5", "warm-offline-search-over-synced-messages", {}, async () => {
    await openAliceBobConversation(ctx);
    await waitForLocator(testId(ctx.alicePage, "sm-convo-bubble").first(), {
      state: "visible",
      timeout: ctx.timeoutMs,
    });
    await ctx.alicePage.goto(routeUrl(ctx, "search"), {
      waitUntil: "domcontentloaded",
      timeout: ctx.timeoutMs,
    });
    await waitForLocator(testId(ctx.alicePage, "sm-search-input"), {
      state: "visible",
      timeout: ctx.timeoutMs,
    });
    await setContextsOffline([ctx.aliceContext], true);
    try {
      await testId(ctx.alicePage, "sm-search-input").fill(ctx.adapter.fixtures.searchToken);
      await waitForLocator(
        testId(ctx.alicePage, "sm-search-result")
          .filter({ hasText: ctx.adapter.fixtures.searchExpected })
          .first(),
        { state: "visible", timeout: ctx.timeoutMs },
      );
      await waitForLocator(testId(ctx.alicePage, "sm-search-offline"), {
        state: "visible",
        timeout: ctx.timeoutMs,
      });
    } finally {
      await setContextsOffline([ctx.aliceContext], false);
    }
    return {};
  });

  await ctx.check(
    "m5",
    "disappearing-message-expiry-and-purge",
    { required: false },
    async () => {
      await openAliceBobConversation(ctx);
      await clickVisible(testId(ctx.alicePage, "sm-convo-settings"), ctx.timeoutMs);
      const disappearing = testId(ctx.alicePage, "sm-chatsettings-disappearing");
      await selectControlOption(
        disappearing,
        ctx.adapter.disappearing.optionValue,
        ctx.timeoutMs,
      );
      await ctx.alicePage.goto(ctx.baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: ctx.timeoutMs,
      });
      await openAliceBobConversation(ctx);
      const text = `choreo-${ctx.runId}-m5-expiring`;
      await sendConversationText(ctx.alicePage, text, ctx.timeoutMs);
      await waitForLocator(
        testId(ctx.bobPage, "sm-convo-bubble")
          .filter({ hasText: text })
          .last(),
        { state: "visible", timeout: ctx.timeoutMs },
      );
      await Promise.all([ctx.alicePage.close(), ctx.bobPage.close()]);
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, ctx.adapter.disappearing.waitMs),
      );
      await Promise.all([reopenPersona(ctx, "alice"), reopenPersona(ctx, "bob")]);
      await Promise.all([
        openConversationFromAnySurface(ctx, ctx.alicePage, "Bob"),
        openConversationFromAnySurface(ctx, ctx.bobPage, "Alice"),
      ]);
      const visible = await Promise.all([
        visibleTexts(testId(ctx.alicePage, "sm-convo-bubble").filter({ hasText: text })),
        visibleTexts(testId(ctx.bobPage, "sm-convo-bubble").filter({ hasText: text })),
      ]);
      if (visible.some((values) => values.length > 0)) {
        throw new Error("expired message remained visible after both clients relaunched");
      }
      return {};
    },
  );
}

async function m6(ctx) {
  await ctx.check(
    "m6",
    "offline-message-queue-flush-in-order",
    { bestOf: 1 },
    async () => {
      await openAliceBobConversation(ctx);
      const first = `choreo-${ctx.runId}-m6-offline-1`;
      const second = `choreo-${ctx.runId}-m6-offline-2`;
      await setContextsOffline([ctx.aliceContext], true);
      let firstBubble;
      let secondBubble;
      try {
        firstBubble = await sendConversationText(ctx.alicePage, first, ctx.timeoutMs);
        secondBubble = await sendConversationText(ctx.alicePage, second, ctx.timeoutMs);
        for (const bubble of [firstBubble, secondBubble]) {
          const receipt = testId(bubble, "sm-convo-receipt");
          await waitForLocator(receipt, { state: "visible", timeout: ctx.timeoutMs });
          const state = await semanticValue(receipt);
          if (state !== "pending") {
            throw new Error(`offline message did not expose a pending state: ${state}`);
          }
        }
      } finally {
        await setContextsOffline([ctx.aliceContext], false);
      }

      const flushStarted = performance.now();
      const bobFirst = testId(ctx.bobPage, "sm-convo-bubble").filter({ hasText: first }).last();
      const bobSecond = testId(ctx.bobPage, "sm-convo-bubble").filter({ hasText: second }).last();
      await waitForLocator(bobFirst, { state: "visible", timeout: ctx.timeoutMs });
      await waitForLocator(bobSecond, { state: "visible", timeout: ctx.timeoutMs });
      const flushMs = rounded(performance.now() - flushStarted);
      const texts = await visibleTexts(testId(ctx.bobPage, "sm-convo-bubble"));
      const firstIndex = texts.findIndex((text) => text.includes(first));
      const secondIndex = texts.findIndex((text) => text.includes(second));
      if (firstIndex < 0 || secondIndex <= firstIndex) {
        throw new Error("queued messages did not render on Bob in send order");
      }

      for (const bubble of [firstBubble, secondBubble]) {
        const receipt = testId(bubble, "sm-convo-receipt");
        await waitForValue(
          receipt,
          async (target) => {
            const value = await semanticValue(target);
            return { matched: value === "read", value };
          },
          ctx.timeoutMs,
          "normal read receipt after offline flush",
        );
      }
      return { metrics: { flushMs } };
    },
  );
}

async function pollOption(page, optionId, timeoutMs) {
  return locatorWithSemanticValue(
    testId(page, "sm-poll-option"),
    optionId,
    timeoutMs,
    `poll option ${optionId}`,
  );
}

async function pollTally(option) {
  const value = await semanticValue(testId(option, "sm-poll-tally"));
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new Error(`poll tally must expose a non-negative integer semantic value; received ${value}`);
  }
  return numeric;
}

async function pollSelection(option) {
  return option.evaluate((element) => {
    for (const name of ["aria-pressed", "aria-selected", "data-selected"]) {
      const value = element.getAttribute(name)?.toLowerCase();
      if (["true", "1"].includes(value)) return true;
      if (["false", "0"].includes(value)) return false;
    }
    return null;
  });
}

// M7 is intentionally a fresh-session choreography segment. It is never
// included in CONTINUOUS_SEGMENTS and parseSegments refuses a mixed M7 run.
async function m7(ctx) {
  const liveVoteAttempts = [
    { actor: "alice", observer: "bob", optionFixture: "pollOptionId" },
    { actor: "alice", observer: "bob", optionFixture: "pollAlternateOptionId" },
    { actor: "bob", observer: "alice", optionFixture: "pollOptionId" },
  ];
  await ctx.check("m7", "m7-a02-live-poll-tallies", { bestOf: 3 }, async (attempt) => {
    await Promise.all([
      openGroupConversation(ctx, ctx.alicePage),
      openGroupConversation(ctx, ctx.bobPage),
    ]);
    const vote = liveVoteAttempts[attempt - 1];
    const optionId = ctx.adapter.fixtures[vote.optionFixture];
    const actorPage = ctx[`${vote.actor}Page`];
    const observerPage = ctx[`${vote.observer}Page`];
    const actorOption = await pollOption(actorPage, optionId, ctx.timeoutMs);
    const observerOption = await pollOption(observerPage, optionId, ctx.timeoutMs);
    const before = await pollTally(observerOption);
    const started = performance.now();
    await actorOption.click();
    const changed = await waitForValue(
      testId(observerOption, "sm-poll-tally"),
      async () => {
        const value = await pollTally(observerOption);
        return { matched: value === before + 1, value };
      },
      ctx.timeoutMs,
      "other-client poll tally",
    );
    // visibleMs stays click-to-tally; the selection wait below gates segment
    // close but must not sit inside the metric window (0.3.6-m8 boundary).
    const visibleMs = rounded(performance.now() - started);
    const totalValue = Number(await semanticValue(testId(observerPage, "sm-poll-total")));
    if (!Number.isInteger(totalValue) || totalValue < changed.value) {
      throw new Error("poll total did not expose a coherent structural count");
    }
    if (vote.actor === "alice" && vote.optionFixture === "pollAlternateOptionId") {
      await waitForValue(
        actorOption,
        async (target) => {
          const value = await pollSelection(target);
          return { matched: value === true, value };
        },
        ctx.timeoutMs,
        "Alice's switched poll selection",
      );
    }
    return {
      metrics: { visibleMs },
      note: `${vote.actor}/${optionId} is unique across all retained best-of-three attempts`,
    };
  });

  await ctx.check("m7", "m7-a05-offline-vote-reconciles", {}, async () => {
    await Promise.all([
      openGroupConversation(ctx, ctx.alicePage),
      openGroupConversation(ctx, ctx.bobPage),
    ]);
    const optionId = ctx.adapter.fixtures.pollAlternateOptionId;
    const actorOption = await pollOption(ctx.bobPage, optionId, ctx.timeoutMs);
    const observerOption = await pollOption(ctx.alicePage, optionId, ctx.timeoutMs);
    await waitForValue(
      observerOption,
      async (target) => {
        const value = await pollSelection(target);
        return { matched: value === true, value };
      },
      ctx.timeoutMs,
      "Alice's retained switched poll selection",
    );
    const before = await pollTally(observerOption);
    await setContextsOffline([ctx.bobContext], true);
    try {
      await actorOption.click();
      await waitForValue(
        actorOption,
        async (target) => {
          const busy = await target.getAttribute("aria-busy");
          const pending = await target.getAttribute("data-pending");
          return { matched: busy === "true" || pending === "true", value: { busy, pending } };
        },
        ctx.timeoutMs,
        "offline pending vote",
      );
    } finally {
      await setContextsOffline([ctx.bobContext], false);
    }
    await waitForValue(
      testId(observerOption, "sm-poll-tally"),
      async () => {
        const value = await pollTally(observerOption);
        return { matched: value === before + 1, value };
      },
      ctx.timeoutMs,
      "reconciled offline poll vote",
    );
    await waitForValue(
      actorOption,
      async (target) => {
        const busy = await target.getAttribute("aria-busy");
        const pending = await target.getAttribute("data-pending");
        return { matched: busy !== "true" && pending !== "true", value: { busy, pending } };
      },
      ctx.timeoutMs,
      "settled offline poll vote",
    );
    return {
      note: "Bob/alternate-option is distinct from every live-attempt pair; pending clears only after reconciliation",
    };
  });
}

async function findLikesReceivedStat(page, timeoutMs) {
  const stat = testId(page, "sm-insights-total-likes-received");
  await waitForLocator(stat, { state: "visible", timeout: timeoutMs });
  return stat;
}

async function numericStatValue(locator) {
  const value = await locator.evaluate((element) => {
    for (const name of ["data-count", "aria-valuenow", "data-stat-value"]) {
      const raw = element.getAttribute(name);
      if (raw !== null && /^\d[\d,]*$/u.test(raw.trim())) {
        return Number(raw.replaceAll(",", ""));
      }
    }
    const matches = (element.textContent ?? "").match(/\d[\d,]*/gu) ?? [];
    if (matches.length !== 1) return null;
    return Number(matches[0].replaceAll(",", ""));
  });
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("likes-received Insights tile did not expose one non-negative integer");
  }
  return value;
}

async function toggleSelection(locator) {
  return locator.evaluate((element) => {
    for (const name of ["aria-pressed", "aria-selected", "data-selected", "data-liked"]) {
      const value = element.getAttribute(name)?.toLowerCase();
      if (["true", "1", "liked"].includes(value)) return true;
      if (["false", "0", "unliked"].includes(value)) return false;
    }
    return null;
  });
}

async function findUnlikedAlicePost(page, timeoutMs) {
  const cards = testId(page, "sm-feed-item");
  await waitForLocator(cards.first(), { state: "visible", timeout: timeoutMs });
  for (let index = 0; index < (await cards.count()); index += 1) {
    const card = cards.nth(index);
    if (!(await card.isVisible())) continue;
    const author = testId(card, "sm-feed-author-avatar");
    if ((await author.count()) === 0 || (await semanticValue(author.first())) !== "alice") continue;
    const like = testId(card, "sm-post-like");
    if ((await like.count()) === 0 || !(await like.first().isVisible())) continue;
    const selected = await toggleSelection(like.first());
    if (selected === false) return like.first();
  }
  throw new Error("Global feed exposed no observably unliked Alice post for Bob");
}

async function m8(ctx) {
  await ctx.check("m8", "m8-a02-insights-like-refresh", {}, async () => {
    await ctx.alicePage.goto(routeUrl(ctx, "insights"), {
      waitUntil: "domcontentloaded",
      timeout: ctx.timeoutMs,
    });
    const before = await numericStatValue(
      await findLikesReceivedStat(ctx.alicePage, ctx.timeoutMs),
    );

    await openGlobalFeed(ctx.bobPage, ctx.timeoutMs);
    const bobLike = await findUnlikedAlicePost(ctx.bobPage, ctx.timeoutMs);
    const likeState = await observableState(bobLike);
    await bobLike.click();
    await waitForStateChange(
      bobLike,
      likeState,
      ctx.timeoutMs,
      "Bob's committed like toggle",
    );

    const refreshStarted = performance.now();
    await ctx.alicePage.reload({
      waitUntil: "domcontentloaded",
      timeout: ctx.timeoutMs,
    });
    const after = await numericStatValue(
      await findLikesReceivedStat(ctx.alicePage, ctx.timeoutMs),
    );
    if (after !== before + 1) {
      throw new Error(`likes-received did not increment exactly once: before=${before} after=${after}`);
    }
    return {
      metrics: {
        beforeLikes: before,
        afterLikes: after,
        refreshMs: rounded(performance.now() - refreshStarted),
      },
    };
  });

  await ctx.check("m8", "m8-a13-same-account-message-live", {}, async () => {
    if (!ctx.alice2Page) throw new Error("Alice's second browser context is required for M8");
    await Promise.all([
      openConversationFromAnySurface(ctx, ctx.alicePage, "Bob"),
      openConversationFromAnySurface(ctx, ctx.alice2Page, "Bob"),
    ]);
    const text = `choreo-${ctx.runId}-m8-live`;
    const started = performance.now();
    await sendConversationText(ctx.alicePage, text, ctx.timeoutMs);
    await waitForLocator(
      testId(ctx.alice2Page, "sm-convo-bubble")
        .filter({ hasText: text })
        .last(),
      { state: "visible", timeout: ctx.timeoutMs },
    );
    return {
      metrics: { visibleMs: rounded(performance.now() - started) },
    };
  });

  await ctx.check("m8", "m8-a14-cross-device-read-state", {}, async () => {
    if (!ctx.alice2Page) throw new Error("Alice's second browser context is required for M8");
    await openConversationFromAnySurface(ctx, ctx.bobPage, "Alice");
    await Promise.all([
      ctx.alicePage.goto(ctx.baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: ctx.timeoutMs,
      }),
      ctx.alice2Page.goto(ctx.baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: ctx.timeoutMs,
      }),
    ]);
    const alice1Chat = await locatorWithSemanticValue(
      testId(ctx.alicePage, "sm-chats-item"),
      "dm:bob",
      ctx.timeoutMs,
      "Alice first-context Bob DM row",
    );
    const alice2Chat = await locatorWithSemanticValue(
      testId(ctx.alice2Page, "sm-chats-item"),
      "dm:bob",
      ctx.timeoutMs,
      "Alice second-context Bob DM row",
    );
    await Promise.all([
      waitForLocator(alice1Chat, { state: "visible", timeout: ctx.timeoutMs }),
      waitForLocator(alice2Chat, { state: "visible", timeout: ctx.timeoutMs }),
    ]);

    const text = `choreo-${ctx.runId}-m8-unread`;
    await sendConversationText(ctx.bobPage, text, ctx.timeoutMs);
    const alice2Unread = testId(alice2Chat, "sm-chats-unread");
    await waitForLocator(alice2Unread, { state: "visible", timeout: ctx.timeoutMs });
    const clearStarted = performance.now();
    await alice1Chat.click();
    await waitForLocator(testId(ctx.alicePage, "sm-convo-input"), {
      state: "visible",
      timeout: ctx.timeoutMs,
    });
    await waitForLocator(alice2Unread, { state: "hidden", timeout: ctx.timeoutMs });
    return {
      metrics: { clearVisibleMs: rounded(performance.now() - clearStarted) },
    };
  });

  const convergence = await ctx.check(
    "m8",
    "m8-a15-dual-offline-convergence",
    {},
    async () => {
      if (!ctx.alice2Page || !ctx.alice2Context) {
        throw new Error("Alice's second browser context is required for M8");
      }
      await Promise.all([
        openConversationFromAnySurface(ctx, ctx.alicePage, "Bob"),
        openConversationFromAnySurface(ctx, ctx.alice2Page, "Bob"),
        openConversationFromAnySurface(ctx, ctx.bobPage, "Alice"),
      ]);
      const first = `choreo-${ctx.runId}-m8-offline-alice1`;
      const second = `choreo-${ctx.runId}-m8-offline-alice2`;
      await setContextsOffline([ctx.aliceContext, ctx.alice2Context], true);
      let firstBubble;
      let secondBubble;
      try {
        [firstBubble, secondBubble] = await Promise.all([
          sendConversationText(ctx.alicePage, first, ctx.timeoutMs),
          sendConversationText(ctx.alice2Page, second, ctx.timeoutMs),
        ]);
        for (const bubble of [firstBubble, secondBubble]) {
          const receipt = testId(bubble, "sm-convo-receipt");
          await waitForLocator(receipt, { state: "visible", timeout: ctx.timeoutMs });
          const state = await semanticValue(receipt);
          if (state !== "pending") {
            throw new Error(`warm-offline message did not expose pending state: ${state}`);
          }
        }

        const firstFlushStarted = performance.now();
        await setContextsOffline([ctx.aliceContext], false);
        await waitForLocator(
          testId(ctx.bobPage, "sm-convo-bubble")
            .filter({ hasText: first })
            .last(),
          { state: "visible", timeout: ctx.timeoutMs },
        );
        const firstFlushMs = rounded(performance.now() - firstFlushStarted);

        const secondFlushStarted = performance.now();
        await setContextsOffline([ctx.alice2Context], false);
        await waitForLocator(
          testId(ctx.bobPage, "sm-convo-bubble")
            .filter({ hasText: second })
            .last(),
          { state: "visible", timeout: ctx.timeoutMs },
        );
        const secondFlushMs = rounded(performance.now() - secondFlushStarted);

        for (const page of [ctx.alicePage, ctx.alice2Page, ctx.bobPage]) {
          await waitForLocator(
            testId(page, "sm-convo-bubble")
              .filter({ hasText: first })
              .last(),
            { state: "visible", timeout: ctx.timeoutMs },
          );
          await waitForLocator(
            testId(page, "sm-convo-bubble")
              .filter({ hasText: second })
              .last(),
            { state: "visible", timeout: ctx.timeoutMs },
          );
          await expectExactlyOnceInOrder(page, first, second);
        }
        return {
          metrics: { firstFlushMs, secondFlushMs },
          data: { first, second },
        };
      } finally {
        await setContextsOffline([ctx.aliceContext, ctx.alice2Context], false);
      }
    },
  );

  await ctx.check("m8", "m8-a16-dual-offline-receipts", {}, async () => {
    if (!ctx.alice2Page || !convergence.data?.first || !convergence.data?.second) {
      throw new Error("dual-offline convergence did not yield receipted messages");
    }
    const started = performance.now();
    const firstReceipt = testId(
      testId(ctx.alicePage, "sm-convo-bubble")
        .filter({ hasText: convergence.data.first })
        .last(),
      "sm-convo-receipt",
    );
    const secondReceipt = testId(
      testId(ctx.alice2Page, "sm-convo-bubble")
        .filter({ hasText: convergence.data.second })
        .last(),
      "sm-convo-receipt",
    );
    const [firstRead, secondRead] = await Promise.all(
      [firstReceipt, secondReceipt].map((receipt) =>
        waitForValue(
          receipt,
          async (target) => {
            const value = await semanticValue(target);
            return { matched: value === "read", value };
          },
          ctx.timeoutMs,
          "normal read receipt after dual-offline flush",
        ),
      ),
    );
    return {
      metrics: {
        firstReadMs: firstRead.elapsedMs,
        secondReadMs: secondRead.elapsedMs,
        totalMs: rounded(performance.now() - started),
      },
    };
  });
}

const SEGMENT_FUNCTIONS = { m1, m2, m3, m4, m5, m6, m7, m8 };

// @ref LLP 0201#d2--quantitative-instrument — milestone green is the
// fail-closed conjunction of suite evidence and the full choreography segment.
export function aggregateChoreography(assertionReceipts) {
  const counts = {
    total: assertionReceipts.length,
    required: assertionReceipts.filter((item) => item.required).length,
    implemented: assertionReceipts.filter((item) => item.implemented).length,
    passed: assertionReceipts.filter((item) => item.status === "passed").length,
    failed: assertionReceipts.filter((item) => item.status === "failed").length,
    skipped: assertionReceipts.filter((item) => item.status === "skipped").length,
    notImplemented: assertionReceipts.filter((item) => !item.implemented).length,
    requiredUnimplemented: assertionReceipts.filter(
      (item) => item.required && !item.implemented,
    ).length,
  };
  const browserPass =
    counts.total > 0 && counts.failed === 0 && counts.requiredUnimplemented === 0;
  const reason = counts.requiredUnimplemented > 0
    ? `${counts.requiredUnimplemented} required assertion(s) remain unimplemented`
    : counts.failed > 0
      ? `${counts.failed} implemented assertion(s) failed`
      : null;
  return { counts, browserPass, reason };
}

// Closed cause of green:false. Lanes MUST copy this field from the
// segment-summary. Do not invent a second green label ("functionally green").
// Precedence: required-unimplemented, then choreography-failed, then
// suite-failed; any remaining harness-input inconsistency is instrument.
// Null when green. Optional on the receipt (default null).
export function classifyNonGreenCause({
  green,
  suitePass,
  browserPass,
  requiredUnimplemented,
}) {
  if (typeof suitePass !== "boolean") {
    throw new TypeError("suitePass must be boolean after startup validation");
  }
  if (green) return null;
  if (requiredUnimplemented > 0) return "required-unimplemented";
  if (browserPass === false) return "choreography-failed";
  if (suitePass === false) return "suite-failed";
  return "instrument";
}

async function emitSegmentSummary({
  emit,
  segment,
  assertionReceipts,
  durationMs,
  suiteStatus,
  simulatorStatuses,
  setupIdentity,
  setup,
}) {
  const { counts, browserPass, reason } = aggregateChoreography(assertionReceipts);
  const requiredExternal = [];
  const externalPass = true;
  const choreographyPass = browserPass && externalPass === true;
  if (!suiteStatus) throw new Error(`validated suite status is missing for ${segment}`);
  const suite = {
    pass: suiteStatus.pass,
    receipt: suiteStatus.receipt ?? null,
    receiptSha256: suiteStatus.receiptSha256 ?? null,
    outcomeClass: suiteStatus.outcomeClass ?? null,
  };
  const green = suite.pass === true && choreographyPass;
  const nonGreenCause = classifyNonGreenCause({
    green,
    suitePass: suite.pass,
    browserPass,
    requiredUnimplemented: counts.requiredUnimplemented,
  });
  const outcomeClass = classifyOutcome({
    green,
    suitePass: suite.pass,
    suiteOutcomeClass: suite.outcomeClass,
    assertionReceipts,
  });
  const payload = {
    type: "segment-summary",
    segment,
    assertion: "__segment__",
    implemented: counts.requiredUnimplemented === 0,
    required: true,
    status: choreographyPass ? "passed" : "failed",
    pass: choreographyPass,
    timings: [
      {
        attempt: 1,
        pass: choreographyPass,
        startedAt: null,
        durationMs: rounded(durationMs),
        settlementWaitMs: rounded(assertionReceipts.reduce(
          (sum, receipt) => sum + receipt.timings.reduce(
            (attemptSum, timing) => attemptSum + timing.settlementWaitMs,
            0,
          ),
          0,
        )),
        metrics: {},
      },
    ],
    bestOf: 1,
    details: {
      selection: "segment aggregate",
      selectedAttempt: choreographyPass ? 1 : null,
      reason,
    },
    assertions: counts,
    suite,
    choreography: {
      browserPass,
      requiredExternal,
      externalPass,
      supplementalExternal:
        Object.hasOwn(SIMULATOR_IDS, segment)
          ? [{ ...simulatorStatuses[segment], requiredForGreen: false }]
          : [],
      pass: choreographyPass,
    },
    green,
    nonGreenCause,
    outcomeClass,
    setupIdentity,
    setup,
    ...(segment === "m3"
      ? { typingObservationBoundaryVersion: TYPING_OBSERVATION_BOUNDARY_VERSION }
      : {}),
  };
  writeOutcomeLine(process.stdout, {
    outcomeClass,
    phase: "segment-summary",
    segment,
    green,
    nonGreenCause,
  });
  return emit(payload);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    writeOutcomeLine(process.stderr, {
      outcomeClass: "setup",
      phase: "startup",
      green: false,
      reason: errorText(error),
    });
    process.stderr.write(`${errorText(error)}\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  // @ref LLP 0281#w6-suite-status-linkage-ergonomics — validate the complete
  // selected linkage before credentials, Playwright, receipts, or browsers.
  let suiteStatuses;
  try {
    suiteStatuses = await loadSuiteStatuses(
      options.suiteStatusPath,
      options.segments,
    );
  } catch (error) {
    writeOutcomeLine(process.stderr, {
      outcomeClass: "setup",
      phase: "startup",
      green: false,
      reason: errorText(error),
    });
    process.stderr.write(`suite-status startup refusal: ${errorText(error)}\n`);
    process.exitCode = 2;
    return;
  }

  let setupIdentity;
  try {
    setupIdentity = await loadSetupIdentity(options.setupIdentityPath, {
      browser: options.browser,
    });
  } catch (error) {
    writeOutcomeLine(process.stderr, {
      outcomeClass: "setup",
      phase: "startup",
      green: false,
      reason: errorText(error),
    });
    process.stderr.write(`setup-identity startup refusal: ${errorText(error)}\n`);
    process.exitCode = 2;
    return;
  }

  const baseUrl = process.env.CHOREO_BASE_URL;
  const sharedPassword = process.env.CHOREO_PASSWORD;
  const alicePassword = process.env.CHOREO_ALICE_PASSWORD ?? sharedPassword;
  const bobPassword = process.env.CHOREO_BOB_PASSWORD ?? sharedPassword;
  const carolPassword = process.env.CHOREO_CAROL_PASSWORD ?? sharedPassword;
  const davePassword = process.env.CHOREO_DAVE_PASSWORD ?? sharedPassword;
  if (
    !baseUrl ||
    !alicePassword ||
    !bobPassword ||
    ((options.segments.includes("m3") || options.segments.includes("m5")) && !carolPassword)
    || (options.segments.includes("m3") && !davePassword)
  ) {
    writeOutcomeLine(process.stderr, {
      outcomeClass: "setup",
      phase: "startup",
      green: false,
      reason: "base URL or required persona password is absent",
    });
    process.stderr.write(`CHOREO_BASE_URL and persona password environment variables are required.\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  let adapter;
  let simulatorStatuses;
  try {
    adapter = await loadAdapter(options.adapterPath);
    simulatorStatuses = await loadSimulatorStatuses(options.simulatorStatusPath);
  } catch (error) {
    writeOutcomeLine(process.stderr, {
      outcomeClass: "setup",
      phase: "startup",
      green: false,
      reason: errorText(error),
    });
    process.stderr.write(`runner-input startup refusal: ${errorText(error)}\n`);
    process.exitCode = 2;
    return;
  }

  let playwright;
  try {
    playwright = await import("playwright");
    const playwrightVersion = REQUIRE("playwright/package.json").version;
    verifySetupToolchain(setupIdentity.value, {
      browser: options.browser,
      playwrightVersion,
    });
  } catch (error) {
    writeOutcomeLine(process.stderr, {
      outcomeClass: "setup",
      phase: "startup",
      green: false,
      reason: errorText(error),
    });
    process.stderr.write(`Playwright/setup startup refusal: ${errorText(error)}\n`);
    process.exitCode = 2;
    return;
  }

  const browserType = playwright[options.browser];
  let browser;
  try {
    browser = await browserType.launch({
      headless: !options.headed,
      ...(process.env.CHOREO_BROWSER_EXECUTABLE
        ? { executablePath: process.env.CHOREO_BROWSER_EXECUTABLE }
        : {}),
    });
  } catch (error) {
    writeOutcomeLine(process.stderr, {
      outcomeClass: "setup",
      phase: "startup",
      green: false,
      reason: errorText(error),
    });
    process.stderr.write(`browser startup refusal: ${errorText(error)}\n`);
    process.exitCode = 2;
    return;
  }
  const runId = randomUUID();
  const emit = await createReceiptWriter(options.receiptsPath, runId);
  const observations = new ObservationWriter({
    path: options.observationsPath,
    laneRunId: options.laneRunId,
  });
  await observations.initialize();
  const { check, bySegment, setResetAttempt } = createCheckRunner(emit, observations, {
    receiptPath: options.receiptsPath,
    observationsPath: options.observationsPath,
  });
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const carolContext = options.segments.some((segment) => ["m3", "m5"].includes(segment))
    ? await browser.newContext()
    : null;
  const daveContext = options.segments.includes("m3") ? await browser.newContext() : null;
  const alice2Context = options.segments.includes("m8") ? await browser.newContext() : null;
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  const carolPage = carolContext ? await carolContext.newPage() : null;
  const davePage = daveContext ? await daveContext.newPage() : null;
  const alice2Page = alice2Context ? await alice2Context.newPage() : null;
  const summaries = [];
  const personas = {
    alice: {
      email: process.env.CHOREO_ALICE_EMAIL ?? "alice@example.com",
      password: alicePassword,
    },
    bob: {
      email: process.env.CHOREO_BOB_EMAIL ?? "bob@example.com",
      password: bobPassword,
    },
    carol: {
      email: process.env.CHOREO_CAROL_EMAIL ?? "carol@example.com",
      password: carolPassword,
    },
    dave: {
      email: process.env.CHOREO_DAVE_EMAIL ?? "dave@example.com",
      password: davePassword,
    },
  };

  try {
    const loginTasks = [
      login(alicePage, baseUrl, personas.alice, options.timeoutMs),
      login(bobPage, baseUrl, personas.bob, options.timeoutMs),
    ];
    if (carolPage) loginTasks.push(login(carolPage, baseUrl, personas.carol, options.timeoutMs));
    if (davePage) loginTasks.push(login(davePage, baseUrl, personas.dave, options.timeoutMs));
    if (alice2Page) loginTasks.push(login(alice2Page, baseUrl, personas.alice, options.timeoutMs));
    await Promise.all(loginTasks);

    const context = {
      runId,
      baseUrl,
      adapter,
      personas,
      timeoutMs: options.timeoutMs,
      aliceContext,
      bobContext,
      carolContext,
      daveContext,
      alice2Context,
      alicePage,
      bobPage,
      carolPage,
      davePage,
      alice2Page,
      check,
    };
    setResetAttempt(async () => {
      const contexts = [
        context.aliceContext,
        context.bobContext,
        context.carolContext,
        context.daveContext,
        context.alice2Context,
      ].filter(Boolean);
      await setContextsOffline(contexts, false);
      const pages = [
        context.alicePage,
        context.bobPage,
        context.carolPage,
        context.davePage,
        context.alice2Page,
      ].filter((page) => page && !page.isClosed());
      const results = await Promise.allSettled(pages.map((page) => page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs,
      })));
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
    });

    for (const segment of options.segments) {
      const started = performance.now();
      await SEGMENT_FUNCTIONS[segment](context);
      await observations.claim(segment.toUpperCase(), "browserAssertionWait", {
        owner: "choreography",
      });
      const summary = await emitSegmentSummary({
        emit,
        segment,
        assertionReceipts: bySegment.get(segment) ?? [],
        durationMs: performance.now() - started,
        suiteStatus: suiteStatuses[segment],
        simulatorStatuses,
        setupIdentity: setupIdentity.descriptor,
        setup: setupIdentity.value,
      });
      summaries.push(summary);
      if (segment !== options.segments.at(-1)) {
        const resets = [
          context.alicePage.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs }),
          context.bobPage.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs }),
        ];
        if (carolPage) {
          resets.push(
            carolPage.goto(baseUrl, {
              waitUntil: "domcontentloaded",
              timeout: options.timeoutMs,
            }),
          );
        }
        if (davePage) {
          resets.push(
            context.davePage.goto(baseUrl, {
              waitUntil: "domcontentloaded",
              timeout: options.timeoutMs,
            }),
          );
        }
        if (alice2Page) {
          resets.push(
            alice2Page.goto(baseUrl, {
              waitUntil: "domcontentloaded",
              timeout: options.timeoutMs,
            }),
          );
        }
        await Promise.allSettled(resets);
      }
    }
  } finally {
    await Promise.allSettled(
      [aliceContext, bobContext, carolContext, daveContext, alice2Context]
        .filter(Boolean)
        .map((context) => context.close()),
    );
    await browser.close();
  }

  process.exitCode = summaries.every((summary) => summary.green) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    writeOutcomeLine(process.stderr, {
      outcomeClass: errorOutcomeClass(error, "instrument"),
      phase: "fatal",
      green: false,
      reason: errorText(error),
    });
    process.stderr.write(`choreography fatal: ${errorText(error)}\n`);
    process.exitCode = 2;
  });
}

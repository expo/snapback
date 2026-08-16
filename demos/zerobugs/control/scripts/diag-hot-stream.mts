import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWriteStream, readFileSync, type WriteStream} from 'node:fs';
import {mkdir, readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';

import {
  SnapbackClient,
  createExternalSessionClient,
} from '@expo/snapback-client';

import apiGenerated from '../snapback/generated/api.mjs';

// The frozen hot-diag baseline pins its auth-mode deployment (LLP 0058) at
// the generation active at ingest time; the checked-out codegen has since
// rotated bundle/inputs hashes with byte-identical control sources. When
// OQ4_STARTUP_ARTIFACTS names the ingest-era carrier, assert the pinned
// generation on every function reference so the client matches the store it
// measures instead of the codegen toolchain of the day.
function pinnedGenerationFromCarrier(path: string | undefined): AnyRecord | null {
  if (!path) return null;
  const carrier = JSON.parse(readFileSync(path, 'utf8')) as AnyRecord;
  const functions = carrier.functions as AnyRecord;
  const schema = carrier.schema as AnyRecord;
  return {
    schemaVersion: String(functions.schemaVersion),
    appId: String(functions.appId),
    schemaHash: String(schema.schemaHash),
    bundleHash: String(functions.bundleHash),
    inputsHash: String(functions.inputsHash),
  };
}

const pinnedGeneration = pinnedGenerationFromCarrier(process.env.OQ4_STARTUP_ARTIFACTS);
const api = (pinnedGeneration
  ? Object.fromEntries(Object.entries(apiGenerated as Record<string, unknown>).map(
    ([key, value]) => [
      key,
      value !== null
        && typeof value === 'object'
        && (value as AnyRecord).artifactKind === 'functionReference'
        && (value as AnyRecord).expectedGeneration != null
        ? {...(value as AnyRecord), expectedGeneration: pinnedGeneration}
        : value,
    ],
  ))
  : apiGenerated) as typeof apiGenerated;
import {
  GENERATION_EPOCH_MS,
  MANIFEST_ID,
  POLICY_ISSUE_ID,
  readAndVerifyOverlay,
} from './build-large-overlay.mts';
import {mintDevSession} from './load-fixture.mts';

// @ref LLP 0183#zb5--performance-scale-and-custody — this is a diagnostic
// witness for the hot-recent-v1 stream lifecycle, not a gate or receipt.

const CONTROL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OVERLAY_PATH = join(
  CONTROL_ROOT,
  '.snapback/large-fixture/large-overlay-v1.json',
);
const DEFAULT_OUT_PATH = '/tmp/diag-hot-stream.jsonl';
const DEFAULT_OBSERVE_SECONDS = 180;
const STATUS_INTERVAL_MS = 10_000;
const FIXED_ARRIVAL_INTERVAL_MS = 25;
const DEFAULT_SUSTAIN_INTERVAL_MS = 250;
const DEFAULT_SUSTAIN_SECONDS = 120;
const OBSERVER_OPEN_TIMEOUT_MS = 10_000;
const AUTHORITY_TRANSITION_INTERVAL_MS = 1_500;
const AUTHORITY_TRANSITION_START_OFFSET_MS = 3 * FIXED_ARRIVAL_INTERVAL_MS;

const ACTORS = Object.freeze([
  'ordinary-user',
  'creator',
  'assignee',
  'crew-admin',
  'removed-member',
] as const);
const OBSERVERS = Object.freeze([...ACTORS, 'anonymous'] as const);

type Actor = (typeof ACTORS)[number];
type ObserverName = string;
type ArrivalMode = 'fixed' | 'settle-gated' | 'sustained';
type ObserverPartition = 'mixed' | 'same';
type ObserverSession = 'shared' | 'distinct';
type AnyRecord = Record<string, unknown>;
type AnyClient = SnapbackClient & Record<string, unknown>;

const MUTATION_NAMES = Object.freeze([
  'issue.create',
  'issue.update',
  'issue.delete',
  'issue.addLabel',
  'issue.removeLabel',
  'notification.update',
  'emoji.addToIssue',
  'emoji.addToComment',
  'emoji.remove',
  'comment.add',
  'comment.edit',
  'comment.remove',
  'label.create',
  'label.createAndAddToIssue',
  'viewState.set',
  'userPref.set',
] as const);

type MutationName = (typeof MUTATION_NAMES)[number];

const EFFECT_TRIGGERS = new Set<MutationName>([
  'issue.create',
  'issue.update',
  'issue.addLabel',
  'issue.removeLabel',
  'emoji.addToIssue',
  'emoji.addToComment',
  'comment.add',
  'comment.edit',
]);

const API_BY_MUTATION: Readonly<Record<MutationName, unknown>> = Object.freeze({
  'issue.create': api.issueCreate,
  'issue.update': api.issueUpdate,
  'issue.delete': api.issueDelete,
  'issue.addLabel': api.issueAddLabel,
  'issue.removeLabel': api.issueRemoveLabel,
  'notification.update': api.notificationUpdate,
  'emoji.addToIssue': api.emojiAddToIssue,
  'emoji.addToComment': api.emojiAddToComment,
  'emoji.remove': api.emojiRemove,
  'comment.add': api.commentAdd,
  'comment.edit': api.commentEdit,
  'comment.remove': api.commentRemove,
  'label.create': api.labelCreate,
  'label.createAndAddToIssue': api.labelCreateAndAddToIssue,
  'viewState.set': api.viewStateSet,
  'userPref.set': api.userPrefSet,
});

interface Options {
  readyFile: string;
  overlayPath: string;
  outPath: string;
  observeSeconds: number;
  cycles: number;
  arrivalMode: ArrivalMode;
  sustainIntervalMs: number;
  sustainSeconds: number;
  observerCount: 0 | 1 | 6;
  observerPartition: ObserverPartition;
  observerSession: ObserverSession;
  coalescing: 'on' | 'off';
  cycleOffset: number;
  authorityTransitions: number;
}

// Cycle indices 0-2 (and their hotIDs, clientMutationIds, and the un-suffixed
// bind ids) are burned into the persistent hot-diag baseline by diag-run1/2;
// arms replay against clones of that baseline, so every deterministic identity
// is namespaced by the arm's cycle offset to stay fresh.
let runIdentitySuffix = '-o0';

interface HotOperation {
  inventoryIndex: number;
  name: MutationName;
  actor: Actor;
  effectClass: 'trigger' | 'non-trigger';
  arrivalOffsetMs: number;
  args: AnyRecord;
}

interface HotCycle {
  cycle: number;
  operations: HotOperation[];
}

interface BoundSession {
  client: AnyClient;
  principal: string;
}

interface SubscriptionProbe {
  calls: number;
  initialAttempts: number;
  resubscribeAttempts: number;
  resubscribeCallSucceeded: number;
  resubscribeCallFailed: number;
  resubscribeCallsPending: number;
  successfulResubscribeEvents: number;
}

interface ObserverStats {
  actor: ObserverName;
  authorityActor: ObserverName;
  connectionId: string;
  client: AnyClient;
  handle: AnyRecord | null;
  manager: AnyRecord;
  deliveries: number;
  onUpdateDeliveries: number;
  lastDeliveryAt: number | null;
  lastUpdateAt: number | null;
  connectionCallbacks: number;
  managerEvents: number;
  managerConnectingEvents: number;
  managerOpenEvents: number;
  managerLostEvents: number;
  managerBudgetMissedEvents: number;
  managerClosedEvents: number;
  lastManagerState: string | null;
  subscription: SubscriptionProbe;
  offManagerState: (() => void) | null;
  restoreSubscribe: (() => void) | null;
  frameLedger: FrameLedger;
  deliveryTimeline: DeliveryFact[];
}

interface ObserverSource {
  label: ObserverName;
  authorityActor: ObserverName;
  client: AnyClient;
}

interface FrameLedger {
  initialSnapshots: number;
  updateCallbacksByKind: Record<string, number>;
  authorizationBoundaryCallbacksByKind: Record<string, number>;
  subscriptionEventsByEvent: Record<string, number>;
  pollStarts: number;
  pollSucceeded: number;
  pollFailed: number;
}

interface DeliveryFact {
  source: 'initial' | 'update' | 'authorization-boundary' | 'poll';
  frameKind: string;
  version: number | null;
  atPerformanceMs: number;
}

interface MutationFact {
  cycle: number;
  inventoryIndex: number;
  name: MutationName;
  effectClass: 'trigger' | 'non-trigger';
  clientMutationId: string;
  dispatchedAtPerformanceMs: number;
  settledAtPerformanceMs: number | null;
  committedVersion: number | null;
  outcome: 'applied' | 'refused' | 'pending';
}

interface MutationTracker {
  total: number;
  dispatched: number;
  settled: number;
  applied: number;
  refused: number;
}

interface AuthorityTransitionTracker {
  total: number;
  dispatched: number;
  settled: number;
  applied: number;
  refused: number;
  skipped: number;
}

function roundedMilliseconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorFact(error: unknown): AnyRecord {
  const value = error && typeof error === 'object' ? error as AnyRecord : {};
  const diagnostic = value.diagnostic && typeof value.diagnostic === 'object'
    ? value.diagnostic as AnyRecord
    : null;
  return {
    name: typeof value.name === 'string' ? value.name : 'Error',
    code: typeof value.code === 'string'
      ? value.code
      : typeof diagnostic?.code === 'string' ? diagnostic.code : null,
    status: typeof value.status === 'number' ? value.status : null,
    message: String(value.message ?? error).slice(0, 1_000),
    diagnostic,
  };
}

function jsonSafe(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || typeof value === 'number'
  ) {
    return Number.isFinite(value as number) || typeof value !== 'number' ? value : String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return null;
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (value instanceof Error) return jsonSafe(errorFact(value), seen, depth + 1);
  if (depth >= 10) return '[depth-limit]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map(item => jsonSafe(item, seen, depth + 1));
    seen.delete(value);
    return result;
  }
  const result: AnyRecord = {};
  for (const [key, member] of Object.entries(value)) {
    if (/bearer|secret|credential|token|capability/i.test(key)) {
      result[key] = '[redacted]';
    } else {
      result[key] = jsonSafe(member, seen, depth + 1);
    }
  }
  seen.delete(value);
  return result;
}

class JsonlLogger {
  readonly epochPerformanceNowMs: number;
  readonly epochWallClockIso: string;
  readonly outPath: string;
  #stream: WriteStream;
  #sequence = 0;
  #closed = false;
  #writeError: Error | null = null;

  private constructor(outPath: string, stream: WriteStream) {
    this.epochPerformanceNowMs = performance.now();
    this.epochWallClockIso = new Date().toISOString();
    this.outPath = outPath;
    this.#stream = stream;
    stream.on('error', error => {
      this.#writeError = error;
    });
  }

  static async create(outPath: string): Promise<JsonlLogger> {
    await mkdir(dirname(outPath), {recursive: true});
    const stream = createWriteStream(outPath, {flags: 'w', mode: 0o600});
    await new Promise<void>((resolveOpen, rejectOpen) => {
      stream.once('open', () => resolveOpen());
      stream.once('error', rejectOpen);
    });
    return new JsonlLogger(outPath, stream);
  }

  record(kind: string, fields: AnyRecord = {}): void {
    if (this.#closed) return;
    if (this.#writeError) throw this.#writeError;
    const line = {
      ...jsonSafe(fields) as AnyRecord,
      kind,
      seq: this.#sequence,
      tMs: roundedMilliseconds(performance.now() - this.epochPerformanceNowMs),
    };
    this.#sequence += 1;
    this.#stream.write(`${JSON.stringify(line)}\n`);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await new Promise<void>((resolveEnd, rejectEnd) => {
      this.#stream.once('error', rejectEnd);
      this.#stream.end(resolveEnd);
    });
    if (this.#writeError) throw this.#writeError;
  }
}

function usage(): string {
  return [
    'Usage: bun scripts/diag-hot-stream.mts [options]',
    '',
    '  --ready-file PATH       live server readiness descriptor (or SNAPBACK_READY_FILE)',
    `  --out PATH              JSONL output (default ${DEFAULT_OUT_PATH})`,
    `  --observe-seconds N     observation window per cycle (default ${DEFAULT_OBSERVE_SECONDS})`,
    '  --cycles N              mutation cycles without reopening observers (default 1)',
    '  --arrival-mode MODE     fixed, settle-gated, or sustained (default fixed)',
    `  --sustain-interval-ms N sustained dispatch interval (default ${DEFAULT_SUSTAIN_INTERVAL_MS})`,
    `  --sustain-seconds N     sustained stream duration (default ${DEFAULT_SUSTAIN_SECONDS})`,
    '  --observer-count N      0, 1, or 6 persistent observers (default 6)',
    '  --observer-partition M  mixed or same authority partition (default mixed)',
    '  --observer-session M    shared or distinct observer sessions (default distinct)',
    '  --coalescing MODE       on or off; records the server arm (default on)',
    '  --authority-transitions N  alternating probe writes during the burst (default 0)',
  ].join('\n');
}

function optionValue(argv: string[], index: number, name: string): [string, number] {
  const argument = argv[index];
  const inline = argument.slice(name.length + 1);
  if (argument.startsWith(`${name}=`)) return [inline, index];
  const next = argv[index + 1];
  if (!next || next.startsWith('--')) throw new Error(`${name} requires a value`);
  return [next, index + 1];
}

function positiveNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Options | null {
  let readyFile = process.env.SNAPBACK_READY_FILE ?? '';
  let overlayPath = process.env.ZBUGS_LARGE_OVERLAY_PATH ?? DEFAULT_OVERLAY_PATH;
  let outPath = DEFAULT_OUT_PATH;
  let observeSeconds = DEFAULT_OBSERVE_SECONDS;
  let cycles = 1;
  let cycleOffset = 0;
  let arrivalMode: ArrivalMode = 'fixed';
  let sustainIntervalMs = DEFAULT_SUSTAIN_INTERVAL_MS;
  let sustainSeconds = DEFAULT_SUSTAIN_SECONDS;
  let observerCount: 0 | 1 | 6 = 6;
  let observerPartition: ObserverPartition = 'mixed';
  let observerSession: ObserverSession = 'distinct';
  let coalescing: 'on' | 'off' = 'on';
  let authorityTransitions = 0;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return null;
    if (argument === '--ready-file' || argument.startsWith('--ready-file=')) {
      [readyFile, index] = optionValue(argv, index, '--ready-file');
    } else if (argument === '--out' || argument.startsWith('--out=')) {
      [outPath, index] = optionValue(argv, index, '--out');
    } else if (
      argument === '--observe-seconds'
      || argument.startsWith('--observe-seconds=')
    ) {
      let value;
      [value, index] = optionValue(argv, index, '--observe-seconds');
      observeSeconds = positiveNumber(value, '--observe-seconds');
    } else if (argument === '--cycles' || argument.startsWith('--cycles=')) {
      let value;
      [value, index] = optionValue(argv, index, '--cycles');
      cycles = positiveInteger(value, '--cycles');
    } else if (
      argument === '--arrival-mode'
      || argument.startsWith('--arrival-mode=')
    ) {
      let value;
      [value, index] = optionValue(argv, index, '--arrival-mode');
      if (!['fixed', 'settle-gated', 'sustained'].includes(value)) {
        throw new Error('--arrival-mode must be fixed, settle-gated, or sustained');
      }
      arrivalMode = value as ArrivalMode;
    } else if (
      argument === '--sustain-interval-ms'
      || argument.startsWith('--sustain-interval-ms=')
    ) {
      let value;
      [value, index] = optionValue(argv, index, '--sustain-interval-ms');
      sustainIntervalMs = positiveNumber(value, '--sustain-interval-ms');
    } else if (
      argument === '--sustain-seconds'
      || argument.startsWith('--sustain-seconds=')
    ) {
      let value;
      [value, index] = optionValue(argv, index, '--sustain-seconds');
      sustainSeconds = positiveNumber(value, '--sustain-seconds');
    } else if (
      argument === '--observer-count'
      || argument.startsWith('--observer-count=')
    ) {
      let value;
      [value, index] = optionValue(argv, index, '--observer-count');
      const parsed = Number(value);
      if (parsed !== 0 && parsed !== 1 && parsed !== 6) {
        throw new Error('--observer-count must be 0, 1, or 6');
      }
      observerCount = parsed as 0 | 1 | 6;
    } else if (
      argument === '--observer-partition'
      || argument.startsWith('--observer-partition=')
    ) {
      let value;
      [value, index] = optionValue(argv, index, '--observer-partition');
      if (value !== 'mixed' && value !== 'same') {
        throw new Error('--observer-partition must be mixed or same');
      }
      observerPartition = value;
    } else if (
      argument === '--observer-session'
      || argument.startsWith('--observer-session=')
    ) {
      let value;
      [value, index] = optionValue(argv, index, '--observer-session');
      if (value !== 'shared' && value !== 'distinct') {
        throw new Error('--observer-session must be shared or distinct');
      }
      observerSession = value;
    } else if (argument === '--coalescing' || argument.startsWith('--coalescing=')) {
      let value;
      [value, index] = optionValue(argv, index, '--coalescing');
      if (value !== 'on' && value !== 'off') {
        throw new Error('--coalescing must be on or off');
      }
      coalescing = value;
    } else if (argument === '--cycle-offset' || argument.startsWith('--cycle-offset=')) {
      let value;
      [value, index] = optionValue(argv, index, '--cycle-offset');
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error('--cycle-offset must be a non-negative integer');
      }
      cycleOffset = parsed;
    } else if (
      argument === '--authority-transitions'
      || argument.startsWith('--authority-transitions=')
    ) {
      let value;
      [value, index] = optionValue(argv, index, '--authority-transitions');
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error('--authority-transitions must be a non-negative integer');
      }
      authorityTransitions = parsed;
    } else {
      throw new Error(`unknown argument ${argument}`);
    }
  }
  if (!readyFile) {
    throw new Error('--ready-file or SNAPBACK_READY_FILE is required');
  }
  if (authorityTransitions > 0) {
    const availableMs = (arrivalMode === 'sustained' ? sustainSeconds : observeSeconds) * 1_000;
    const finalTransitionOffsetMs = AUTHORITY_TRANSITION_START_OFFSET_MS
      + (authorityTransitions - 1) * AUTHORITY_TRANSITION_INTERVAL_MS;
    if (finalTransitionOffsetMs > availableMs) {
      throw new Error(
        `--authority-transitions ${authorityTransitions} exceeds the active burst window`,
      );
    }
  }
  if (observerSession === 'shared' && observerPartition !== 'same') {
    throw new Error(
      '--observer-session shared requires --observer-partition same; '
      + 'mixed observers span distinct actors and have no shared-session semantics',
    );
  }
  return {
    readyFile: resolve(readyFile),
    overlayPath: resolve(overlayPath),
    outPath: resolve(outPath),
    observeSeconds,
    cycles,
    cycleOffset,
    arrivalMode,
    sustainIntervalMs,
    sustainSeconds,
    observerCount,
    observerPartition,
    observerSession,
    coalescing,
    authorityTransitions,
  };
}

function hotID(kind: string, cycle: number, index: number, natural: string): string {
  const hex = createHash('sha256')
    .update([MANIFEST_ID, 'hot-recent-v1', kind, String(cycle), String(index), natural].join('\0'))
    .digest('hex');
  return `zbhot_${hex.slice(0, 24)}`;
}

function actorNameBySourceID(bindings: AnyRecord): Map<string, Actor> {
  return new Map(Object.entries(bindings).map(([name, binding]) => {
    const row = binding as AnyRecord;
    return [String(row.sourceUserID), name as Actor];
  }));
}

function buildHotOperationPlan(
  overlay: AnyRecord,
  cycles: number,
  cycleOffset: number,
): HotCycle[] {
  const payload = overlay.payload as AnyRecord;
  const workingSet = payload.workingSet as AnyRecord;
  const projections = payload.projections as AnyRecord;
  const rows = payload.rows as AnyRecord;
  const selectedProject = payload.selectedProject as AnyRecord;
  const actorBindings = payload.actorBindings as AnyRecord;
  const publicIssues = [...workingSet.oracleRows as AnyRecord[]]
    .filter(row => row.visibility === 'public')
    .sort((left, right) => compareText(String(left.id), String(right.id)));
  assert(publicIssues.length >= 16, 'working set has 16 public operation candidates');
  const deletedIssueID = String(publicIssues[1].id);
  const newest = Object.values(workingSet.newestComments as AnyRecord)
    .map(value => value as AnyRecord)
    .filter(comment => (
      comment.issueID !== deletedIssueID
      && publicIssues.some(issue => issue.id === comment.issueID)
    ))
    .sort((left, right) => compareText(String(left.id), String(right.id)));
  assert(newest.length >= 3, 'working set has three comment candidates');
  const edges = [...projections.issueLabelRead as AnyRecord[]]
    .filter(edge => (
      edge.issueID !== deletedIssueID
      && publicIssues.some(issue => issue.id === edge.issueID)
    ))
    .sort((left, right) => compareText(
      `${String(left.issueID)}\0${String(left.labelID)}`,
      `${String(right.issueID)}\0${String(right.labelID)}`,
    ));
  assert(edges.length >= 2, 'working set has two issue-label candidates');
  const actorsBySource = actorNameBySourceID(actorBindings);
  const commentParents = new Map(
    Object.values(workingSet.newestComments as AnyRecord).map(value => {
      const comment = value as AnyRecord;
      return [String(comment.id), String(comment.issueID)];
    }),
  );
  const publicIssueIDs = new Set(publicIssues.map(issue => String(issue.id)));
  const removableEmoji = [...rows.emoji as AnyRecord[]]
    .filter(row => {
      const subjectID = String(row.subjectID);
      const subjectIssueID = publicIssueIDs.has(subjectID)
        ? subjectID
        : commentParents.get(subjectID);
      return actorsBySource.has(String(row.creatorID))
        && !String(row.id).startsWith('zbav1_internal_')
        && subjectIssueID
        && subjectIssueID !== deletedIssueID;
    })
    .sort((left, right) => compareText(String(left.id), String(right.id)));
  assert(removableEmoji.length > 0, 'working set has an actor-owned emoji candidate');

  const removeEdge = edges[0];
  const existingLabelsForAddIssue = new Set(
    edges
      .filter(edge => edge.issueID === publicIssues[3].id)
      .map(edge => String(edge.labelID)),
  );
  const addLabelID = edges
    .map(edge => String(edge.labelID))
    .find(id => !existingLabelsForAddIssue.has(id));
  assert(addLabelID, 'working set has a project label for the add candidate');

  const plan: HotCycle[] = [];
  for (let step = 0; step < cycles; step += 1) {
    const cycle = cycleOffset + step;
    const time = (index: number): number => (
      GENERATION_EPOCH_MS + 10_000 + cycle * 1_000 + index
    );
    const effectIdentity = (index: number): AnyRecord => ({
      compositionClientID: `hot-client-${cycle}`,
      compositionMutationID: `hot-${cycle}-${String(index + 1).padStart(2, '0')}`,
    });
    const projectID = String(selectedProject.id);
    const argumentsByName: Record<MutationName, AnyRecord> = {
      'issue.create': {
        id: hotID('issue', cycle, 0, projectID),
        title: `hot-recent-v1 cycle ${cycle} issue`,
        description: 'deterministic hot-profile issue',
        created: time(0),
        modified: time(0),
        projectID,
        ...effectIdentity(0),
      },
      'issue.update': {
        id: publicIssues[0].id,
        title: `hot-recent-v1 cycle ${cycle} update`,
        modified: time(1),
        ...effectIdentity(1),
      },
      'issue.delete': {id: publicIssues[1].id},
      'issue.addLabel': {
        issueID: publicIssues[3].id,
        labelID: addLabelID,
        projectID,
        ...effectIdentity(3),
      },
      'issue.removeLabel': {
        issueID: removeEdge.issueID,
        labelID: removeEdge.labelID,
        ...effectIdentity(4),
      },
      'notification.update': {
        issueID: publicIssues[5].id,
        subscribed: 'subscribe',
        created: time(5),
      },
      'emoji.addToIssue': {
        id: hotID('emoji-issue', cycle, 6, String(publicIssues[6].id)),
        unicode: '👍',
        annotation: 'thumbs up',
        subjectID: publicIssues[6].id,
        created: time(6),
        ...effectIdentity(6),
      },
      'emoji.addToComment': {
        id: hotID('emoji-comment', cycle, 7, String(newest[0].id)),
        unicode: '👍',
        annotation: 'thumbs up',
        subjectID: newest[0].id,
        created: time(7),
        ...effectIdentity(7),
      },
      'emoji.remove': {id: removableEmoji[0].id},
      'comment.add': {
        id: hotID('comment', cycle, 9, String(publicIssues[9].id)),
        issueID: publicIssues[9].id,
        body: `hot-recent-v1 cycle ${cycle} comment`,
        created: time(9),
        ...effectIdentity(9),
      },
      'comment.edit': {
        id: newest[1].id,
        body: `hot-recent-v1 cycle ${cycle} edited comment`,
        ...effectIdentity(10),
      },
      'comment.remove': {id: newest[2].id},
      'label.create': {
        id: hotID('label', cycle, 12, projectID),
        name: `hot-label-${cycle}-a`,
        projectID,
      },
      'label.createAndAddToIssue': {
        issueID: publicIssues[13].id,
        labelID: hotID('label-edge', cycle, 13, String(publicIssues[13].id)),
        labelName: `hot-label-${cycle}-b`,
        projectID,
      },
      'viewState.set': {issueID: publicIssues[14].id, viewed: time(14)},
      'userPref.set': {key: MANIFEST_ID, value: `hot-cycle-${cycle}`},
    };
    const actorByName: Record<MutationName, Actor> = {
      'issue.create': 'ordinary-user',
      'issue.update': 'crew-admin',
      'issue.delete': 'crew-admin',
      'issue.addLabel': 'crew-admin',
      'issue.removeLabel': 'crew-admin',
      'notification.update': 'assignee',
      'emoji.addToIssue': 'ordinary-user',
      'emoji.addToComment': 'creator',
      'emoji.remove': actorsBySource.get(String(removableEmoji[0].creatorID)) ?? 'crew-admin',
      'comment.add': 'assignee',
      'comment.edit': 'crew-admin',
      'comment.remove': 'crew-admin',
      'label.create': 'crew-admin',
      'label.createAndAddToIssue': 'crew-admin',
      'viewState.set': 'removed-member',
      'userPref.set': 'ordinary-user',
    };
    plan.push({
      cycle,
      operations: MUTATION_NAMES.map((name, inventoryIndex) => ({
        inventoryIndex,
        name,
        actor: actorByName[name],
        effectClass: EFFECT_TRIGGERS.has(name) ? 'trigger' : 'non-trigger',
        arrivalOffsetMs: inventoryIndex * FIXED_ARRIVAL_INTERVAL_MS,
        args: argumentsByName[name],
      })),
    });
  }
  return plan;
}

function listContext(projectName: string): AnyRecord {
  return {
    open: null,
    projectName,
    assignee: null,
    creator: null,
    labels: null,
    textFilter: null,
    sortField: 'modified',
    sortDirection: 'desc',
  };
}

async function bindOrAdoptActors(
  readyFile: string,
  overlay: AnyRecord,
  logger: JsonlLogger,
): Promise<Map<Actor, BoundSession>> {
  const sessions = new Map<Actor, BoundSession>();
  const actorBindings = (overlay.payload as AnyRecord).actorBindings as AnyRecord;
  try {
    for (const actor of ACTORS) {
      const expected = actorBindings[actor] as AnyRecord;
      assert(expected, `overlay binds ${actor}`);
      const email = `zerobugs-diag-hot-stream-${actor}@acceptance.invalid`;
      const minted = await mintDevSession(readyFile, email);
      const client = createExternalSessionClient(minted.baseUrl, {
        bearerToken: minted.token,
        clientStoreId: `zerobugs-diag-hot-stream-${actor}`,
        rqsStore: null,
      }) as AnyClient;
      sessions.set(actor, {client, principal: minted.principal});
      let mode: 'bound' | 'adopted' = 'bound';
      let bindRefusal: AnyRecord | null = null;
      try {
        await client.mutate(api.acceptanceBindActor, {
          args: {actor},
          clientMutationId: `diag-hot-stream-bind-${actor}${runIdentitySuffix}`,
          queue: false,
        });
      } catch (error) {
        mode = 'adopted';
        bindRefusal = errorFact(error);
      }
      let self;
      try {
        self = await client.query(api.acceptanceActorBindingSelf, {args: {}});
      } catch (error) {
        logger.record('actor_binding_failed', {
          actor,
          mode,
          bindRefusal,
          selfError: errorFact(error),
        });
        throw error;
      }
      const row = self.rows[0] as AnyRecord | undefined;
      const correct = self.rows.length === 1
        && row?.principal === minted.principal
        && row?.sourceUserID === expected.sourceUserID
        && row?.role === expected.role;
      logger.record('actor_binding', {
        actor,
        mode,
        correct,
        principal: minted.principal,
        expected: {
          sourceUserID: expected.sourceUserID,
          role: expected.role,
        },
        observed: row ?? null,
        bindRefusal,
      });
      if (!correct) {
        throw new Error(
          `actor ${actor} bind/adopt did not resolve the overlay's source user and role`,
        );
      }
    }
    return sessions;
  } catch (error) {
    await Promise.allSettled(
      [...sessions.values()].map(session => session.client.closeAuth()),
    );
    throw error;
  }
}

async function mintAuthorityProbeSession(
  readyFile: string,
  logger: JsonlLogger,
): Promise<BoundSession> {
  const email = 'zerobugs-diag-hot-stream-authority-probe@acceptance.invalid';
  const minted = await mintDevSession(readyFile, email);
  const client = createExternalSessionClient(minted.baseUrl, {
    bearerToken: minted.token,
    clientStoreId: 'zerobugs-diag-hot-stream-authority-probe',
    rqsStore: null,
  }) as AnyClient;
  logger.record('authority_probe_session', {
    principal: minted.principal,
    initialState: 'revoked-by-pristine-authority-fixture',
  });
  return {client, principal: minted.principal};
}

function anonymousClient(baseUrl: string): AnyClient {
  return new SnapbackClient(baseUrl, {
    custody: 'anonymous-public',
    clientStoreId: 'zerobugs-diag-hot-stream-anonymous',
    adminToken: null,
    rqsStore: null,
    authInvalidationProtocol: 1,
  }) as AnyClient;
}

async function buildObserverSources(
  options: Options,
  sessions: Map<Actor, BoundSession>,
  anonymous: AnyClient,
  overlay: AnyRecord,
  logger: JsonlLogger,
): Promise<ObserverSource[]> {
  if (options.observerCount === 0) return [];
  if (options.observerPartition === 'mixed') {
    const names = options.observerCount === 1 ? ['crew-admin'] : [...OBSERVERS];
    return names.map(label => {
      const client = label === 'anonymous' ? anonymous : sessions.get(label as Actor)?.client;
      assert(client, `observer ${label} has a client`);
      return {label, authorityActor: label, client};
    });
  }

  const sources: ObserverSource[] = [];
  const expected = (
    ((overlay.payload as AnyRecord).actorBindings as AnyRecord)['crew-admin']
  ) as AnyRecord;
  // Reuse the canonical crew-admin mint email: dev-session principals are
  // deterministic per email, and the crew-admin source user is already bound
  // to that principal in the baseline. Distinct mode retains the original
  // one-mint-per-observer behavior; shared mode models one user's session
  // across multiple tabs. A fresh email would mint a fresh principal and
  // acceptanceBindActor refuses a second binding for the same source user.
  const email = 'zerobugs-diag-hot-stream-crew-admin@acceptance.invalid';
  const sharedMinted = options.observerSession === 'shared'
    ? await mintDevSession(options.readyFile, email)
    : null;
  try {
    for (let index = 0; index < options.observerCount; index += 1) {
      const label = `same-crew-admin-${index + 1}`;
      const minted = sharedMinted ?? await mintDevSession(options.readyFile, email);
      const client = createExternalSessionClient(minted.baseUrl, {
        bearerToken: minted.token,
        clientStoreId: `zerobugs-diag-hot-stream-${label}`,
        rqsStore: null,
      }) as AnyClient;
      // Register immediately so a later bind/self-check failure still closes
      // every observer client in this partial construction.
      sources.push({label, authorityActor: 'crew-admin', client});
      let mode: 'bound' | 'adopted' = 'bound';
      let bindRefusal: AnyRecord | null = null;
      try {
        await client.mutate(api.acceptanceBindActor, {
          args: {actor: 'crew-admin'},
          clientMutationId: `diag-hot-stream-bind-${label}${runIdentitySuffix}`,
          queue: false,
        });
      } catch (error) {
        mode = 'adopted';
        bindRefusal = errorFact(error);
      }
      const self = await client.query(api.acceptanceActorBindingSelf, {args: {}});
      const row = self.rows[0] as AnyRecord | undefined;
      const correct = self.rows.length === 1
        && row?.principal === minted.principal
        && row?.sourceUserID === expected.sourceUserID
        && row?.role === expected.role;
      logger.record('observer_authority_binding', {
        observer: label,
        authorityActor: 'crew-admin',
        observerSession: options.observerSession,
        mode,
        correct,
        principal: minted.principal,
        bindRefusal,
      });
      assert(correct, `${label} adopted the shared crew-admin principal`);
    }
    return sources;
  } catch (error) {
    await Promise.allSettled(sources.map(source => source.client.closeAuth()));
    throw error;
  }
}

async function selectedProjectName(
  client: AnyClient,
  selectedProjectID: string,
  logger: JsonlLogger,
): Promise<string> {
  const response = await client.query(api.allProjects, {
    args: {limit: 1_023, start: null},
  });
  assert.equal(response.rows.length, 1, 'allProjects returns one typed envelope');
  const envelope = response.rows[0] as AnyRecord;
  const items = envelope.items as AnyRecord[];
  assert(Array.isArray(items), 'allProjects envelope carries items');
  const project = items.find(item => item.id === selectedProjectID);
  assert(project, `selected project ${selectedProjectID} is present in allProjects`);
  assert.equal(typeof project.lowerCaseName, 'string');
  logger.record('selected_project', {
    id: selectedProjectID,
    name: project.name ?? null,
    lowerCaseName: project.lowerCaseName,
    catalogRows: items.length,
    catalogStatus: envelope.status ?? null,
  });
  return project.lowerCaseName as string;
}

function rowFacts(rows: unknown): AnyRecord {
  if (!Array.isArray(rows)) return {envelopeRows: null, rows: null, total: null};
  const envelope = rows.length === 1 && rows[0] && typeof rows[0] === 'object'
    ? rows[0] as AnyRecord
    : null;
  const items = envelope && Array.isArray(envelope.items) ? envelope.items : null;
  return {
    envelopeRows: rows.length,
    rows: items ? items.length : rows.length,
    total: typeof envelope?.total === 'number' ? envelope.total : null,
    examined: typeof envelope?.examined === 'number' ? envelope.examined : null,
    status: typeof envelope?.status === 'string' ? envelope.status : null,
    hasMore: typeof envelope?.hasMore === 'boolean' ? envelope.hasMore : null,
    protectedVisible: items
      ? items.some(item => (
        item && typeof item === 'object'
        && (item as AnyRecord).issue
        && typeof (item as AnyRecord).issue === 'object'
        && ((item as AnyRecord).issue as AnyRecord).id === POLICY_ISSUE_ID
      ))
      : null,
  };
}

function managerFacts(manager: AnyRecord): AnyRecord {
  const inspection = typeof manager.inspection === 'function'
    ? (manager.inspection as () => AnyRecord)()
    : null;
  const isOpen = typeof manager.isOpen === 'function'
    ? (manager.isOpen as () => boolean)()
    : null;
  const isReady = typeof manager.isReady === 'function'
    ? (manager.isReady as () => boolean)()
    : null;
  return {
    inspection,
    isOpen,
    isReady,
    consecutiveConnectFailures: typeof manager.attempts === 'number' ? manager.attempts : null,
    connectPending: typeof manager.connectPending === 'boolean' ? manager.connectPending : null,
    socketGeneration: typeof manager.socketGeneration === 'number'
      ? manager.socketGeneration
      : null,
    readyGeneration: typeof manager.readyGeneration === 'number'
      ? manager.readyGeneration
      : null,
    grantSuspect: typeof manager.grantSuspect === 'boolean' ? manager.grantSuspect : null,
  };
}

function instrumentSubscribeLive(stats: ObserverStats, logger: JsonlLogger): () => void {
  const client = stats.client;
  const original = client.subscribeLive;
  assert.equal(typeof original, 'function', `${stats.actor} exposes subscribeLive`);
  const hadOwn = Object.prototype.hasOwnProperty.call(client, 'subscribeLive');
  client.subscribeLive = async function instrumentedSubscribeLive(...args: unknown[]) {
    const options = args[1] && typeof args[1] === 'object' ? args[1] as AnyRecord : {};
    const supersedes = typeof options.supersedes === 'string' ? options.supersedes : null;
    const isResubscribe = supersedes !== null;
    stats.subscription.calls += 1;
    if (isResubscribe) {
      stats.subscription.resubscribeAttempts += 1;
      stats.subscription.resubscribeCallsPending += 1;
    } else {
      stats.subscription.initialAttempts += 1;
    }
    const call = stats.subscription.calls;
    const startedAt = performance.now();
    logger.record('subscribe_attempt', {
      actor: stats.actor,
      connectionId: stats.connectionId,
      call,
      classification: isResubscribe ? 'resubscribe' : 'initial',
      supersedes,
      resubscribeAttempted: stats.subscription.resubscribeAttempts > 0,
    });
    try {
      const result = await Reflect.apply(original as (...members: unknown[]) => Promise<unknown>, this, args);
      if (isResubscribe) {
        stats.subscription.resubscribeCallSucceeded += 1;
        stats.subscription.resubscribeCallsPending -= 1;
      }
      const response = result && typeof result === 'object' ? result as AnyRecord : {};
      logger.record('subscribe_result', {
        actor: stats.actor,
        connectionId: stats.connectionId,
        call,
        classification: isResubscribe ? 'resubscribe' : 'initial',
        outcome: 'succeeded',
        latencyMs: roundedMilliseconds(performance.now() - startedAt),
        subscriptionId: response.subscription_id ?? null,
        snapshotVersion: (response.snapshot as AnyRecord | undefined)?.version ?? null,
      });
      return result;
    } catch (error) {
      if (isResubscribe) {
        stats.subscription.resubscribeCallFailed += 1;
        stats.subscription.resubscribeCallsPending -= 1;
      }
      logger.record('subscribe_result', {
        actor: stats.actor,
        connectionId: stats.connectionId,
        call,
        classification: isResubscribe ? 'resubscribe' : 'initial',
        outcome: 'failed',
        latencyMs: roundedMilliseconds(performance.now() - startedAt),
        error: errorFact(error),
      });
      throw error;
    }
  } as typeof client.subscribeLive;
  return () => {
    if (hadOwn) client.subscribeLive = original;
    else delete client.subscribeLive;
  };
}

function handleFacts(stats: ObserverStats): AnyRecord {
  const handle = stats.handle;
  if (!handle) return {available: false};
  let authorizationState: unknown = null;
  if (typeof handle.authorizationState === 'function') {
    try {
      authorizationState = (handle.authorizationState as () => unknown)();
    } catch (error) {
      authorizationState = {inspectionError: errorFact(error)};
    }
  }
  return {
    available: true,
    subscriptionId: handle.subscriptionId ?? null,
    version: handle.version ?? null,
    connection: handle.connection ?? null,
    paused: handle.paused ?? null,
    freshness: handle.freshness ?? null,
    retention: handle.retention ?? null,
    pendingIntentsAtSeed: handle.pendingIntentsAtSeed ?? null,
    authorizationDisposition: handle.authorizationDisposition ?? null,
    authorizationDenial: handle.authorizationDenial ?? null,
    authorizationState,
    ...rowFacts(handle.rows),
  };
}

function incrementLedger(ledger: Record<string, number>, key: unknown): string {
  const normalized = typeof key === 'string' && key.length > 0 ? key : 'unknown';
  ledger[normalized] = (ledger[normalized] ?? 0) + 1;
  return normalized;
}

async function openObservers(
  sources: ObserverSource[],
  projectName: string,
  logger: JsonlLogger,
): Promise<Map<ObserverName, ObserverStats>> {
  const observers = new Map<ObserverName, ObserverStats>();
  try {
    for (const source of sources) {
      const actor = source.label;
      const client = source.client;
      const connectionId = `zb5-hot-0-${actor}`;
      const manager = (client.liveStreamManager as (
        connection: string,
        options?: AnyRecord,
      ) => AnyRecord)(connectionId);
      const stats: ObserverStats = {
        actor,
        authorityActor: source.authorityActor,
        connectionId,
        client,
        handle: null,
        manager,
        deliveries: 0,
        onUpdateDeliveries: 0,
        lastDeliveryAt: null,
        lastUpdateAt: null,
        connectionCallbacks: 0,
        managerEvents: 0,
        managerConnectingEvents: 0,
        managerOpenEvents: 0,
        managerLostEvents: 0,
        managerBudgetMissedEvents: 0,
        managerClosedEvents: 0,
        lastManagerState: null,
        subscription: {
          calls: 0,
          initialAttempts: 0,
          resubscribeAttempts: 0,
          resubscribeCallSucceeded: 0,
          resubscribeCallFailed: 0,
          resubscribeCallsPending: 0,
          successfulResubscribeEvents: 0,
        },
        offManagerState: null,
        restoreSubscribe: null,
        frameLedger: {
          initialSnapshots: 0,
          updateCallbacksByKind: {},
          authorizationBoundaryCallbacksByKind: {},
          subscriptionEventsByEvent: {},
          pollStarts: 0,
          pollSucceeded: 0,
          pollFailed: 0,
        },
        deliveryTimeline: [],
      };
      observers.set(actor, stats);
      stats.restoreSubscribe = instrumentSubscribeLive(stats, logger);
      stats.offManagerState = (manager.onState as (
        listener: (state: string, detail?: AnyRecord) => void,
      ) => () => void)((state, detail = {}) => {
        stats.managerEvents += 1;
        stats.lastManagerState = state;
        if (state === 'connecting') stats.managerConnectingEvents += 1;
        if (state === 'open') stats.managerOpenEvents += 1;
        if (state === 'lost') stats.managerLostEvents += 1;
        if (state === 'budget-missed') stats.managerBudgetMissedEvents += 1;
        if (state === 'closed') stats.managerClosedEvents += 1;
        logger.record('manager_event', {
          actor,
          connectionId,
          state,
          detail,
          socketConnectAttempts: stats.managerConnectingEvents,
          socketReconnectAttempts: Math.max(0, stats.managerConnectingEvents - 1),
          manager: managerFacts(manager),
        });
      });

      let resolveLive!: () => void;
      let rejectLive!: (error: Error) => void;
      const liveReady = new Promise<void>((resolvePromise, rejectPromise) => {
        resolveLive = resolvePromise;
        rejectLive = rejectPromise;
      });
      const liveDeadline = setTimeout(() => {
        rejectLive(new Error(`${actor} live observer did not establish within 10 seconds`));
      }, OBSERVER_OPEN_TIMEOUT_MS);
      let handle: AnyRecord | null = null;
      let abandoned = false;
      const liveOptions: AnyRecord = {
        connectionId,
        args: {
          listContext: listContext(projectName),
          limit: 1_000,
          start: null,
          dir: 'forward',
          inclusive: false,
        },
        transport: 'stream',
        fallbackToPoll: false,
        onConnectionChange: (connection: string, detail: AnyRecord = {}) => {
          stats.connectionCallbacks += 1;
          logger.record('connection_change', {
            actor,
            connectionId,
            connection,
            callback: stats.connectionCallbacks,
            previous: detail.previous ?? null,
            changed: detail.previous === undefined || detail.previous !== connection,
            error: detail.error ? errorFact(detail.error) : null,
            handleVersion: handle?.version ?? null,
          });
          if (connection === 'live') resolveLive();
        },
        onUpdate: (rows: unknown[], meta: AnyRecord = {}) => {
          stats.onUpdateDeliveries += 1;
          stats.deliveries += 1;
          const deliveredAt = performance.now();
          stats.lastUpdateAt = deliveredAt;
          stats.lastDeliveryAt = deliveredAt;
          const updateKind = incrementLedger(stats.frameLedger.updateCallbacksByKind, meta.kind);
          const version = typeof meta.version === 'number'
            ? meta.version
            : typeof handle?.version === 'number' ? handle.version as number : null;
          stats.deliveryTimeline.push({
            source: 'update',
            frameKind: updateKind,
            version,
            atPerformanceMs: deliveredAt,
          });
          logger.record('update', {
            actor,
            connectionId,
            delivery: stats.deliveries,
            onUpdateDelivery: stats.onUpdateDeliveries,
            version,
            updateKind,
            ...rowFacts(rows),
          });
        },
        onSubscriptionEvent: (event: AnyRecord) => {
          if (event?.event === 'resubscribed') {
            stats.subscription.successfulResubscribeEvents += 1;
          }
          incrementLedger(stats.frameLedger.subscriptionEventsByEvent, event?.event);
          logger.record('subscription_event', {
            actor,
            connectionId,
            event,
            successfulResubscribeEvents: stats.subscription.successfulResubscribeEvents,
          });
        },
        onAuthorizationBoundary: (rows: unknown[], detail: AnyRecord = {}) => {
          const frameKind = incrementLedger(
            stats.frameLedger.authorizationBoundaryCallbacksByKind,
            detail.kind ?? detail.frameKind,
          );
          const version = typeof detail.version === 'number'
            ? detail.version
            : typeof handle?.version === 'number' ? handle.version as number : null;
          stats.deliveryTimeline.push({
            source: 'authorization-boundary',
            frameKind,
            version,
            atPerformanceMs: performance.now(),
          });
          logger.record('authorization_boundary', {
            actor,
            connectionId,
            detail,
            ...rowFacts(rows),
          });
        },
        onAuthorizationError: (error: unknown) => {
          logger.record('authorization_error', {
            actor,
            connectionId,
            error: errorFact(error),
          });
        },
      };
      const handlePromise = (client.liveQuery as (
        reference: unknown,
        options: AnyRecord,
      ) => Promise<AnyRecord>)(api.issueListV2, liveOptions).then(result => {
        handle = result;
        stats.handle = result;
        if (abandoned && typeof result.dispose === 'function') {
          void Promise.resolve((result.dispose as () => unknown)()).catch(() => {});
        }
        if (result.connection === 'live') resolveLive();
        return result;
      });
      try {
        const [opened] = await Promise.all([handlePromise, liveReady]);
        handle = opened;
        stats.handle = opened;
        stats.deliveries += 1;
        stats.frameLedger.initialSnapshots += 1;
        const openedAt = performance.now();
        stats.lastDeliveryAt = openedAt;
        stats.deliveryTimeline.push({
          source: 'initial',
          frameKind: 'snapshot',
          version: typeof opened.version === 'number' ? opened.version : null,
          atPerformanceMs: openedAt,
        });
        const expectedRows = source.authorityActor === 'crew-admin'
          || source.authorityActor === 'removed-member' ? 1_000 : 900;
        const facts = rowFacts(opened.rows);
        logger.record('observer_opened', {
          actor,
          authorityActor: source.authorityActor,
          connectionId,
          expectedRows,
          matchesExpectedRows: facts.rows === expectedRows,
          version: opened.version ?? null,
          connection: opened.connection ?? null,
          subscriptionId: opened.subscriptionId ?? null,
          manager: managerFacts(manager),
          ...facts,
        });
      } catch (error) {
        abandoned = true;
        throw error;
      } finally {
        clearTimeout(liveDeadline);
      }
    }
    return observers;
  } catch (error) {
    await closeObservers(observers, logger);
    throw error;
  }
}

function emitObserverStatus(
  cycle: number | null,
  phase: string,
  stats: ObserverStats,
  logger: JsonlLogger,
): void {
  const now = performance.now();
  const inspection = stats.client.localResourceInspection([stats.connectionId]);
  logger.record('observer_status', {
    cycle,
    phase,
    actor: stats.actor,
    authorityActor: stats.authorityActor,
    connectionId: stats.connectionId,
    deliveries: stats.deliveries,
    onUpdateDeliveries: stats.onUpdateDeliveries,
    lastDeliveryAgeMs: stats.lastDeliveryAt === null
      ? null
      : roundedMilliseconds(now - stats.lastDeliveryAt),
    lastOnUpdateAgeMs: stats.lastUpdateAt === null
      ? null
      : roundedMilliseconds(now - stats.lastUpdateAt),
    connectionCallbacks: stats.connectionCallbacks,
    managerEvents: stats.managerEvents,
    lastManagerState: stats.lastManagerState,
    socketConnectAttempts: stats.managerConnectingEvents,
    socketReconnectAttempts: Math.max(0, stats.managerConnectingEvents - 1),
    socketOpenEvents: stats.managerOpenEvents,
    socketLossEvents: stats.managerLostEvents,
    socketBudgetMissedEvents: stats.managerBudgetMissedEvents,
    socketClosedEvents: stats.managerClosedEvents,
    resubscribeAttempted: stats.subscription.resubscribeAttempts > 0,
    resubscribe: stats.subscription,
    handle: handleFacts(stats),
    manager: managerFacts(stats.manager),
    localResourceInspection: inspection,
    frameLedger: stats.frameLedger,
  });
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise(resolveDelay => {
    let settled = false;
    const finish = (completed: boolean): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolveDelay(completed);
    };
    const timer = setTimeout(() => finish(true), milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      finish(false);
    };
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

async function observeCycle(
  cycle: number,
  observeSeconds: number,
  observers: Map<ObserverName, ObserverStats>,
  logger: JsonlLogger,
  signal: AbortSignal,
): Promise<void> {
  const startedAt = performance.now();
  const deadline = startedAt + observeSeconds * 1_000;
  let tick = 1;
  let lastStatusAt = startedAt;
  while (!signal.aborted) {
    const target = startedAt + tick * STATUS_INTERVAL_MS;
    if (target > deadline) break;
    if (!await delay(Math.max(0, target - performance.now()), signal)) break;
    for (const stats of observers.values()) {
      emitObserverStatus(cycle, `tick-${tick}`, stats, logger);
    }
    lastStatusAt = performance.now();
    tick += 1;
  }
  if (!signal.aborted && performance.now() < deadline) {
    await delay(Math.max(0, deadline - performance.now()), signal);
  }
  if (!signal.aborted && deadline - lastStatusAt > 250) {
    for (const stats of observers.values()) {
      emitObserverStatus(cycle, 'window-end', stats, logger);
    }
  }
}

function scheduleMutation(
  cycle: number,
  operation: HotOperation,
  sessions: Map<Actor, BoundSession>,
  cycleStart: number,
  logger: JsonlLogger,
  tracker: MutationTracker,
  mutationFacts: MutationFact[],
  signal: AbortSignal,
): {dispatched: Promise<void>; settled: Promise<void>} {
  const targetTime = cycleStart + operation.arrivalOffsetMs;
  const session = sessions.get(operation.actor);
  assert(session, `${operation.name} actor ${operation.actor} is bound`);
  let resolveDispatched!: () => void;
  const dispatched = new Promise<void>(resolvePromise => {
    resolveDispatched = resolvePromise;
  });
  const settled = new Promise<void>(resolveSettled => {
    const timer = setTimeout(async () => {
      if (signal.aborted) {
        logger.record('mutation_skipped', {
          cycle,
          name: operation.name,
          actor: operation.actor,
          reason: 'harness-aborted-before-dispatch',
        });
        resolveDispatched();
        resolveSettled();
        return;
      }
      const dispatchedAt = performance.now();
      const clientMutationId = `zb5-hot-${cycle}-${String(operation.inventoryIndex + 1).padStart(2, '0')}`;
      const mutationFact: MutationFact = {
        cycle,
        inventoryIndex: operation.inventoryIndex,
        name: operation.name,
        effectClass: operation.effectClass,
        clientMutationId,
        dispatchedAtPerformanceMs: dispatchedAt,
        settledAtPerformanceMs: null,
        committedVersion: null,
        outcome: 'pending',
      };
      mutationFacts.push(mutationFact);
      tracker.dispatched += 1;
      logger.record('mutation_dispatch', {
        cycle,
        inventoryIndex: operation.inventoryIndex,
        name: operation.name,
        actor: operation.actor,
        effectClass: operation.effectClass,
        targetOffsetMs: operation.arrivalOffsetMs,
        dispatchDriftMs: roundedMilliseconds(dispatchedAt - targetTime),
        clientMutationId,
        args: operation.args,
      });
      resolveDispatched();
      try {
        const response = await session.client.mutate(
          API_BY_MUTATION[operation.name] as never,
          {
            args: operation.args,
            clientMutationId,
            queue: false,
          },
        );
        tracker.settled += 1;
        tracker.applied += 1;
        const responseRecord = response as unknown as AnyRecord;
        const resultRecord = responseRecord.result && typeof responseRecord.result === 'object'
          ? responseRecord.result as AnyRecord
          : null;
        const committedVersion = typeof responseRecord.version === 'number'
          ? responseRecord.version
          : typeof resultRecord?.version === 'number' ? resultRecord.version : null;
        const settledAt = performance.now();
        mutationFact.settledAtPerformanceMs = settledAt;
        mutationFact.committedVersion = committedVersion;
        mutationFact.outcome = 'applied';
        logger.record('mutation_result', {
          cycle,
          inventoryIndex: operation.inventoryIndex,
          name: operation.name,
          actor: operation.actor,
          effectClass: operation.effectClass,
          outcome: 'applied',
          clientMutationId,
          committedVersion,
          expectedRefusal: operation.name === 'issue.create',
          expectationMet: operation.name !== 'issue.create',
          latencyMs: roundedMilliseconds(settledAt - dispatchedAt),
          result: response.result,
        });
      } catch (error) {
        tracker.settled += 1;
        tracker.refused += 1;
        const settledAt = performance.now();
        mutationFact.settledAtPerformanceMs = settledAt;
        mutationFact.outcome = 'refused';
        logger.record('mutation_result', {
          cycle,
          inventoryIndex: operation.inventoryIndex,
          name: operation.name,
          actor: operation.actor,
          effectClass: operation.effectClass,
          outcome: 'refused',
          clientMutationId,
          committedVersion: null,
          expectedRefusal: operation.name === 'issue.create',
          expectationMet: operation.name === 'issue.create',
          latencyMs: roundedMilliseconds(settledAt - dispatchedAt),
          error: errorFact(error),
        });
      } finally {
        resolveSettled();
      }
    }, Math.max(0, targetTime - performance.now()));
    timer.ref?.();
  });
  return {dispatched, settled};
}

function scheduleAuthorityTransition(
  index: number,
  session: BoundSession,
  burstStart: number,
  logger: JsonlLogger,
  tracker: AuthorityTransitionTracker,
  signal: AbortSignal,
): Promise<void> {
  const action = index % 2 === 0 ? 'grant' : 'revoke';
  const functionName = action === 'grant' ? 'authorityProbeGrant' : 'authorityProbeRevoke';
  const functionReference = action === 'grant'
    ? api.authorityProbeGrant
    : api.authorityProbeRevoke;
  const targetOffsetMs = AUTHORITY_TRANSITION_START_OFFSET_MS
    + index * AUTHORITY_TRANSITION_INTERVAL_MS;
  const targetTime = burstStart + targetOffsetMs;
  return new Promise<void>(resolveSettled => {
    const timer = setTimeout(async () => {
      if (signal.aborted) {
        tracker.skipped += 1;
        logger.record('authority_transition', {
          index,
          action,
          functionName,
          principal: session.principal,
          targetOffsetMs,
          dispatchedAtPerformanceMs: null,
          settledAtPerformanceMs: null,
          dispatchedTMs: null,
          settledTMs: null,
          outcome: 'skipped',
          committedVersion: null,
          reason: 'harness-aborted-before-dispatch',
        });
        resolveSettled();
        return;
      }
      const dispatchedAt = performance.now();
      const clientMutationId = `zb5-authority-probe-${index + 1}${runIdentitySuffix}`;
      tracker.dispatched += 1;
      try {
        const response = await session.client.mutate(functionReference as never, {
          args: {},
          clientMutationId,
          queue: false,
        });
        const responseRecord = response as unknown as AnyRecord;
        const resultRecord = responseRecord.result && typeof responseRecord.result === 'object'
          ? responseRecord.result as AnyRecord
          : null;
        const committedVersion = typeof responseRecord.version === 'number'
          ? responseRecord.version
          : typeof resultRecord?.version === 'number' ? resultRecord.version : null;
        const settledAt = performance.now();
        tracker.settled += 1;
        tracker.applied += 1;
        logger.record('authority_transition', {
          index,
          action,
          functionName,
          principal: session.principal,
          targetOffsetMs,
          dispatchDriftMs: roundedMilliseconds(dispatchedAt - targetTime),
          dispatchedAtPerformanceMs: roundedMilliseconds(dispatchedAt),
          settledAtPerformanceMs: roundedMilliseconds(settledAt),
          dispatchedTMs: roundedMilliseconds(dispatchedAt - logger.epochPerformanceNowMs),
          settledTMs: roundedMilliseconds(settledAt - logger.epochPerformanceNowMs),
          latencyMs: roundedMilliseconds(settledAt - dispatchedAt),
          outcome: 'applied',
          committedVersion,
          clientMutationId,
        });
      } catch (error) {
        const settledAt = performance.now();
        tracker.settled += 1;
        tracker.refused += 1;
        logger.record('authority_transition', {
          index,
          action,
          functionName,
          principal: session.principal,
          targetOffsetMs,
          dispatchDriftMs: roundedMilliseconds(dispatchedAt - targetTime),
          dispatchedAtPerformanceMs: roundedMilliseconds(dispatchedAt),
          settledAtPerformanceMs: roundedMilliseconds(settledAt),
          dispatchedTMs: roundedMilliseconds(dispatchedAt - logger.epochPerformanceNowMs),
          settledTMs: roundedMilliseconds(settledAt - logger.epochPerformanceNowMs),
          latencyMs: roundedMilliseconds(settledAt - dispatchedAt),
          outcome: 'refused',
          committedVersion: null,
          clientMutationId,
          error: errorFact(error),
        });
      } finally {
        resolveSettled();
      }
    }, Math.max(0, targetTime - performance.now()));
    timer.ref?.();
  });
}

function scheduleAuthorityTransitions(
  count: number,
  session: BoundSession,
  burstStart: number,
  logger: JsonlLogger,
  tracker: AuthorityTransitionTracker,
  signal: AbortSignal,
): Promise<void>[] {
  const settlements: Promise<void>[] = [];
  let preceding = Promise.resolve();
  for (let index = 0; index < count; index += 1) {
    const settlement = preceding.then(() => scheduleAuthorityTransition(
      index,
      session,
      burstStart,
      logger,
      tracker,
      signal,
    ));
    settlements.push(settlement);
    preceding = settlement;
  }
  return settlements;
}

async function finalPolls(
  observers: Map<ObserverName, ObserverStats>,
  logger: JsonlLogger,
): Promise<number> {
  let failures = 0;
  for (const stats of observers.values()) {
    stats.frameLedger.pollStarts += 1;
    const handle = stats.handle;
    if (!handle || typeof handle.poll !== 'function') {
      failures += 1;
      logger.record('poll_result', {
        actor: stats.actor,
        connectionId: stats.connectionId,
        outcome: 'unavailable',
      });
      continue;
    }
    logger.record('poll_start', {
      actor: stats.actor,
      connectionId: stats.connectionId,
      connection: handle.connection ?? null,
      version: handle.version ?? null,
    });
    const startedAt = performance.now();
    try {
      const rows = await (handle.poll as () => Promise<unknown>)();
      stats.frameLedger.pollSucceeded += 1;
      stats.deliveryTimeline.push({
        source: 'poll',
        frameKind: 'poll',
        version: typeof handle.version === 'number' ? handle.version : null,
        atPerformanceMs: performance.now(),
      });
      logger.record('poll_result', {
        actor: stats.actor,
        connectionId: stats.connectionId,
        outcome: 'succeeded',
        latencyMs: roundedMilliseconds(performance.now() - startedAt),
        connection: handle.connection ?? null,
        version: handle.version ?? null,
        resubscribeAttempted: stats.subscription.resubscribeAttempts > 0,
        ...rowFacts(rows),
      });
    } catch (error) {
      failures += 1;
      stats.frameLedger.pollFailed += 1;
      logger.record('poll_result', {
        actor: stats.actor,
        connectionId: stats.connectionId,
        outcome: 'failed',
        latencyMs: roundedMilliseconds(performance.now() - startedAt),
        connection: handle.connection ?? null,
        version: handle.version ?? null,
        error: errorFact(error),
      });
    }
  }
  return failures;
}

function recordConvergence(
  mutationFacts: MutationFact[],
  observers: Map<ObserverName, ObserverStats>,
  logger: JsonlLogger,
): AnyRecord {
  let measuredMutations = 0;
  let fullyConvergedMutations = 0;
  const latencies: number[] = [];
  for (const mutation of mutationFacts) {
    if (mutation.outcome !== 'applied' || mutation.committedVersion === null) continue;
    measuredMutations += 1;
    const byObserver: AnyRecord = {};
    let firstAt: number | null = null;
    let lastAt: number | null = null;
    for (const [observer, stats] of observers) {
      const delivery = stats.deliveryTimeline.find(candidate => (
        candidate.atPerformanceMs >= mutation.dispatchedAtPerformanceMs
        && candidate.version !== null
        && candidate.version >= mutation.committedVersion!
      ));
      const latencyMs = delivery
        ? roundedMilliseconds(delivery.atPerformanceMs - mutation.dispatchedAtPerformanceMs)
        : null;
      if (delivery) {
        firstAt = firstAt === null ? delivery.atPerformanceMs : Math.min(firstAt, delivery.atPerformanceMs);
        lastAt = lastAt === null ? delivery.atPerformanceMs : Math.max(lastAt, delivery.atPerformanceMs);
        latencies.push(latencyMs!);
      }
      byObserver[observer] = delivery ? {
        converged: true,
        latencyMs,
        source: delivery.source,
        frameKind: delivery.frameKind,
        observedVersion: delivery.version,
      } : {converged: false};
    }
    const fullyConverged = observers.size > 0
      && [...observers.keys()].every(observer => (
        (byObserver[observer] as AnyRecord).converged === true
      ));
    if (fullyConverged) fullyConvergedMutations += 1;
    logger.record('mutation_convergence', {
      cycle: mutation.cycle,
      inventoryIndex: mutation.inventoryIndex,
      name: mutation.name,
      effectClass: mutation.effectClass,
      clientMutationId: mutation.clientMutationId,
      committedVersion: mutation.committedVersion,
      fullyConverged,
      firstObserverLatencyMs: firstAt === null
        ? null
        : roundedMilliseconds(firstAt - mutation.dispatchedAtPerformanceMs),
      lastObserverLatencyMs: lastAt === null
        ? null
        : roundedMilliseconds(lastAt - mutation.dispatchedAtPerformanceMs),
      observers: byObserver,
    });
  }
  return {
    measuredMutations,
    fullyConvergedMutations,
    observerConvergenceSamples: latencies.length,
  };
}

async function closeObservers(
  observers: Map<ObserverName, ObserverStats>,
  logger: JsonlLogger,
): Promise<void> {
  for (const stats of observers.values()) {
    const errors: AnyRecord[] = [];
    const handle = stats.handle;
    if (handle && typeof handle.dispose === 'function') {
      try {
        await Promise.resolve((handle.dispose as () => unknown)());
        if (typeof handle.settled === 'function') {
          await (handle.settled as () => Promise<void>)();
        }
      } catch (error) {
        errors.push(errorFact(error));
      }
    }
    try {
      stats.offManagerState?.();
    } catch (error) {
      errors.push(errorFact(error));
    }
    try {
      stats.restoreSubscribe?.();
    } catch (error) {
      errors.push(errorFact(error));
    }
    stats.offManagerState = null;
    stats.restoreSubscribe = null;
    logger.record('observer_disposed', {
      actor: stats.actor,
      connectionId: stats.connectionId,
      errors,
    });
  }
}

async function closeClients(
  sessions: Map<Actor, BoundSession>,
  anonymous: AnyClient | null,
  observerSources: ObserverSource[],
  authorityProbeSession: BoundSession | null,
  logger: JsonlLogger,
): Promise<void> {
  const candidates: Array<[string, AnyClient]> = [
    ...[...sessions].map(([actor, session]) => [actor, session.client] as [string, AnyClient]),
    ...(anonymous ? [['anonymous', anonymous] as [string, AnyClient]] : []),
    ...observerSources.map(source => [source.label, source.client] as [string, AnyClient]),
    ...(authorityProbeSession
      ? [['authority-probe', authorityProbeSession.client] as [string, AnyClient]]
      : []),
  ];
  const seen = new Set<AnyClient>();
  const clients = candidates.filter(([, client]) => {
    if (seen.has(client)) return false;
    seen.add(client);
    return true;
  });
  for (const [actor, client] of clients) {
    try {
      await client.closeAuth();
      logger.record('client_closed', {actor, outcome: 'succeeded'});
    } catch (error) {
      logger.record('client_closed', {actor, outcome: 'failed', error: errorFact(error)});
    }
  }
}

async function run(options: Options, logger: JsonlLogger): Promise<void> {
  runIdentitySuffix = `-o${options.cycleOffset}`;
  const abortController = new AbortController();
  let interruptedBy: NodeJS.Signals | null = null;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (interruptedBy !== null) return;
    interruptedBy = signal;
    logger.record('signal', {signal});
    abortController.abort(new Error(`interrupted by ${signal}`));
  };
  const onSigint = (): void => onSignal('SIGINT');
  const onSigterm = (): void => onSignal('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  const sessions = new Map<Actor, BoundSession>();
  let anonymous: AnyClient | null = null;
  let authorityProbeSession: BoundSession | null = null;
  let observerSources: ObserverSource[] = [];
  let observers = new Map<ObserverName, ObserverStats>();
  const plannedCycles = options.arrivalMode === 'sustained'
    ? Math.ceil(
      options.sustainSeconds * 1_000
      / options.sustainIntervalMs
      / MUTATION_NAMES.length,
    )
    : options.cycles;
  const plannedOperationCount = options.arrivalMode === 'sustained'
    ? Math.ceil(options.sustainSeconds * 1_000 / options.sustainIntervalMs)
    : plannedCycles * MUTATION_NAMES.length;
  const tracker: MutationTracker = {
    total: plannedOperationCount,
    dispatched: 0,
    settled: 0,
    applied: 0,
    refused: 0,
  };
  const mutationSettlements: Promise<void>[] = [];
  const mutationFacts: MutationFact[] = [];
  const authorityTransitionSettlements: Promise<void>[] = [];
  const authorityTransitionTracker: AuthorityTransitionTracker = {
    total: options.authorityTransitions,
    dispatched: 0,
    settled: 0,
    applied: 0,
    refused: 0,
    skipped: 0,
  };
  let pollFailures = 0;
  try {
    const ready = JSON.parse(await readFile(options.readyFile, 'utf8')) as AnyRecord;
    assert.equal(typeof ready.serverUrl, 'string', 'ready file carries serverUrl');
    const overlay = await readAndVerifyOverlay(options.overlayPath) as unknown as AnyRecord;
    const payload = overlay.payload as AnyRecord;
    logger.record('epoch', {
      schemaVersion: 'zerobugs.diag-hot-stream.v1',
      epochPerformanceNowMs: logger.epochPerformanceNowMs,
      epochWallClockIso: logger.epochWallClockIso,
      clock: 'performance.now delta milliseconds',
      outPath: logger.outPath,
    });
    logger.record('configuration', {
      pinnedGeneration,
      readyFile: options.readyFile,
      serverUrl: ready.serverUrl,
      overlayPath: options.overlayPath,
      overlayDigest: overlay.contentDigest ?? null,
      fixtureId: payload.fixtureId ?? null,
      selectedProject: payload.selectedProject ?? null,
      cycles: options.cycles,
      plannedCycles,
      plannedOperationCount,
      arrivalMode: options.arrivalMode,
      sustainedIntervalMs: options.sustainIntervalMs,
      sustainedSeconds: options.sustainSeconds,
      observerCount: options.observerCount,
      observerPartition: options.observerPartition,
      observerSession: options.observerSession,
      coalescing: options.coalescing,
      coalescingDisabled: options.coalescing === 'off',
      ...(options.authorityTransitions > 0 ? {
        authorityTransitions: options.authorityTransitions,
        authorityTransitionStartOffsetMs: AUTHORITY_TRANSITION_START_OFFSET_MS,
        authorityTransitionIntervalMs: AUTHORITY_TRANSITION_INTERVAL_MS,
      } : {}),
      repeatedOperationPolicy: 'keep-all-16-and-record-deterministic-refusals',
      observeSecondsPerCycle: options.observeSeconds,
      statusIntervalSeconds: STATUS_INTERVAL_MS / 1_000,
      observerOpenTimeoutSeconds: OBSERVER_OPEN_TIMEOUT_MS / 1_000,
      stream: {
        transport: 'stream',
        fallbackToPoll: false,
        windowLimit: 1_000,
        tuning: 'SnapbackClient defaults',
      },
      resubscribeInstrumentation: {
        exactAttemptSurface: 'instance-local wrapper around public client.subscribeLive',
        successEventSurface: 'liveQuery onSubscriptionEvent(resubscribed)',
        socketSurface: 'liveStreamManager.onState plus manager generation/backoff fields',
        inspectionSurface: 'localResourceInspection([connectionId])',
        unavailableWithoutPackagePatch: [
          'handle closure-private needsResubscribe flag',
          'handle closure-private resubscribe retry timer and demand epoch',
        ],
      },
    });

    const bound = await bindOrAdoptActors(options.readyFile, overlay, logger);
    for (const [actor, session] of bound) sessions.set(actor, session);
    anonymous = anonymousClient(String(ready.serverUrl));
    const projectName = await selectedProjectName(
      anonymous,
      String((payload.selectedProject as AnyRecord).id),
      logger,
    );
    const plan = buildHotOperationPlan(overlay, plannedCycles, options.cycleOffset);
    logger.record('operation_plan', {
      cycles: plan.length,
      cycleOffset: options.cycleOffset,
      operationsPerCycle: MUTATION_NAMES.length,
      arrivalMode: options.arrivalMode,
      fixedArrivalIntervalMs: FIXED_ARRIVAL_INTERVAL_MS,
      sustainedArrivalIntervalMs: options.sustainIntervalMs,
      sustainedSeconds: options.sustainSeconds,
      adaptiveArrivals: options.arrivalMode === 'settle-gated',
      mutationNames: MUTATION_NAMES,
    });

    observerSources = await buildObserverSources(
      options,
      sessions,
      anonymous,
      overlay,
      logger,
    );
    observers = await openObservers(observerSources, projectName, logger);
    for (const stats of observers.values()) {
      emitObserverStatus(null, 'all-open', stats, logger);
    }
    if (options.authorityTransitions > 0) {
      authorityProbeSession = await mintAuthorityProbeSession(options.readyFile, logger);
    }

    if (options.arrivalMode === 'sustained') {
      const operationCount = Math.ceil(
        options.sustainSeconds * 1_000 / options.sustainIntervalMs,
      );
      const operations = plan.flatMap(cycle => cycle.operations).slice(0, operationCount);
      logger.record('sustained_start', {
        operations: operations.length,
        intervalMs: options.sustainIntervalMs,
        durationSeconds: options.sustainSeconds,
      });
      const streamStart = performance.now() + 50;
      if (authorityProbeSession) {
        authorityTransitionSettlements.push(...scheduleAuthorityTransitions(
          options.authorityTransitions,
          authorityProbeSession,
          streamStart,
          logger,
          authorityTransitionTracker,
          abortController.signal,
        ));
      }
      const scheduled = operations.map((operation, index) => scheduleMutation(
        Math.floor(index / MUTATION_NAMES.length),
        {...operation, arrivalOffsetMs: index * options.sustainIntervalMs},
        sessions,
        streamStart,
        logger,
        tracker,
        mutationFacts,
        abortController.signal,
      ));
      mutationSettlements.push(...scheduled.map(row => row.settled));
      const observation = observeCycle(
        0,
        options.sustainSeconds,
        observers,
        logger,
        abortController.signal,
      );
      await Promise.all(scheduled.map(row => row.dispatched));
      await observation;
      logger.record('sustained_end', {mutationTracker: tracker});
    } else for (const cycle of plan) {
      if (abortController.signal.aborted) break;
      logger.record('cycle_start', {
        cycle: cycle.cycle,
        operations: cycle.operations.length,
        observeSeconds: options.observeSeconds,
      });
      const cycleStart = performance.now() + 50;
      if (authorityProbeSession && authorityTransitionSettlements.length === 0) {
        authorityTransitionSettlements.push(...scheduleAuthorityTransitions(
          options.authorityTransitions,
          authorityProbeSession,
          cycleStart,
          logger,
          authorityTransitionTracker,
          abortController.signal,
        ));
      }
      const scheduled = options.arrivalMode === 'settle-gated'
        ? []
        : cycle.operations.map(operation => scheduleMutation(
          cycle.cycle,
          operation,
          sessions,
          cycleStart,
          logger,
          tracker,
          mutationFacts,
          abortController.signal,
        ));
      if (options.arrivalMode === 'settle-gated') {
        for (const operation of cycle.operations) {
          const one = scheduleMutation(
            cycle.cycle,
            {...operation, arrivalOffsetMs: 0},
            sessions,
            performance.now(),
            logger,
            tracker,
            mutationFacts,
            abortController.signal,
          );
          scheduled.push(one);
          await one.dispatched;
          await one.settled;
        }
      }
      mutationSettlements.push(...scheduled.map(row => row.settled));
      await Promise.all(scheduled.map(row => row.dispatched));
      logger.record('cycle_dispatched', {
        cycle: cycle.cycle,
        dispatchSpanMs: options.arrivalMode === 'settle-gated'
          ? null
          : cycle.operations.at(-1)?.arrivalOffsetMs ?? 0,
        mutationTracker: tracker,
      });
      await observeCycle(
        cycle.cycle,
        options.observeSeconds,
        observers,
        logger,
        abortController.signal,
      );
      logger.record('cycle_end', {
        cycle: cycle.cycle,
        mutationTracker: tracker,
        pendingMutationResponses: tracker.dispatched - tracker.settled,
      });
    }

    if (authorityTransitionSettlements.length > 0) {
      await Promise.all(authorityTransitionSettlements);
    }

    if (!abortController.signal.aborted) {
      pollFailures = await finalPolls(observers, logger);
    }

    if (mutationSettlements.length > 0 && tracker.settled < tracker.dispatched) {
      await Promise.race([
        Promise.allSettled(mutationSettlements),
        delay(5_000),
      ]);
    }
    const convergence = recordConvergence(mutationFacts, observers, logger);
    logger.record('summary', {
      outcome: abortController.signal.aborted ? 'interrupted' : 'completed',
      interruptedBy,
      cyclesRequested: options.cycles,
      observerSession: options.observerSession,
      mutationTracker: tracker,
      pendingMutationResponses: tracker.dispatched - tracker.settled,
      pollFailures,
      convergence,
      ...(options.authorityTransitions > 0
        ? {authorityTransitionTracker}
        : {}),
      observers: Object.fromEntries([...observers].map(([actor, stats]) => [actor, {
        connection: stats.handle?.connection ?? null,
        version: stats.handle?.version ?? null,
        deliveries: stats.deliveries,
        onUpdateDeliveries: stats.onUpdateDeliveries,
        socketReconnectAttempts: Math.max(0, stats.managerConnectingEvents - 1),
        resubscribe: stats.subscription,
        frameLedger: stats.frameLedger,
      }])),
    });
    if (pollFailures > 0) process.exitCode = 1;
    if (authorityTransitionTracker.refused > 0) process.exitCode = 1;
    if (interruptedBy !== null) process.exitCode = interruptedBy === 'SIGINT' ? 130 : 143;
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    await closeObservers(observers, logger);
    await closeClients(sessions, anonymous, observerSources, authorityProbeSession, logger);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options === null) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const logger = await JsonlLogger.create(options.outPath);
  try {
    await run(options, logger);
  } catch (error) {
    logger.record('fatal', {error: errorFact(error)});
    process.exitCode = 1;
  } finally {
    await logger.close();
  }
}

await main();

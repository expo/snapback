import {
  SnapbackClient,
  admitSnapbackId,
  createRqsRegisteredRegistry,
  type ActiveSeedIdentityV1,
  type SnapbackEphemeralReference,
  type SnapbackAppRefusalError,
  type SnapbackDiagnosticCode,
  type SnapbackFunctionReference,
  type SearchPageV1,
  type SearchRequestV1,
  type SeedArtifactV1,
  type SeedEnsureResultV1,
  type SeedInstallReceiptV1,
  type SeedMatchedObservationV1,
  type SeedPreviewResultV1,
} from './index.mjs';

const registeredDiagnosticCode: SnapbackDiagnosticCode = 'SNAPBACK_APP_REFUSAL';
registeredDiagnosticCode.toLowerCase();
// @ts-expect-error diagnostic codes are generated from the production registry.
const inventedDiagnosticCode: SnapbackDiagnosticCode = 'SNAPBACK_NOT_A_REGISTERED_CODE';
void inventedDiagnosticCode;
declare const refusalError: SnapbackAppRefusalError;
refusalError.diagnostic.details.appCode.toUpperCase();

declare const listTodos: SnapbackFunctionReference<
  'listTodos',
  'LiveQuery',
  { owner: string },
  ReadonlyArray<{ _id: string; title: string }>
>;
declare const createTodo: SnapbackFunctionReference<
  'createTodo',
  'Mutation',
  { title: string },
  string
>;
declare const presence: SnapbackEphemeralReference<
  'presence',
  { roomId: string },
  { userId: string; viewing: string }
>;
declare const searchIncidents: SnapbackFunctionReference<
  'searchIncidents',
  'Query',
  SearchRequestV1,
  SearchPageV1<
    Readonly<{ title: string; summary: string | null }>,
    string & { readonly __snapbackIdTable: 'incidents' }
  >
>;
declare const searchShapedOrdinaryQuery: SnapbackFunctionReference<
  'searchShapedOrdinaryQuery',
  'Query',
  SearchRequestV1,
  Readonly<{
    items: readonly Readonly<{
      rowId: string;
      score: number;
      fields: Readonly<{ title: string }>;
      highlights: readonly [];
    }>[];
    cursor: string | null;
    hasMore: boolean;
  }>
>;
type GeneratedId<Table extends string> =
  string & { readonly __snapbackIdTable: Table };

const client = new SnapbackClient('http://127.0.0.1:5050');
const admittedTodoId: GeneratedId<'todos'> = admitSnapbackId('todos', 'todo_01');
admittedTodoId.toUpperCase();
// @ts-expect-error admission preserves the exact table brand.
const admittedWrongId: GeneratedId<'users'> = admitSnapbackId('todos', 'todo_01');
void admittedWrongId;
client.query(listTodos, { args: { owner: 'ada' } }).then((output) => {
  output.rows[0]?.title.toUpperCase();
});
client.mutate(createTodo, { args: { title: 'ship it' } }).then((output) => {
  output.result.toUpperCase();
});
client.liveQuery(listTodos, {
  connectionId: 'fixture',
  args: { owner: 'ada' },
  onUpdate(rows) {
    rows[0]?.title.toUpperCase();
  },
});
const registeredRegistry = createRqsRegisteredRegistry({
  commitVersion: 1,
  entries: [],
  connection: {
    connectionId: 'fixture',
    grant: 'grant',
    attachDeadline: Date.now() + 30_000,
  },
});
client.liveQuery(listTodos, {
  connectionId: 'fixture',
  args: { owner: 'ada' },
  transport: 'stream',
  registeredSubscription: registeredRegistry.consume('listTodos', { owner: 'ada' }),
});
// @ts-expect-error registered adoption requires the stream transport.
client.liveQuery(listTodos, {
  connectionId: 'fixture',
  args: { owner: 'ada' },
  transport: 'poll',
  registeredSubscription: {
    subscriptionId: 'sub_fixture',
    rows: [],
    version: 1,
    resume: null,
    attachDeadline: Date.now() + 30_000,
  },
});
client.subscribeEphemeral(presence, {
  connectionId: 'fixture',
  scope: { roomId: 'incident-1' },
}).then((overlay) => overlay.publish({ userId: 'ada', viewing: 'incident' }));

// @ts-expect-error query arguments come from the generated reference.
client.query(listTodos, { args: { ownerId: 'ada' } });
// @ts-expect-error mutation arguments come from the generated reference.
client.mutate(createTodo, { args: { body: 'wrong key' } });
client.subscribeEphemeral(presence, { connectionId: 'fixture' })
  // @ts-expect-error ephemeral values come from the generated reference.
  .then((overlay) => overlay.publish({ userId: 'ada' }));

const searchQuery = { all: [{ Term: { value: 'cache' } }] } as const;
client.query(searchIncidents, { args: { query: searchQuery } }).then((output) => {
  // The generic query carrier keeps rows/cursor on QueryOutput even though
  // the generated operation phantom is the client.search SearchPageV1.
  output.rows[0]?.fields.title.toUpperCase();
  output.cursor?.toUpperCase();
  // @ts-expect-error generic query does not project SearchPageV1.
  output.rows.items;
});
client.search(searchIncidents, { query: searchQuery }).then((page) => {
  page.items[0]?.fields.title.toUpperCase();
  page.items[0]?.fields.summary?.toUpperCase();
  page.cursor?.toUpperCase();
});
client.query(searchShapedOrdinaryQuery, { args: { query: searchQuery } }).then((output) => {
  // A structurally page-shaped ordinary query is still one object-valued row,
  // not the search operation's QueryOutput rows/cursor transport projection.
  output.rows.items[0]?.fields.title.toUpperCase();
  output.rows.cursor?.toUpperCase();
  // @ts-expect-error the unbranded ordinary result is not transformed to an item array.
  output.rows[0];
});
// @ts-expect-error a structurally page-shaped ordinary query lacks the search phantom brand.
client.search(searchShapedOrdinaryQuery, { query: searchQuery });
// @ts-expect-error ordinary query refs are not search operation refs.
client.search(listTodos, { query: searchQuery });
// @ts-expect-error search requires a generated ref, not an unbranded function string.
client.search('searchIncidents', { query: searchQuery });
// @ts-expect-error null is not a SearchRequestV1 cursor and would be refused on wire.
client.search(searchIncidents, { query: searchQuery, after: null });

declare const seedArtifact: SeedArtifactV1;
declare const expectedStream:
  | { readonly state: 'absent' }
  | { readonly state: 'present'; readonly value: string };
declare const activeSeed: ActiveSeedIdentityV1;
declare const installReceipt: Extract<
  SeedInstallReceiptV1,
  { readonly operation: 'install' }
>;
declare const matchedSeed: SeedMatchedObservationV1;
declare const ensureResult: SeedEnsureResultV1;
declare const previewResult: SeedPreviewResultV1;
activeSeed.dataVersionStream.toUpperCase();
installReceipt.outcome satisfies 'installed';
matchedSeed.outcome satisfies 'matched';
if (ensureResult.state === 'installed') {
  ensureResult.receipt.operation satisfies 'install';
} else {
  ensureResult.observation.active.seedDigest.toUpperCase();
}
if (previewResult.state === 'refused') {
  previewResult.diagnosticCode satisfies
    | 'SNAPBACK_SEED_VERSION_REUSED'
    | 'SNAPBACK_SEED_MIGRATION_REQUIRED'
    | 'SNAPBACK_SEED_NONEMPTY_UNTRACKED'
    | 'SNAPBACK_SEED_PARTIAL_UNTRACKED'
    | 'SNAPBACK_SEED_OPERATION_HISTORICAL'
    | 'SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED';
}
client.ensureVersionedSeed(seedArtifact).then((result) => {
  if (result.state === 'installed') {
    result.receipt.outcome satisfies 'installed';
  } else {
    result.observation.establishingReceipt.dataVersionStream.toUpperCase();
  }
});
client.previewVersionedSeed(seedArtifact).then((result) => {
  if (result.state === 'refused') result.diagnosticCode.toUpperCase();
  result.totalApplicationEffects.toFixed();
});
client.previewVersionedSeed(seedArtifact, { operation: 'install' });
client.previewVersionedSeed(seedArtifact, {
  operation: 'resetInstall',
  expectedDataVersionStream: expectedStream,
});
client.previewVersionedSeed(null, {
  operation: 'clear',
  expectedDataVersionStream: expectedStream,
});
client.resetInstallVersionedSeed(seedArtifact, {
  expectedDataVersionStream: expectedStream,
}).then((receipt) => {
  receipt.operation satisfies 'reset-install';
  receipt.outcome satisfies 'reset-installed';
});
client.clearVersionedSeed({ expectedDataVersionStream: expectedStream }).then((receipt) => {
  receipt.operation satisfies 'clear';
  receipt.outcome satisfies 'cleared';
  // @ts-expect-error cleared receipts omit seed identity fields.
  receipt.seedVersion.toUpperCase();
});
// @ts-expect-error an install operation cannot claim the cleared outcome.
const impossibleReceipt: SeedInstallReceiptV1 = {
  formatVersion: 'snapback.seed.receipt.v1',
  operationId: 'operation',
  requestDigest: 'digest',
  operation: 'install',
  outcome: 'cleared',
  appId: 'app',
  schemaHash: 'schema',
  dataVersionStream: 'stream',
  directApplicationRows: 0,
  derivedProjectionRows: 0,
  totalApplicationEffects: 0,
  resetDeletedRows: 0,
  seedVersion: 'v1',
  seedDigest: 'digest',
};
// @ts-expect-error resetInstall preview requires an artifact.
client.previewVersionedSeed(null, {
  operation: 'resetInstall',
  expectedDataVersionStream: expectedStream,
});
// @ts-expect-error resetInstall preview requires a predecessor stream.
client.previewVersionedSeed(seedArtifact, { operation: 'resetInstall' });
client.previewVersionedSeed(seedArtifact, {
  // @ts-expect-error clear preview forbids an artifact.
  operation: 'clear',
  expectedDataVersionStream: expectedStream,
});
// @ts-expect-error clear preview requires a predecessor stream.
client.previewVersionedSeed(null, { operation: 'clear' });

client.replayQueuedMutations().then((outcome) => outcome.quarantined.toFixed());
client.quarantinedMutations().then((tombstones) => {
  const first = tombstones[0];
  if (first) {
    first.status satisfies 'quarantined';
    first.provenance.payload satisfies 'redacted';
    // @ts-expect-error the public tombstone never exposes a queued payload.
    first.args;
  }
});
client.reenterQuarantinedMutations().then((outcome) => {
  outcome.reentered.toFixed();
  outcome.clientMutationIds[0]?.toUpperCase();
});

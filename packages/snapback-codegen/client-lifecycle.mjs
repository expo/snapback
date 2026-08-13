// Generated client-reference lifecycle vocabulary for LLP 0238 rollout 1.
//
// This module is the executable source for both client-lifecycle.v1.json and
// generated reference JSDoc. Keeping the prose projection beside the artifact
// prevents the declaration surface from acquiring a second lifecycle table.

export const CLIENT_LIFECYCLE_MANIFEST_FILE = 'client-lifecycle.v1.json';
export const CLIENT_LIFECYCLE_MANIFEST_VERSION = 'snapback.client-lifecycle.v1';
export const CLIENT_REFERENCE_GUIDE = '/_snapback/guide/clients/headless.md#generated-reference-kinds-and-legal-verbs';
export const CLIENT_REFERENCE_KIND_MISMATCH_CODE = 'SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH';

const compatibilityAlias = (current, plannedCanonical) => Object.freeze({
  current,
  plannedCanonical,
  emittedInRollout1: false,
  removalEpoch: 'declared-major-after-stage-2-measurement',
});

// @ref LLP 0238#d4-react-and-expo-hooks-are-kind-explicit — this data is the
// one rename authority consumed by lifecycle artifacts and familiar JSDoc.
// @ref LLP 0253#s63-usemutation — Phase C completes the dispatch, status,
// task, and read rows so familiar routing follows the planned vocabulary.
export const CLIENT_COMPATIBILITY_ALIASES = Object.freeze([
  compatibilityAlias('useSnapbackQuery', 'useSnapbackLiveQuery'),
  compatibilityAlias('useSnapbackMutation', 'useSnapbackMutationDispatch'),
  compatibilityAlias('useSnapbackOutbox().mutationStatus', 'useSnapbackMutationStatus'),
  compatibilityAlias('useSnapbackCommand', 'useSnapbackTask'),
  compatibilityAlias('client.query', 'client.read'),
]);

const dispositions = Object.freeze([
  'pending',
  'settled',
  'failed',
  'stranded',
  'quarantined',
  'resultGone',
  'unknown',
]);

const lifecycle = ({
  kind,
  runtimeDiscriminant,
  acceptedBy,
  correctVerb,
  auth,
  freshness,
  retention,
  stateCarrier,
  guideAnchor = CLIENT_REFERENCE_GUIDE,
}) => Object.freeze({
  kind,
  runtimeDiscriminant,
  acceptedBy: Object.freeze([...acceptedBy]),
  correctVerb,
  auth,
  freshness,
  retention,
  stateCarrier,
  guideAnchor,
});

// @ref LLP 0238#d1-generated-references-are-nominal-by-operation-kind — this
// closed current-product table drives both the generated artifact and JSDoc.
export const CLIENT_REFERENCE_LIFECYCLES = Object.freeze([
  lifecycle({
    kind: 'Query',
    runtimeDiscriminant: 'Query',
    acceptedBy: ['query', 'liveQuery'],
    correctVerb: 'query',
    auth: 'per-operation authRequirement and requiredCapabilities',
    freshness: 'one-shot authoritative response or liveQuery snapshot followed by updates',
    retention: 'none',
    stateCarrier: 'Promise<QueryOutput<Result>>',
  }),
  lifecycle({
    kind: 'LiveQuery',
    runtimeDiscriminant: 'LiveQuery',
    acceptedBy: ['query', 'liveQuery', 'useSnapbackQuery', 'useSnapbackQueries'],
    correctVerb: 'liveQuery',
    auth: 'per-operation authRequirement and requiredCapabilities',
    freshness: 'authoritative initial snapshot followed by live updates',
    retention: 'per-operation retainable/retentionClass declaration',
    stateCarrier: 'LiveQueryHandle or React QueryState',
  }),
  lifecycle({
    kind: 'Mutation',
    runtimeDiscriminant: 'Mutation',
    acceptedBy: ['mutate', 'useSnapbackMutation', 'useSnapbackSettledMutation'],
    correctVerb: 'mutate',
    auth: 'per-operation authRequirement and requiredCapabilities',
    freshness: 'dispatch result is not durable settlement',
    retention: 'durable outbox identity until terminal disposition/acknowledgement',
    stateCarrier: 'MutationDispatchOutcome plus MutationDisposition',
  }),
  lifecycle({
    kind: 'Action',
    runtimeDiscriminant: 'Action',
    acceptedBy: ['action'],
    correctVerb: 'action',
    auth: 'per-operation authRequirement and requiredCapabilities',
    freshness: 'one-shot online response',
    retention: 'none',
    stateCarrier: 'Promise<ActionOutput<Result>>',
  }),
  lifecycle({
    kind: 'Command',
    runtimeDiscriminant: 'asset-bearing-command.v1',
    acceptedBy: ['commandClient.start', 'useSnapbackCommand'],
    correctVerb: 'commandClient.start',
    auth: 'inherited from the descriptor mutation and asset intent',
    freshness: 'task snapshot is process-local; mutation settlement remains durable',
    retention: 'command task is process-local; constituent mutation follows outbox retention',
    stateCarrier: 'CommandTask',
  }),
]);

const byKind = new Map(CLIENT_REFERENCE_LIFECYCLES.map((entry) => [entry.kind, entry]));

export function lifecycleForReferenceKind(kind) {
  const entry = byKind.get(kind);
  if (!entry) throw new TypeError(`unknown client reference kind ${JSON.stringify(kind)}`);
  return entry;
}

const operationProjection = (fn) => {
  const entry = lifecycleForReferenceKind(fn.kind);
  return {
    semanticIdentity: fn.id,
    name: fn.name,
    kind: fn.kind,
    runtimeDiscriminant: entry.runtimeDiscriminant,
    implementationHash: fn.implementationHash,
    argsContractHash: fn.argsContractHash,
    resultContractHash: fn.resultContractHash,
    authRequirement: fn.authRequirement ?? 'optional-user',
    requiredCapabilities: [...new Set(fn.requiredCapabilities ?? [])].sort(),
    legalVerbs: [...entry.acceptedBy],
    correctVerb: entry.correctVerb,
    freshness: entry.freshness,
    retention: fn.kind === 'LiveQuery'
      ? (fn.retainable === true
          ? fn.retentionClass ?? 'opaque-authorized-snapshot-v1'
          : 'none')
      : entry.retention,
    delivery: ({ Query: 'read', LiveQuery: 'live', Mutation: 'mutation', Action: 'action' })[fn.kind],
    states: fn.kind === 'Mutation'
      ? ['dispatch:settled', 'dispatch:queued', ...dispositions.map((state) => `disposition:${state}`)]
      : fn.kind === 'Query' || fn.kind === 'LiveQuery'
        ? ['connecting', 'live', 'polling', 'stale', 'disconnected']
        : [],
    guideAnchor: entry.guideAnchor,
  };
};

export function buildClientLifecycleManifest({
  appId,
  inputsHash,
  authoredSourceHash,
  targetProfile,
  functions,
  commands = {},
}) {
  const operations = [...functions]
    .map(operationProjection)
    .sort((left, right) => left.semanticIdentity.localeCompare(right.semanticIdentity));
  const operationsByName = new Map(operations.map((operation) => [operation.name, operation]));
  const generatedCommands = Object.entries(commands)
    .map(([name, command]) => {
      const mutation = operationsByName.get(command.mutation?.name);
      return {
        semanticIdentity: `${appId}:command:${name}`,
        name,
        kind: 'Command',
        runtimeDiscriminant: 'asset-bearing-command.v1',
        mutationIdentity: mutation?.semanticIdentity ?? command.mutation?.id ?? null,
        implementationHash: mutation?.implementationHash ?? command.mutation?.implementationHash ?? null,
        authRequirement: mutation?.authRequirement ?? 'optional-user',
        requiredCapabilities: mutation?.requiredCapabilities ?? [],
        legalVerbs: [...lifecycleForReferenceKind('Command').acceptedBy],
        correctVerb: lifecycleForReferenceKind('Command').correctVerb,
        freshness: lifecycleForReferenceKind('Command').freshness,
        retention: lifecycleForReferenceKind('Command').retention,
        states: [
          'preparing', 'transferring', 'committing',
          'succeeded', 'failed', 'cancelled', 'ambiguous',
        ],
        guideAnchor: CLIENT_REFERENCE_GUIDE,
      };
    })
    .sort((left, right) => left.semanticIdentity.localeCompare(right.semanticIdentity));

  return {
    artifactKind: 'clientLifecycleManifest',
    schemaVersion: CLIENT_LIFECYCLE_MANIFEST_VERSION,
    appId,
    inputsHash,
    authoredSourceHash,
    targetProfile,
    custody: {
      consumer: 'developer-tooling',
      storageClass: 'regenerable-cache',
      committedProjectionRequired: false,
      rationale: 'rollout 1 has no runtime consumer; codegen, generated declarations, tests, and guide checks consume the same source table',
    },
    surfaceFamilies: ['query', 'liveQuery', 'mutate', 'action', 'commands'],
    referenceKinds: CLIENT_REFERENCE_LIFECYCLES.map((entry) => ({ ...entry })),
    handleStates: {
      liveQueryHandle: {
        nonterminalConnection: ['connecting', 'live', 'polling', 'stale'],
        terminalConnection: ['disconnected'],
        disposalMeaning: 'disposed handles publish no further rows and release their subscription resources',
      },
      commandTask: {
        nonterminal: ['preparing', 'transferring', 'committing'],
        terminal: ['succeeded', 'failed', 'cancelled', 'ambiguous'],
      },
    },
    mutationSettlement: {
      // @ref LLP 0218#decision — this is the complete durable public
      // disposition union; process-local promise completion is not another
      // settlement state.
      dispositions: [...dispositions],
      dispatch: 'mutate() resolves to settled or queued dispatch; queued means durably recorded for delivery, not settled',
      settlement: 'mutationStatus()/subscribeMutation() project durable disposition by clientMutationId',
      terminal: ['settled', 'failed', 'stranded', 'quarantined', 'resultGone'],
      nonterminal: ['pending', 'unknown'],
    },
    resourceIdentity: {
      version: 'snapback.client-resource-key.v1',
      ingredients: [
        'reference semantic identity',
        'canonical argument contract and canonical argument bytes',
        'authority partition',
        'normalized lifecycle options',
        'build identity inputsHash',
      ],
    },
    diagnostics: [{
      code: CLIENT_REFERENCE_KIND_MISMATCH_CODE,
      phase: 'client-call-boundary-before-transport',
      receivedField: 'receivedKind',
      acceptedField: 'acceptedKinds',
      remediationField: 'correctVerb',
      guideAnchor: CLIENT_REFERENCE_GUIDE,
    }],
    compatibilityAliases: CLIENT_COMPATIBILITY_ALIASES.map((entry) => ({ ...entry })),
    futureClassM: {
      shippedInRollout1: false,
      snapshotVersionMeaning: 'authorized principal/query viewRevision',
      forbiddenMeaning: 'raw row version, app commit, or storage snapshot',
      note: 'when class-M handles ship, snapshotVersion identifies the authorized principal/query view',
    },
    operations,
    commands: generatedCommands,
  };
}

const jsdocSafe = (value) => String(value).replaceAll('*/', '*\\/');
const code = (value) => `\`${jsdocSafe(value)}\``;

// @ref LLP 0238#d7-vocabulary-and-state-tables-are-generated-once — declaration
// comments are rendered from the same operation rows as the JSON projection.
export function renderReferenceJSDoc(reference, manifest, authoringProfile = 'snapback-explicit-v1') {
  const entry = lifecycleForReferenceKind(reference.kind);
  const projected = reference.kind === 'Command'
    ? manifest.commands.find(({ name }) => name === reference.name)
    : manifest.operations.find(({ semanticIdentity }) => semanticIdentity === reference.id);
  if (!projected) {
    throw new TypeError(`client lifecycle has no ${reference.kind} reference ${JSON.stringify(reference.name)}`);
  }
  const verbs = projected.legalVerbs.map(code).join(', ');
  const capabilities = projected.requiredCapabilities.length === 0
    ? 'none'
    : projected.requiredCapabilities.map(code).join(', ');
  const states = projected.states.length === 0
    ? 'promise-only (no handle state table)'
    : projected.states.map(code).join(', ');
  const profileRoutes = [];
  if (authoringProfile === 'snapback-familiar-ts-v1' && projected.kind === 'Mutation') {
    const dispatch = CLIENT_COMPATIBILITY_ALIASES.find(
      ({ current }) => current === 'useSnapbackMutation',
    );
    const status = CLIENT_COMPATIBILITY_ALIASES.find(
      ({ current }) => current === 'useSnapbackOutbox().mutationStatus',
    );
    profileRoutes.push(
      ` * Familiar \`useMutation\` is settled-only (\`queue:false\`); offline lifecycle: ${code(dispatch.current)} + ${code(status.current)} (planned ${code(dispatch.plannedCanonical)} + ${code(status.plannedCanonical)}).`,
    );
  }
  if (authoringProfile === 'snapback-familiar-ts-v1' && projected.delivery === 'read') {
    const read = CLIENT_COMPATIBILITY_ALIASES.find(({ current }) => current === 'client.query');
    profileRoutes.push(
      ` * Familiar delivery ${code('read')} has no v1 hook; call ${code(read.current)} (planned ${code(read.plannedCanonical)}).`,
    );
  }
  return [
    '/**',
    ` * ${jsdocSafe(reference.kind)} reference ${code(projected.semanticIdentity)}.`,
    ` * Legal client verbs/hooks: ${verbs}.`,
    ` * Auth: ${code(projected.authRequirement)}; required capabilities: ${capabilities}.`,
    ` * Freshness: ${jsdocSafe(projected.freshness)} Retention: ${jsdocSafe(projected.retention)}.`,
    ` * Dispatch/task states: ${states}.`,
    ...profileRoutes,
    ` * Build identity: ${code(manifest.inputsHash)}. Guide: ${code(entry.guideAnchor)}.`,
    ' */',
  ].join('\n');
}

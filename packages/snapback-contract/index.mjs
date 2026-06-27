// Snapback <-> Contract adapter.
//
// @ref LLP 0005#contractexact-integration - the generated Contract adapter owns
//   the boring seams Valet demos copied by hand: boot, query-boundary wiring,
//   mutation invocation, initial snapshot, pending state, and provider wiring.
// @ref LLP 0012#capability-manifest - Online vs. Parity: this adapter speaks the
//   wire protocol and runs mutations on the server. It does not run handlers
//   locally, so it reports Online and must not be presented as Parity.

export const SNAPBACK_CONTRACT_ADAPTER_VERSION = 1;
export const SNAPBACK_CONTRACT_CAPABILITY_CLASS = 'Online';

export function validateSnapbackContractArtifacts({
  manifest,
  contractDataManifest,
  artifactIndex = null,
  schemaManifest = null,
  functionManifest = null,
  expectedManifestVersion = 1,
  expectedSchemaVersion = null,
  expectedInputsHash = null,
  expectedSchemaHash = null,
  expectedBundleHash = null,
} = {}) {
  const contractManifest = manifest ?? contractDataManifest;
  const diagnostics = [];
  const diag = (code, message, details = {}) => {
    diagnostics.push(contractDiagnostic(code, message, details));
  };

  if (!contractManifest) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_MANIFEST_MISSING', 'Missing generated Contract data manifest.');
    return diagnostics;
  }

  if (contractManifest.artifactKind !== 'contractDataManifest') {
    diag('SNAPBACK_STALE_CONTRACT_DATA_ARTIFACT_KIND', 'Generated Contract data manifest has the wrong artifact kind.', {
      expectedArtifactKind: 'contractDataManifest',
      actualArtifactKind: contractManifest.artifactKind ?? null,
    });
  }

  if (contractManifest.manifestVersion !== expectedManifestVersion) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_MANIFEST_VERSION', 'Generated Contract data manifest has the wrong manifest version.', {
      expectedManifestVersion,
      actualManifestVersion: contractManifest.manifestVersion ?? null,
    });
  }

  const schemaVersion = expectedSchemaVersion ?? schemaManifest?.schemaVersion ?? artifactIndex?.schemaVersion ?? null;
  if (schemaVersion && contractManifest.schemaVersion !== schemaVersion) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_ARTIFACT_VERSION', 'Generated Contract data manifest schema version does not match the generated Snapback artifacts.', {
      expectedSchemaVersion: schemaVersion,
      actualSchemaVersion: contractManifest.schemaVersion ?? null,
    });
  }

  const inputsHash = expectedInputsHash ?? artifactIndex?.inputsHash ?? schemaManifest?.inputsHash ?? functionManifest?.inputsHash ?? null;
  if (inputsHash && contractManifest.inputsHash !== inputsHash) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH', 'Generated Contract data manifest inputs hash does not match the generated Snapback artifacts.', {
      expectedInputsHash: inputsHash,
      actualInputsHash: contractManifest.inputsHash ?? null,
    });
  }

  const schemaHash = expectedSchemaHash ?? schemaManifest?.schemaHash ?? artifactIndex?.schemaHash ?? null;
  if (schemaHash && contractManifest.schemaHash !== schemaHash) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_SCHEMA_HASH', 'Generated Contract data manifest schema hash does not match the generated schema manifest.', {
      expectedSchemaHash: schemaHash,
      actualSchemaHash: contractManifest.schemaHash ?? null,
    });
  }

  const bundleHash = expectedBundleHash ?? functionManifest?.bundleHash ?? artifactIndex?.bundleHash ?? null;
  if (bundleHash && contractManifest.bundleHash !== bundleHash) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_BUNDLE_HASH', 'Generated Contract data manifest bundle hash does not match the generated function manifest.', {
      expectedBundleHash: bundleHash,
      actualBundleHash: contractManifest.bundleHash ?? null,
    });
  }

  if (artifactIndex?.functions) {
    validateBindingSet(contractManifest, artifactIndex.functions, diag);
  }

  if (artifactIndex?.artifacts) {
    validateDescriptorSet(contractManifest, artifactIndex.artifacts, diag);
  }

  return diagnostics;
}

export async function createSnapbackContractSurface({
  runtime,
  client,
  userId,
  manifest,
  artifactIndex = null,
  schemaManifest = null,
  functionManifest = null,
  queryName = 'listTodos',
  boundaryKey = 'todos',
  queryArgs = {},
  optimisticReducers = defaultOptimisticReducers(),
}) {
  const pending = new Set();
  const diagnostics = validateSnapbackContractArtifacts({
    manifest,
    artifactIndex,
    schemaManifest,
    functionManifest,
  });
  const blockingDiagnostic = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (blockingDiagnostic) {
    const error = new Error(blockingDiagnostic.message);
    error.diagnostic = blockingDiagnostic;
    throw error;
  }
  let optimisticSeq = 0;
  let disposed = false;
  const queryNames = Object.keys(manifest?.queries ?? {});
  const mutationNames = Object.keys(manifest?.mutations ?? {});

  const initial = (await client.query(queryName, { args: queryArgs, userId })).rows;
  const boundary = runtime.createContractMockQueryBoundary({ [boundaryKey]: initial });

  const assertActive = () => {
    if (disposed) {
      throw new Error('Snapback Contract surface was used after dispose().');
    }
  };

  const publishDiagnostic = (code, message, details = {}) => {
    const diagnostic = contractDiagnostic(code, message, details);
    diagnostics.push(diagnostic);
    return diagnostic;
  };

  const reconcile = async () => {
    const rows = (await client.query(queryName, { args: queryArgs, userId })).rows;
    if (!disposed) boundary.write(boundaryKey, () => rows);
    return rows;
  };

  const track = (promise) => {
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
    return promise;
  };

  const persistMutation = async (name, args) => {
    try {
      await client.mutate(name, { args, userId });
      await reconcile();
    } catch (error) {
      publishDiagnostic('SNAPBACK_CONTRACT_MUTATION_FAILED', error instanceof Error ? error.message : String(error), {
        mutation: name,
      });
      await reconcile();
      throw error;
    }
  };

  const links = {};
  for (const name of queryNames) {
    links[name] = (_args) => {
      assertActive();
      return boundary.query(boundaryKey, (rows) => rows, { key: boundaryKey });
    };
  }
  for (const name of mutationNames) {
    links[name] = (args) => {
      assertActive();
      const reducer = optimisticReducers[name];
      if (typeof reducer === 'function') {
        boundary.write(boundaryKey, (rows) =>
          reducer(rows, args, { userId, optimisticId: `optimistic_${++optimisticSeq}` }),
        );
      }
      track(persistMutation(name, args));
    };
  }

  const providerQueries = {};
  for (const name of queryNames) {
    providerQueries[name] = (_args, qb) => qb.query(boundaryKey, (rows) => rows, { key: boundaryKey });
  }
  const providerMutations = {};
  for (const name of mutationNames) {
    providerMutations[name] = async (args, qb) => {
      assertActive();
      await client.mutate(name, { args, userId });
      const rows = await reconcile();
      qb.write(boundaryKey, () => rows);
    };
  }

  const provider = runtime.createBoundaryContractDataProvider(manifest, boundary, {
    queries: providerQueries,
    mutations: providerMutations,
    rowSyncState: async (_table, rowId) => {
      const rows = (await client.query(queryName, { args: queryArgs, userId })).rows;
      const row = rows.find((r) => r._id === rowId);
      return row
        ? { syncedVersion: row._version, approxSyncedAt: null, pendingMutations: false }
        : null;
    },
  });

  return {
    adapterVersion: SNAPBACK_CONTRACT_ADAPTER_VERSION,
    capabilityClass: SNAPBACK_CONTRACT_CAPABILITY_CLASS,
    boundary,
    links,
    provider,
    diagnostics,
    pendingCount: () => pending.size,
    declaredQueries: queryNames,
    declaredMutations: mutationNames,
    flush: async () => {
      await Promise.all([...pending]);
    },
    dispose: () => {
      disposed = true;
      pending.clear();
    },
  };
}

// Shared bridge for Contract system surfaces such as the Snapback admin console.
//
// @ref LLP 0021#phase-4-move-admin-and-demo-surfaces-onto-the-adapter - admin
//   should consume product-shaped adapter code while remaining a system app over
//   the privileged admin API, not an ordinary generated app-table surface.
export async function createSnapbackSystemContractSurface({
  runtime,
  resources,
  commands = {},
  targetSurface = 'Contract/Exact system surface',
} = {}) {
  if (!runtime || typeof runtime.createContractMockQueryBoundary !== 'function') {
    throw new Error('createSnapbackSystemContractSurface requires a Contract runtime.');
  }
  if (!resources || typeof resources !== 'object') {
    throw new Error('createSnapbackSystemContractSurface requires resource definitions.');
  }

  const diagnostics = [];
  const pending = new Set();
  let disposed = false;
  const initialRows = {};

  for (const [name, resource] of Object.entries(resources)) {
    const definition = normalizeResourceDefinition(name, resource);
    initialRows[definition.key] = toBoundaryRows(await resolveInitialRows(definition), definition.key);
  }

  const boundary = runtime.createContractMockQueryBoundary(initialRows);

  const assertActive = () => {
    if (disposed) {
      throw new Error('Snapback Contract system surface was used after dispose().');
    }
  };

  const queryRows = (key) => {
    assertActive();
    return boundary.query(key, (rows) => rows, { key });
  };

  const publish = (key, rows) => {
    if (disposed) return [];
    const nextRows = toBoundaryRows(rows, key);
    boundary.write(key, () => nextRows);
    return nextRows;
  };

  const publishOne = (key, row) => publish(key, [row]);

  const addDiagnostic = (code, message, details = {}) => {
    const diagnostic = contractDiagnostic(code, message, {
      target_surface: targetSurface,
      ...details,
    });
    diagnostics.push(diagnostic);
    return diagnostic;
  };

  const track = (promise) => {
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
    return promise;
  };

  const context = {
    boundary,
    diagnostics,
    addDiagnostic,
    publish,
    publishOne,
    queryRows,
    targetSurface,
  };

  const links = {};
  for (const [name, resource] of Object.entries(resources)) {
    const definition = normalizeResourceDefinition(name, resource);
    links[definition.binding] = (_args) => queryRows(definition.key);
  }
  for (const [name, command] of Object.entries(commands)) {
    const run = typeof command === 'function' ? command : command?.run;
    if (typeof run !== 'function') {
      throw new Error(`System Contract command "${name}" must be a function.`);
    }
    links[name] = (args = {}) => {
      assertActive();
      const promise = Promise.resolve().then(() => run(args, context));
      return command?.track === false ? promise : track(promise);
    };
  }

  return {
    adapterVersion: SNAPBACK_CONTRACT_ADAPTER_VERSION,
    capabilityClass: SNAPBACK_CONTRACT_CAPABILITY_CLASS,
    targetSurface,
    boundary,
    links,
    diagnostics,
    publish,
    publishOne,
    queryRows,
    pendingCount: () => pending.size,
    flush: async () => {
      await Promise.all([...pending]);
    },
    dispose: () => {
      disposed = true;
      pending.clear();
    },
  };
}

function contractDiagnostic(code, message, details = {}) {
  return {
    code,
    severity: 'error',
    subsystem: 'contract-integration',
    message,
    details: {
      target_surface: 'Contract/Exact',
      ...details,
    },
  };
}

function normalizeResourceDefinition(name, resource) {
  if (typeof resource === 'function') {
    return { key: name, binding: name, initial: resource };
  }
  if (resource && typeof resource === 'object') {
    return {
      key: resource.key ?? name,
      binding: resource.binding ?? name,
      initial: resource.initial,
    };
  }
  return { key: name, binding: name, initial: resource };
}

async function resolveInitialRows(resource) {
  return typeof resource.initial === 'function' ? resource.initial() : resource.initial;
}

function toBoundaryRows(value, key) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) {
    throw new Error(`System Contract resource "${key}" resolved no row data.`);
  }
  return [value];
}

function validateBindingSet(manifest, functions, diag) {
  const queries = manifest.queries ?? {};
  const mutations = manifest.mutations ?? {};
  const expectedQueryNames = new Set();
  const expectedMutationNames = new Set();

  for (const fn of functions) {
    if (fn.kind === 'Mutation') expectedMutationNames.add(fn.name);
    else expectedQueryNames.add(fn.name);
  }

  for (const name of expectedQueryNames) {
    if (!queries[name]) {
      diag('SNAPBACK_STALE_CONTRACT_DATA_BINDINGS', 'Generated Contract data manifest is missing a query binding declared by the function manifest.', {
        binding: name,
        bindingKind: 'query',
      });
    }
  }
  for (const name of expectedMutationNames) {
    if (!mutations[name]) {
      diag('SNAPBACK_STALE_CONTRACT_DATA_BINDINGS', 'Generated Contract data manifest is missing a mutation binding declared by the function manifest.', {
        binding: name,
        bindingKind: 'mutation',
      });
    }
  }
  for (const name of Object.keys(queries)) {
    if (!expectedQueryNames.has(name)) {
      diag('SNAPBACK_STALE_CONTRACT_DATA_BINDINGS', 'Generated Contract data manifest has a query binding not declared by the function manifest.', {
        binding: name,
        bindingKind: 'query',
      });
    }
  }
  for (const name of Object.keys(mutations)) {
    if (!expectedMutationNames.has(name)) {
      diag('SNAPBACK_STALE_CONTRACT_DATA_BINDINGS', 'Generated Contract data manifest has a mutation binding not declared by the function manifest.', {
        binding: name,
        bindingKind: 'mutation',
      });
    }
  }
}

function validateDescriptorSet(manifest, artifacts, diag) {
  const artifactSet = new Set(artifacts);
  for (const name of Object.keys(manifest.queries ?? {})) {
    for (const file of [`contract/${name}.query.ts`, `contract/${name}.query.contract-meta.ts`]) {
      if (!artifactSet.has(file)) {
        diag('SNAPBACK_STALE_CONTRACT_DESCRIPTOR_SET', 'Generated Contract descriptor artifact is missing from the artifact index.', {
          binding: name,
          bindingKind: 'query',
          artifact: file,
        });
      }
    }
  }
  for (const name of Object.keys(manifest.mutations ?? {})) {
    for (const file of [`contract/${name}.mutation.ts`, `contract/${name}.mutation.contract-meta.ts`]) {
      if (!artifactSet.has(file)) {
        diag('SNAPBACK_STALE_CONTRACT_DESCRIPTOR_SET', 'Generated Contract descriptor artifact is missing from the artifact index.', {
          binding: name,
          bindingKind: 'mutation',
          artifact: file,
        });
      }
    }
  }
}

function defaultOptimisticReducers() {
  return {
    createTodo: (rows, args, { userId, optimisticId }) => [
      ...rows,
      {
        completed: false,
        userId,
        ...args,
        _id: optimisticId,
        optimistic: true,
      },
    ],
    setCompleted: (rows, args) =>
      rows.map((row) => row._id === args.id ? { ...row, completed: args.completed } : row),
    setPriority: (rows, args) =>
      rows.map((row) => row._id === args.id ? { ...row, priority: args.priority } : row),
    editTitle: (rows, args) =>
      rows.map((row) => row._id === args.id ? { ...row, title: args.title } : row),
    deleteTodo: (rows, args) => rows.filter((row) => row._id !== args.id),
  };
}

// Capability-scoped Online Contract surface for the published Exact v0
// runtime. This is the package-owned form of legacy boot-scoped multi-live
// mode: query scopes are fixed at construction, live updates feed one Exact
// boundary, and mutations remain server-authoritative. Coordinated authority,
// retained/offline state, ephemeral maps, and optimistic overlays belong to
// the full surface in index.mjs.
//
// @ref LLP 0034#dynamic-keyed-query-scopes — this compatibility surface is
//   explicitly boot-scoped; runtimes with partition rotation should use the
//   keyed provider for binding-time scope identity.
// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — Online-only
//   consumers do not retain unrelated Contract capabilities.

import { validateSnapbackContractArtifacts } from './artifact-validation.mjs';
import { createSnapbackProviderDiagnostic } from './diagnostics.mjs';

function randomRootId() {
  const value = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `snapback-online-surface:${value}`;
}

function diagnostic(code, message, details = {}) {
  const {
    severity = 'error',
    owner = 'provider',
    queryName = details.query,
    mutationName = details.mutation,
    ...providerDetails
  } = details;
  return createSnapbackProviderDiagnostic(code, message, {
    severity,
    owner,
    queryName,
    mutationName,
    details: providerDetails,
  });
}

function diagnosticError(value) {
  const error = new Error(`${value.code}: ${value.message}`);
  error.code = value.code;
  error.diagnostic = value;
  return error;
}

function canonicalArgs(value) {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(
        Object.keys(entry).sort().map((key) => [key, normalize(entry[key])]),
      );
    }
    return entry;
  };
  return JSON.stringify(normalize(value ?? {}));
}

function normalizeEntries(manifest, liveQueries) {
  if (!Array.isArray(liveQueries) || liveQueries.length === 0) {
    throw diagnosticError(diagnostic(
      'SNAPBACK_CONTRACT_ONLINE_QUERIES_REQUIRED',
      'the Online Contract surface requires at least one configured live query',
    ));
  }
  const entries = liveQueries.map((entry) => (
    typeof entry === 'string'
      ? { name: entry, args: {} }
      : { name: entry?.name, args: entry?.args ?? {} }
  ));
  const invalid = entries.filter(({ name }) => (
    typeof name !== 'string'
    || manifest?.queries?.[name] == null
    || manifest.queries[name]?.ephemeral === true
  ));
  if (invalid.length > 0) {
    throw diagnosticError(diagnostic(
      'SNAPBACK_CONTRACT_QUERY_UNKNOWN',
      `Online liveQueries names unknown or non-durable queries: ${invalid.map(({ name }) => String(name)).join(', ')}`,
      { queries: invalid.map(({ name }) => name) },
    ));
  }
  const names = entries.map(({ name }) => name);
  const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
  if (duplicates.length > 0) {
    throw diagnosticError(diagnostic(
      'SNAPBACK_CONTRACT_LIVEQUERY_DUPLICATE',
      `Online liveQueries names each query once; duplicates: ${duplicates.join(', ')}`,
      { queries: duplicates },
    ));
  }
  return entries;
}

function assertRequiredQueries(manifest, entries, requiredQueries) {
  if (requiredQueries === null) return;
  if (!Array.isArray(requiredQueries)) {
    throw new TypeError('requiredQueries must be an array when provided');
  }
  const configured = new Set(entries.map(({ name }) => name));
  const names = requiredQueries.map((entry) => typeof entry === 'string' ? entry : entry?.name);
  const unknown = names.filter((name) => typeof name !== 'string' || !manifest?.queries?.[name]);
  if (unknown.length > 0) {
    throw diagnosticError(diagnostic(
      'SNAPBACK_CONTRACT_REQUIRED_QUERY_UNKNOWN',
      `requiredQueries names unknown manifest queries: ${unknown.join(', ')}`,
      { queries: unknown },
    ));
  }
  const missing = names.filter((name) => !configured.has(name));
  if (missing.length > 0) {
    throw diagnosticError(diagnostic(
      'SNAPBACK_CONTRACT_QUERY_UNCONFIGURED',
      `required Contract queries are omitted from Online liveQueries: ${missing.join(', ')}`,
      { queries: missing, configuredQueries: [...configured] },
    ));
  }
}

/**
 * Create a small server-authoritative Online surface over fixed boot scopes.
 * Use createKeyedSnapbackContractProvider when the Exact runtime exposes
 * rotatePartition and binding-time keyed query identity. Use the full root
 * surface for any coordinated authority or retained/offline capability.
 */
export async function createOnlineSnapbackContractSurface({
  runtime,
  client,
  manifest,
  artifactIndex = null,
  schemaManifest = null,
  functionManifest = null,
  userId,
  liveQueries,
  requiredQueries = null,
  livePush = true,
  liveFallbackToPoll = true,
  connectionId = null,
  liveStreamOptions = {},
  onConnectionChange = null,
  onSubscriptionEvent = null,
  rootId = randomRootId(),
} = {}) {
  for (const method of [
    'createContractMockQueryBoundary',
    'createBoundaryContractDataProvider',
    'createProviderQueryHandle',
  ]) {
    if (typeof runtime?.[method] !== 'function') {
      throw diagnosticError(diagnostic(
        'SNAPBACK_CONTRACT_ONLINE_RUNTIME_REQUIRED',
        `the Online Contract surface requires an Exact runtime with ${method}()`,
      ));
    }
  }
  if (client?.authorityFence || client?.authCoordinator || client?.agentAuthority) {
    throw diagnosticError(diagnostic(
      'SNAPBACK_CONTRACT_ONLINE_AUTH_UNSUPPORTED',
      'coordinated authority requires createSnapbackContractSurface',
    ));
  }

  const diagnostics = validateSnapbackContractArtifacts({
    manifest,
    artifactIndex,
    schemaManifest,
    functionManifest,
  });
  const blocking = diagnostics.find((entry) => entry.severity === 'error');
  if (blocking) throw diagnosticError(blocking);

  const entries = normalizeEntries(manifest, liveQueries);
  assertRequiredQueries(manifest, entries, requiredQueries);
  const configured = new Map(entries.map((entry) => [entry.name, entry]));
  const wantLivePush = livePush && typeof client?.liveQuery === 'function';
  if (wantLivePush) {
    const notLive = entries.filter(({ name }) => {
      const descriptor = manifest.queries[name] ?? {};
      return descriptor.livePush === false || descriptor.mode === 'snapshot';
    });
    if (notLive.length > 0) {
      throw diagnosticError(diagnostic(
        'SNAPBACK_CONTRACT_LIVEQUERY_NOT_LIVE',
        `Online liveQueries configures non-live queries: ${notLive.map(({ name }) => name).join(', ')}`,
        { queries: notLive.map(({ name }) => name) },
      ));
    }
  }

  const handles = new Map();
  const connections = new Map();
  const latestRows = new Map();
  const observerRecords = new Map(entries.map(({ name }) => [name, new Set()]));
  const pending = new Set();
  const mismatchSeen = new Set();
  let boundary = null;
  let disposed = false;

  const assertActive = () => {
    if (disposed) {
      throw diagnosticError(diagnostic(
        'SNAPBACK_CONTRACT_ONLINE_SURFACE_DISPOSED',
        'the Online Contract surface was used after dispose()',
      ));
    }
  };
  const connectionFor = (name) => wantLivePush ? connections.get(name) ?? 'connecting' : null;
  const decorateCell = (name, cell) => {
    // @ref LLP 0034#23-connection-axis-mapping-kit-derived-policy-over-d0-signals —
    // this adapter owns the live transport axis. Exact can seed a ready
    // boundary cell with `connecting`, but a connection-only transition must
    // replace that seed even when the authoritative rows do not change.
    if (wantLivePush && cell?.status === 'ready') {
      return { ...cell, connection: connectionFor(name) };
    }
    return Object.hasOwn(cell ?? {}, 'connection')
      ? cell
      : { ...cell, connection: connectionFor(name) };
  };
  const reemitConnection = (name) => {
    for (const record of observerRecords.get(name) ?? []) {
      if (record.lastCell !== null) record.observer(decorateCell(name, record.lastCell));
    }
  };
  const track = (value) => {
    const task = Promise.resolve(value);
    pending.add(task);
    task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
  };

  const open = async ({ name, args }) => {
    if (!wantLivePush) {
      const snapshot = await client.query(name, { args, userId });
      latestRows.set(name, snapshot.rows ?? []);
      connections.set(name, null);
      return;
    }
    const handle = await client.liveQuery(name, {
      args,
      userId,
      connectionId: connectionId ?? rootId,
      transport: 'stream',
      fallbackToPoll: liveFallbackToPoll,
      stream: liveStreamOptions,
      correlation: { rootId, bindingIds: [name] },
      onUpdate(rows) {
        if (disposed) return;
        latestRows.set(name, rows);
        if (boundary) boundary.write(name, () => rows);
      },
      onConnectionChange(connection, detail) {
        if (disposed) return;
        connections.set(name, connection);
        reemitConnection(name);
        try { onConnectionChange?.(connection, { ...detail, queryName: name, args }); } catch { /* observational */ }
      },
      onSubscriptionEvent: onSubscriptionEvent
        ? (event) => {
            if (disposed) return;
            try { onSubscriptionEvent({ ...event, queryName: name, args }); } catch { /* observational */ }
          }
        : null,
    });
    if (disposed) {
      handle.dispose?.();
      return;
    }
    handles.set(name, handle);
    latestRows.set(name, latestRows.get(name) ?? handle.rows ?? []);
    connections.set(name, handle.connection ?? connections.get(name) ?? 'connecting');
  };

  const opens = entries.map((entry) => open(entry));
  try {
    await Promise.all(opens);
  } catch (error) {
    disposed = true;
    for (const opened of opens) {
      void opened.then(() => {}).catch(() => {});
    }
    for (const handle of handles.values()) handle.dispose?.();
    handles.clear();
    throw error;
  }

  const initialRows = Object.fromEntries(entries.map(({ name }) => [name, latestRows.get(name) ?? []]));
  boundary = runtime.createContractMockQueryBoundary(initialRows);

  const publishDiagnostic = (value) => {
    diagnostics.push(value);
    return value;
  };
  const reconcile = async () => {
    for (const { name, args } of entries) {
      const snapshot = await client.query(name, { args, userId });
      latestRows.set(name, snapshot.rows ?? []);
      if (!disposed) boundary.write(name, () => latestRows.get(name));
    }
  };
  const persistMutation = async (name, args) => {
    assertActive();
    try {
      const output = await client.mutate(name, {
        args: args ?? {},
        userId,
        correlation: { rootId, bindingIds: entries.map((entry) => entry.name) },
      });
      if (!wantLivePush) await reconcile();
      return output;
    } catch (error) {
      publishDiagnostic(diagnostic(
        'SNAPBACK_CONTRACT_MUTATION_FAILED',
        error instanceof Error ? error.message : String(error),
        { mutation: name, args },
      ));
      throw error;
    }
  };

  const providerQueries = Object.fromEntries(entries.map(({ name }) => [
    name,
    (_args, queryBoundary) => queryBoundary.query(name, (rows) => rows, { key: name }),
  ]));
  const providerMutations = Object.fromEntries(
    Object.keys(manifest?.mutations ?? {}).map((name) => [
      name,
      (args) => track(persistMutation(name, args)),
    ]),
  );
  const baseProvider = runtime.createBoundaryContractDataProvider(manifest, boundary, {
    queries: providerQueries,
    mutations: providerMutations,
  });
  const provider = {
    ...baseProvider,
    subscribe(name, args, observer) {
      assertActive();
      const configuredEntry = configured.get(name);
      if (!configuredEntry) {
        const value = publishDiagnostic(diagnostic(
          'SNAPBACK_CONTRACT_QUERY_UNCONFIGURED',
          `query binding "${name}" is omitted from this Online surface's liveQueries`,
          { query: name, configuredQueries: [...configured.keys()] },
        ));
        observer({ status: 'error', rows: [], value: [], connection: null, diagnostic: value });
        return { dispose() {} };
      }
      const bindingKey = canonicalArgs(args);
      if (bindingKey !== canonicalArgs(configuredEntry.args)) {
        const mismatchKey = `${name}\u0000${bindingKey}`;
        if (!mismatchSeen.has(mismatchKey)) {
          mismatchSeen.add(mismatchKey);
          publishDiagnostic(diagnostic(
            'SNAPBACK_CONTRACT_LIVEQUERY_ARGS_MISMATCH',
            `query binding "${name}" differs from its boot-scoped Online configuration`,
            { query: name, bindingArgs: args ?? {}, configuredArgs: configuredEntry.args },
          ));
        }
      }
      const records = observerRecords.get(name);
      const record = { observer, lastCell: null };
      records.add(record);
      const subscription = baseProvider.subscribe(name, args, (cell) => {
        if (disposed) return;
        record.lastCell = cell;
        observer(decorateCell(name, cell));
      });
      return {
        dispose() {
          records.delete(record);
          subscription.dispose();
        },
      };
    },
  };

  const links = {};
  for (const name of Object.keys(manifest?.queries ?? {})) {
    if (manifest.queries[name]?.ephemeral === true) continue;
    links[name] = (args = {}) => {
      assertActive();
      return runtime.createProviderQueryHandle(provider, name, args ?? {});
    };
  }
  for (const name of Object.keys(manifest?.mutations ?? {})) {
    links[name] = (args = {}) => track(persistMutation(name, args));
  }

  return Object.freeze({
    adapterVersion: 1,
    capabilityClass: 'Online',
    boundary,
    provider,
    links: Object.freeze(links),
    diagnostics,
    livePush: wantLivePush,
    liveQueries: Object.freeze(entries.map(({ name }) => name)),
    rootId,
    connection: (name = entries[0].name) => connectionFor(name),
    connections: () => Object.fromEntries(entries.map(({ name }) => [name, connectionFor(name)])),
    pendingCount: () => pending.size,
    flush: async () => Promise.all([...pending]),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const handle of handles.values()) handle.dispose?.();
      handles.clear();
      observerRecords.clear();
      pending.clear();
    },
  });
}

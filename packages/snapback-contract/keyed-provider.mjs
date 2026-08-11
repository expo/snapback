// Dynamic Snapback Contract provider.
//
// Exact owns logical identity, same-key deduplication, binding refcounts, and
// predecessor fencing. This module owns only the Snapback transport attempt
// behind one logical Exact subscription. Binding arguments therefore reach
// the server unchanged, and two scopes of one descriptor can coexist.
//
// @ref LLP 0034#dynamic-keyed-query-scopes — binding-time arguments select the
//   physical Snapback subscription; boot configuration is an allowlist, not a
//   singleton scope.
// @ref LLP 0053#client-fences — authority changes rotate Exact's opaque
//   partition before any successor result can publish.

import {
  createSnapbackProviderDiagnostic,
  createSnapbackProviderDiagnosticCollector,
  createSnapbackProviderDiagnosticError,
} from './diagnostics.mjs';
import { validateSnapbackContractArtifacts } from './artifact-validation.mjs';
import { normalizeContractMutationOutput } from './mutation-output.mjs';

function randomOpaqueId() {
  const value = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `snapback-query-partition:${value}`;
}

function serializedError(error) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    ...(error?.code ? { code: error.code } : {}),
    ...(error?.diagnostic ? { diagnostic: error.diagnostic } : {}),
  };
}

function providerDiagnostic(code, message, details = {}) {
  const {
    severity = 'error',
    provider = 'snapback',
    owner = 'provider',
    source,
    queryName = details.query,
    mutationName = details.mutation,
    table,
    suggestedFix,
    targetSurface = 'Contract/Exact',
    ...providerDetails
  } = details;
  return createSnapbackProviderDiagnostic(code, message, {
    severity,
    provider,
    owner,
    source,
    queryName,
    mutationName,
    table,
    suggestedFix,
    targetSurface,
    details: providerDetails,
  });
}

function diagnosticError(code, message, details = {}) {
  const diagnostic = providerDiagnostic(code, message, details);
  return createSnapbackProviderDiagnosticError(code, message, {
    severity: diagnostic.severity,
    provider: diagnostic.provider,
    owner: diagnostic.owner,
    source: diagnostic.source,
    queryName: diagnostic.queryName,
    mutationName: diagnostic.mutationName,
    table: diagnostic.table,
    suggestedFix: diagnostic.suggestedFix,
    targetSurface: diagnostic.details.target_surface,
    details: diagnostic.details,
  });
}

function readyCell(rows, connection = null) {
  return {
    status: 'ready',
    value: rows,
    rows,
    empty: Array.isArray(rows) && rows.length === 0,
    connection,
  };
}

function pendingCell(connection = 'connecting') {
  return { status: 'pending', connection };
}

function errorCell(error, previous, connection = 'disconnected') {
  return {
    status: 'error',
    error: serializedError(error),
    ...(previous === undefined ? {} : { previous, rows: previous }),
    connection,
    ...(error?.diagnostic ? { diagnostic: error.diagnostic } : {}),
  };
}

function normalizeAllowedQueries(manifest, queries) {
  const names = queries === null
    ? Object.keys(manifest?.queries ?? {}).filter((name) => manifest.queries[name]?.ephemeral !== true)
    : queries.map((entry) => typeof entry === 'string' ? entry : entry?.name);
  const invalid = names.filter((name) => typeof name !== 'string' || !manifest?.queries?.[name]);
  if (invalid.length > 0) {
    throw diagnosticError(
      'SNAPBACK_CONTRACT_QUERY_UNKNOWN',
      `keyedQueries names unknown manifest queries: ${invalid.join(', ')}`,
      { queries: invalid },
    );
  }
  return new Set(names);
}

function normalizeForceScope(scope) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const normalized = {};
      for (const key of Object.keys(value).sort()) normalized[key] = canonical(value[key]);
      return normalized;
    }
    return value;
  };
  try {
    return JSON.stringify(canonical(scope));
  } catch {
    return String(scope);
  }
}

// Exact's force-state contract is deliberately implemented at the provider
// boundary: a force is local-only, suppresses (but remembers) live delivery,
// and can target either every binding of a descriptor or one canonical scope.
// The physical Snapback transport is not allocated when a binding mounts under
// an existing force.
function createQueryForcePlane() {
  const forces = new Map();
  const records = new Map();
  const matches = (force, scopeKey) => force.scopeKey === null || force.scopeKey === scopeKey;
  const activeForceFor = (name, scopeKey) => {
    const list = forces.get(name);
    if (!list) return undefined;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (matches(list[index], scopeKey)) return list[index];
    }
    return undefined;
  };

  return {
    isForced(name, scopeKey) {
      return activeForceFor(name, scopeKey) !== undefined;
    },
    subscribe(name, scopeKey, observer, startLiveImpl) {
      let set = records.get(name);
      if (!set) {
        set = new Set();
        records.set(name, set);
      }
      const record = {
        scopeKey,
        observer,
        liveStarted: false,
        disposeLive: null,
        lastLiveCell: undefined,
        disposed: false,
        startLive: null,
      };
      record.startLive = () => {
        if (record.liveStarted || record.disposed) return;
        record.liveStarted = true;
        startLiveImpl(record);
      };
      set.add(record);

      const force = activeForceFor(name, scopeKey);
      if (force) observer(force.state);
      else record.startLive();

      return {
        dispose() {
          if (record.disposed) return;
          record.disposed = true;
          record.disposeLive?.();
          record.disposeLive = null;
          set.delete(record);
          if (set.size === 0) records.delete(name);
        },
      };
    },
    force(name, state, scopeKey = null) {
      let list = forces.get(name);
      if (!list) {
        list = [];
        forces.set(name, list);
      }
      const entry = { state, scopeKey };
      list.push(entry);
      for (const record of records.get(name) ?? []) {
        if (!record.disposed && matches(entry, record.scopeKey)) record.observer(state);
      }
      return {
        dispose() {
          const index = list.indexOf(entry);
          if (index === -1) return;
          const governed = [...(records.get(name) ?? [])].filter(
            (record) => !record.disposed && activeForceFor(name, record.scopeKey) === entry,
          );
          list.splice(index, 1);
          if (list.length === 0) forces.delete(name);
          for (const record of governed) {
            if (record.disposed) continue;
            const next = activeForceFor(name, record.scopeKey);
            if (next) {
              record.observer(next.state);
            } else if (!record.liveStarted) {
              record.startLive();
            } else if (record.lastLiveCell !== undefined) {
              record.observer(record.lastLiveCell);
            } else {
              record.observer(pendingCell());
            }
          }
        },
      };
    },
    dispose() {
      for (const set of records.values()) {
        for (const record of set) {
          record.disposed = true;
          record.disposeLive?.();
          record.disposeLive = null;
        }
      }
      records.clear();
      forces.clear();
    },
  };
}

/**
 * Create the transport provider consumed by Exact's keyed-query runtime.
 *
 * `keyedQueries` is an allowlist. Its object entries may retain legacy
 * `{name,args}` spelling, but those args are not a boot-time scope and are
 * deliberately ignored: every binding supplies its own authoritative args.
 */
export function createKeyedSnapbackContractProvider({
  runtime,
  client,
  manifest,
  artifactIndex = null,
  schemaManifest = null,
  functionManifest = null,
  userId,
  initialAuthorityCapture = null,
  keyedQueries = null,
  livePush = true,
  liveFallbackToPoll = true,
  connectionId = null,
  liveStreamOptions = {},
  onConnectionChange = null,
  onSubscriptionEvent = null,
  onReceipt = null,
  rootId = randomOpaqueId(),
}) {
  if (typeof runtime?.createProviderQueryHandle !== 'function') {
    throw diagnosticError(
      'SNAPBACK_CONTRACT_KEYED_RUNTIME_REQUIRED',
      'dynamic keyed query scopes require an Exact runtime with createProviderQueryHandle',
    );
  }
  if (typeof runtime?.rotatePartition !== 'function') {
    throw diagnosticError(
      'SNAPBACK_CONTRACT_PARTITION_ROTATION_REQUIRED',
      'dynamic keyed query scopes require an Exact runtime with rotatePartition',
    );
  }
  // A bare Contract conformance manifest has no generated Snapback artifact
  // identity to compare. As soon as the manifest declares that identity, or
  // any companion artifact is supplied, enforce the complete coherence check.
  const hasGeneratedArtifactIdentity = manifest?.artifactKind !== undefined
    || artifactIndex !== null
    || schemaManifest !== null
    || functionManifest !== null;
  const artifactDiagnostics = hasGeneratedArtifactIdentity
    ? validateSnapbackContractArtifacts({
        manifest,
        artifactIndex,
        schemaManifest,
        functionManifest,
      })
    : [];
  const blockingArtifactDiagnostic = artifactDiagnostics.find(
    (diagnostic) => diagnostic.severity === 'error',
  );
  if (blockingArtifactDiagnostic) {
    const error = new Error(blockingArtifactDiagnostic.message);
    error.code = blockingArtifactDiagnostic.code;
    error.diagnostic = blockingArtifactDiagnostic;
    throw error;
  }
  const allowedQueries = normalizeAllowedQueries(manifest, keyedQueries);
  const active = new Set();
  const diagnosticCollector = createSnapbackProviderDiagnosticCollector({ rootId });
  for (const diagnostic of artifactDiagnostics) diagnosticCollector.record(diagnostic);
  const diagnostics = diagnosticCollector.diagnostics();
  const queryPlane = createQueryForcePlane();
  let disposed = false;
  let activeUserId = userId;
  let authorityCapture = initialAuthorityCapture;
  let partition = randomOpaqueId();
  let subscriptionSequence = 0;
  let authorityPaused = false;

  const recordDiagnostic = (error, identity = {}) => {
    diagnosticCollector.record(error, identity);
    return error;
  };
  const assertActive = () => {
    if (disposed) {
      throw recordDiagnostic(diagnosticError(
        'SNAPBACK_CONTRACT_KEYED_PROVIDER_DISPOSED',
        'the dynamic keyed Contract provider has been disposed',
      ));
    }
  };

  const detachReceipt = typeof client?.onReceipt === 'function' && onReceipt
    ? client.onReceipt((receipt) => onReceipt(receipt))
    : null;

  const provider = {
    manifest,
    partitionId() {
      return partition;
    },
    subscribe(queryName, args, observer) {
      assertActive();
      if (!allowedQueries.has(queryName)) {
        const error = recordDiagnostic(diagnosticError(
          'SNAPBACK_CONTRACT_QUERY_UNCONFIGURED',
          `query binding "${queryName}" is not present in keyedQueries`,
          { query: queryName, configuredQueries: [...allowedQueries] },
        ));
        observer(errorCell(error, undefined, null));
        return { dispose() {} };
      }

      const scopeKey = normalizeForceScope(args ?? {});
      return queryPlane.subscribe(queryName, scopeKey, observer, (forceRecord) => {
        const descriptor = manifest.queries[queryName] ?? {};
        const sequence = ++subscriptionSequence;
        const record = {
          disposed: false,
          sequence,
          upstream: null,
          previous: undefined,
          connection: livePush ? 'connecting' : null,
          open: null,
        };
        active.add(record);
        const current = () => !disposed && !record.disposed && record.sequence === sequence;
        const publish = (cell) => {
          if (!current()) return;
          forceRecord.lastLiveCell = cell;
          if (!queryPlane.isForced(queryName, scopeKey)) forceRecord.observer(cell);
        };
        publish(pendingCell(record.connection));

        const open = async () => {
          try {
            if (livePush && typeof client.liveQuery === 'function') {
              if (descriptor.livePush === false || descriptor.mode === 'snapshot') {
                throw diagnosticError(
                  'SNAPBACK_CONTRACT_LIVEQUERY_NOT_LIVE',
                  `query binding "${queryName}" is not declared live`,
                  {
                    provider: manifest?.provider ?? 'snapback',
                    owner: 'generated',
                    queryName,
                    source: descriptor.source,
                    query: queryName,
                  },
                );
              }
              const handle = await client.liveQuery(queryName, {
                args: args ?? {},
                userId: activeUserId,
                authorityCapture,
                connectionId: connectionId ?? rootId,
                transport: 'stream',
                fallbackToPoll: liveFallbackToPoll,
                stream: liveStreamOptions,
                correlation: { rootId, bindingIds: [queryName] },
                onUpdate(rows) {
                  if (!current()) return;
                  record.previous = rows;
                  publish(readyCell(rows, record.connection));
                },
                onConnectionChange(connection, detail) {
                  if (!current()) return;
                  record.connection = connection;
                  if (record.previous !== undefined) publish(readyCell(record.previous, connection));
                  try { onConnectionChange?.(connection, { ...detail, queryName, args }); } catch { /* isolate app observers */ }
                },
                onSubscriptionEvent: onSubscriptionEvent
                  ? (event) => {
                      if (!current()) return;
                      try { onSubscriptionEvent({ ...event, queryName, args }); } catch { /* isolate app observers */ }
                    }
                  : null,
              });
              if (!current()) {
                handle.dispose?.();
                return;
              }
              record.upstream = handle;
              record.connection = handle.connection ?? record.connection;
              record.previous = handle.rows ?? [];
              publish(readyCell(record.previous, record.connection));
              return;
            }

            if (typeof client.query !== 'function') {
              throw diagnosticError(
                'SNAPBACK_CONTRACT_QUERY_TRANSPORT_REQUIRED',
                'the Snapback client supplies neither liveQuery() nor query()',
                { query: queryName },
              );
            }
            const snapshot = await client.query(queryName, {
              args: args ?? {},
              userId: activeUserId,
              authorityCapture,
            });
            if (!current()) return;
            record.previous = snapshot.rows ?? [];
            record.connection = null;
            publish(readyCell(record.previous, null));
          } catch (error) {
            if (!current()) return;
            recordDiagnostic(error, {
              instanceId: `${rootId}:query:${queryName}:${sequence}`,
              causeCode: error?.code ?? error?.diagnostic?.code,
            });
            publish(errorCell(error, record.previous, record.connection));
          }
        };
        record.open = open;
        forceRecord.disposeLive = () => {
          if (record.disposed) return;
          record.disposed = true;
          active.delete(record);
          record.upstream?.dispose?.();
          record.upstream = null;
        };
        if (!authorityPaused) void open();
      });
    },
    forceQueryState(queryName, state, options = undefined) {
      assertActive();
      return queryPlane.force(
        queryName,
        state,
        options?.scope ? normalizeForceScope(options.scope) : null,
      );
    },
    async mutate(mutationName, args, correlation) {
      assertActive();
      if (authorityPaused) {
        return {
          ok: false,
          error: serializedError(diagnosticError(
            'SNAPBACK_CLIENT_AUTHORITY_STALE',
            'the keyed Contract provider is quiesced for an authority transition',
          )),
        };
      }
      try {
        const value = await client.mutate(mutationName, {
          args: args ?? {},
          userId: activeUserId,
          queue: false,
          authorityCapture,
          correlation: { rootId, ...(correlation ?? {}) },
        });
        return { ok: true, value: normalizeContractMutationOutput(value) };
      } catch (error) {
        recordDiagnostic(error, {
          instanceId: `${rootId}:mutation:${mutationName}`,
          causeCode: error?.code ?? error?.diagnostic?.code,
        });
        return { ok: false, error: serializedError(error) };
      }
    },
    ...(typeof client?.onReceipt === 'function'
      ? { onReceipt(listener) { return client.onReceipt(listener); } }
      : {}),
    ...(typeof client?.receipts === 'function'
      ? { receipts() { return client.receipts(); } }
      : {}),
  };

  const links = {};
  for (const name of Object.keys(manifest?.queries ?? {})) {
    if (manifest.queries[name]?.ephemeral === true) continue;
    links[name] = (args = {}) => runtime.createProviderQueryHandle(provider, name, args ?? {});
  }
  for (const name of Object.keys(manifest?.mutations ?? {})) {
    links[name] = runtime.createProviderMutation
      ? runtime.createProviderMutation(provider, name)
      : (args = {}) => provider.mutate(name, args);
  }

  return Object.freeze({
    provider,
    links: Object.freeze(links),
    diagnostics,
    get userId() { return activeUserId; },
    get disposed() { return disposed; },
    get authorityPaused() { return authorityPaused; },
    /**
     * Rotate before successor work is allowed. Exact synchronously fences the
     * predecessor logical entries and reopens active bindings under the new
     * opaque partition.
     */
    rotateAuthority(next = {}) {
      this.quiesceAuthority();
      return this.resumeAuthority(next);
    },
    quiesceAuthority() {
      assertActive();
      authorityPaused = true;
      partition = randomOpaqueId();
      return runtime.rotatePartition(provider);
    },
    resumeAuthority(next = {}) {
      assertActive();
      if (Object.hasOwn(next, 'userId')) activeUserId = next.userId;
      if (Object.hasOwn(next, 'authorityCapture')) authorityCapture = next.authorityCapture;
      authorityPaused = false;
      for (const record of active) {
        if (!record.disposed && record.upstream === null) void record.open();
      }
      return provider.partitionId();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      detachReceipt?.();
      queryPlane.dispose();
      active.clear();
    },
  });
}

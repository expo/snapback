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
  const allowedQueries = normalizeAllowedQueries(manifest, keyedQueries);
  const active = new Set();
  const diagnosticCollector = createSnapbackProviderDiagnosticCollector({ rootId });
  const diagnostics = diagnosticCollector.diagnostics();
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
        if (current()) observer(cell);
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
                if (record.previous !== undefined) {
                  publish(readyCell(record.previous, connection));
                }
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
      if (!authorityPaused) void open();

      return {
        dispose() {
          if (record.disposed) return;
          record.disposed = true;
          active.delete(record);
          record.upstream?.dispose?.();
          record.upstream = null;
        },
      };
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
          authorityCapture,
          correlation: { rootId, ...(correlation ?? {}) },
        });
        return { ok: true, value };
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
      for (const record of [...active]) {
        record.disposed = true;
        record.upstream?.dispose?.();
        record.upstream = null;
      }
      active.clear();
    },
  });
}

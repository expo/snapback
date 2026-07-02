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

// Contract data manifest versions this adapter accepts. v2 (LLP 0034 D3) is an
// additive extension of v1 per Exact LLP 0284 §2.4: old fields remain valid
// inputs, so v1 manifests keep working unmodified.
export const SUPPORTED_CONTRACT_DATA_MANIFEST_VERSIONS = [1, 2];

export function mountSnapbackContractHeadless(runtime, component, options = {}) {
  if (!runtime || typeof runtime.mount !== 'function') {
    throw new Error('mountSnapbackContractHeadless requires a Contract runtime with mount().');
  }
  if (!component) {
    throw new Error('mountSnapbackContractHeadless requires a compiled Contract component.');
  }
  const mountOptions = normalizeContractMountOptions(options);
  return wrapMountHandle(runtime.mount(component, mountOptions), { runtime, mountOptions });
}

export function validateSnapbackContractArtifacts({
  manifest,
  contractDataManifest,
  artifactIndex = null,
  schemaManifest = null,
  functionManifest = null,
  expectedManifestVersion = null,
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

  const acceptedManifestVersions = expectedManifestVersion === null
    ? SUPPORTED_CONTRACT_DATA_MANIFEST_VERSIONS
    : [expectedManifestVersion];
  if (!acceptedManifestVersions.includes(contractManifest.manifestVersion)) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_MANIFEST_VERSION', 'Generated Contract data manifest has the wrong manifest version.', {
      expectedManifestVersion: acceptedManifestVersions.length === 1 ? acceptedManifestVersions[0] : acceptedManifestVersions,
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
  // LLP 0034 D1 (Exact LLP 0284 §2.3): live descriptors bind with server push
  // by default; `livePush: false` opts the surface out (poll/reconcile only).
  livePush = true,
  connectionId = null,
  liveStreamOptions = {},
  onConnectionChange = null,
  onSubscriptionEvent = null,
  // Receipt stitching (LLP 0034 §3.2 / ENG-22478): the adapter owns the
  // Exact-runtime join keys. rootId identifies this mounted surface;
  // actionInvocationId / optimisticWaveId are supplied per-mutation once the
  // Exact LLP 0231 action log / LLP 0278 wave integration lands (TODO seam —
  // pass them via the correlation the runtime provides at that point).
  rootId = null,
  onReceipt = null,
  // Ephemeral wiring (ENG-22479): permissions per collection+scope, and the
  // zero-scope prewarm keeps the conformance gate's synchronous-snapshot
  // expectation honest.
  ephemeralPermissions = null,
  ephemeralIdleLingerMs = EPHEMERAL_IDLE_LINGER_MS,
  // Multi-query mode (LLP 0034 §6 ownership row 3 — the All Aboard proof):
  // name the manifest's live queries to bind each over the shared stream with
  // its own boundary key and per-query connection axis. Legacy single-query
  // options (queryName/boundaryKey/queryArgs/optimisticReducers) do not apply.
  liveQueries = null,
}) {
  const pending = new Set();
  const mountedHandles = new Set();
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
  const surfaceRootId = rootId ?? defaultContractRootId();
  const detachReceiptListener = onReceipt && typeof client.onReceipt === 'function'
    ? client.onReceipt(onReceipt)
    : null;
  if (Array.isArray(liveQueries)) {
    return createMultiLiveContractSurface({
      runtime,
      client,
      userId,
      manifest,
      liveQueries,
      livePush,
      connectionId,
      liveStreamOptions,
      onConnectionChange,
      onSubscriptionEvent,
      rootId: surfaceRootId,
      detachReceiptListener,
      ephemeralPermissions,
      ephemeralIdleLingerMs,
      diagnostics,
      pending,
      mountedHandles,
    });
  }
  // The adapter-stitched correlation (LLP 0034 §3.2): echoed verbatim on
  // every receipt this surface's operations produce.
  const surfaceCorrelation = { rootId: surfaceRootId, bindingIds: [boundaryKey] };
  let optimisticSeq = 0;
  let disposed = false;
  const queryNames = Object.keys(manifest?.queries ?? {});
  const mutationNames = Object.keys(manifest?.mutations ?? {});

  // The C1 fix (LLP 0034 D1; Exact LLP 0284 §5.3): when the bound descriptor
  // is live (manifest v2 `mode`/`defaultLive`, or the legacy `subscription`
  // field), the surface subscribes over the kit's stream transport and pushes
  // server-authored rows into the Contract boundary as they arrive — no
  // app-code pump. The initial rows come from the same snapshot-with-subscribe
  // operation, so there is no prime race. Non-live descriptors keep the
  // pre-D1 behavior: one snapshot read plus reconcile-on-mutate.
  const boundDescriptor = manifest?.queries?.[queryName] ?? null;
  const descriptorIsLive = Boolean(
    boundDescriptor
      && (boundDescriptor.mode === 'live' || boundDescriptor.subscription === 'initial-snapshot')
      && boundDescriptor.defaultLive !== false,
  );
  const wantLivePush = livePush && descriptorIsLive && typeof client.liveQuery === 'function';

  let boundary = null;
  let liveHandle = null;
  const liveCellObservers = new Set();
  const surfaceConnectionId = connectionId ?? defaultContractConnectionId();
  const ephemeralWiring = buildEphemeralWiring({
    client,
    manifest,
    connectionId: surfaceConnectionId,
    userId,
    ephemeralPermissions,
    ephemeralIdleLingerMs,
  });

  // In-flight optimistic mutations (LLP 0034 review fix 3): with live push, a
  // concurrent live_replace can arrive DURING a local mutation's in-flight
  // window carrying authoritative rows that legitimately lack the optimistic
  // row (it is not committed yet) at a valid higher version — so version
  // checks cannot help. Every boundary write of server rows re-applies the
  // still-in-flight optimistic reducers on top, so the user's own row never
  // flashes out. Interim until D2 receipts correlate fan-outs to mutations.
  const inFlightOptimistic = new Set();

  const applyOptimisticOverlay = (rows) => {
    let out = rows;
    for (const op of inFlightOptimistic) {
      out = op.reducer(out, op.args, { userId, optimisticId: op.optimisticId });
    }
    return out;
  };

  const writeServerRows = (rows) => {
    if (disposed || !boundary) return rows;
    const overlaid = applyOptimisticOverlay(rows);
    boundary.write(boundaryKey, () => overlaid);
    return overlaid;
  };

  const surfaceConnection = () => (wantLivePush ? liveHandle?.connection ?? 'connecting' : null);

  let initial;
  if (wantLivePush) {
    liveHandle = await client.liveQuery(queryName, {
      connectionId: surfaceConnectionId,
      args: queryArgs,
      userId,
      transport: 'stream',
      stream: liveStreamOptions,
      correlation: surfaceCorrelation,
      onUpdate: (rows) => {
        writeServerRows(rows);
      },
      onConnectionChange: (connection, detail) => {
        // Connection is data (Exact LLP 0284 §2.1 rule 2): re-emit each live
        // observer's last cell with the new connection value so slot sugar
        // and agent inspection see transitions without a data change.
        for (const record of [...liveCellObservers]) {
          if (record.lastCell) record.emit({ ...record.lastCell, connection });
        }
        onConnectionChange?.(connection, detail);
      },
      onSubscriptionEvent,
    });
    initial = liveHandle.rows;
  } else {
    initial = (await client.query(queryName, { args: queryArgs, userId })).rows;
  }
  boundary = runtime.createContractMockQueryBoundary({ [boundaryKey]: initial });
  if (wantLivePush && liveHandle.rows !== initial) {
    // An update that raced boundary creation is not lost: rewrite from the
    // handle's latest rows (idempotent when nothing changed).
    boundary.write(boundaryKey, () => liveHandle.rows);
  }
  // Zero-scope presence rooms subscribe once up front so an `ephemeral`
  // binding's first snapshot delivers synchronously (ENG-22479).
  await ephemeralWiring.prewarm();

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

  // Reconcile fetches authoritative rows and writes them with the in-flight
  // optimistic overlay applied (other mutations may still be in flight);
  // returns the rows as written.
  const reconcile = async () => {
    const rows = (await client.query(queryName, { args: queryArgs, userId })).rows;
    return writeServerRows(rows);
  };

  const track = (promise) => {
    const task = Promise.resolve(promise);
    pending.add(task);
    task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
  };

  const persistMutation = async (name, args, optimisticOp = null) => {
    try {
      // TODO(Exact LLP 0231/0278): thread actionInvocationId/optimisticWaveId
      // into this correlation when the runtime supplies them.
      await client.mutate(name, { args, userId, correlation: surfaceCorrelation });
      // The commit landed: drop the optimistic op BEFORE reconciling so the
      // authoritative row is not doubled by its own overlay.
      if (optimisticOp) inFlightOptimistic.delete(optimisticOp);
      await reconcile();
    } catch (error) {
      if (optimisticOp) inFlightOptimistic.delete(optimisticOp);
      publishDiagnostic('SNAPBACK_CONTRACT_MUTATION_FAILED', error instanceof Error ? error.message : String(error), {
        mutation: name,
        args,
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
      let optimisticOp = null;
      if (typeof reducer === 'function') {
        optimisticOp = { reducer, args, optimisticId: `optimistic_${++optimisticSeq}` };
        inFlightOptimistic.add(optimisticOp);
        boundary.write(boundaryKey, (rows) =>
          reducer(rows, args, { userId, optimisticId: optimisticOp.optimisticId }),
        );
      }
      return track(persistMutation(name, args, optimisticOp));
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
      await track((async () => {
        await client.mutate(name, { args, userId, correlation: surfaceCorrelation });
        // reconcile writes overlaid rows; write the same rows through the
        // provider's boundary handle so concurrent optimistic ops survive.
        const rows = await reconcile();
        qb.write(boundaryKey, () => rows);
      })());
    };
  }

  // Manifest v2 is declared natively: Exact's runtime/conformance accepts
  // manifestVersion 1 | 2 since the LLP 0284 connection-axis merge (the interim
  // v1 projection this adapter carried is gone).
  const baseProvider = runtime.createBoundaryContractDataProvider(manifest, boundary, {
    queries: providerQueries,
    mutations: providerMutations,
    ephemerals: ephemeralWiring.sources,
    rowSyncState: async (_table, rowId) => {
      const rows = (await client.query(queryName, { args: queryArgs, userId })).rows;
      const row = rows.find((r) => r._id === rowId);
      return row
        ? { syncedVersion: row._version, approxSyncedAt: null, pendingMutations: pending.size > 0 }
        : null;
    },
  });

  // DataCellV2 connection axis (Exact LLP 0284 §2.2): cells emitted for the
  // live-bound descriptor carry `connection`; the field is absent for
  // non-subscription descriptors — its absence is itself a fact. Additive: a
  // consumer that ignores the extra field behaves exactly as before.
  const provider = wantLivePush
    ? {
        ...baseProvider,
        subscribe(subscribedQuery, args, observer) {
          if (subscribedQuery !== queryName) {
            return baseProvider.subscribe(subscribedQuery, args, observer);
          }
          const record = {
            lastCell: null,
            emit: (cell) => observer(cell),
          };
          liveCellObservers.add(record);
          const subscription = baseProvider.subscribe(subscribedQuery, args, (cell) => {
            record.lastCell = cell;
            observer({ ...cell, connection: surfaceConnection() });
          });
          return {
            dispose() {
              liveCellObservers.delete(record);
              subscription.dispose();
            },
          };
        },
      }
    : baseProvider;

  // Ephemeral binding + publish links resolve through the finished provider
  // (the `ephemeral` grammar's initializer expects a provider-backed handle).
  Object.assign(links, ephemeralWiring.buildLinks(provider, runtime));

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
    // LLP 0034 D1 facts: whether the bound descriptor streams server push, and
    // the current Exact LLP 0284 §2.2 connection value (null when not
    // subscription-backed).
    livePush: wantLivePush,
    connection: surfaceConnection,
    // Receipt surface (LLP 0034 §3 / ENG-22478): the kit ring, adapter-facing.
    rootId: surfaceRootId,
    receipts: () => (typeof client.receipts === 'function' ? client.receipts() : []),
    // Ephemeral facts (ENG-22479): the conformance gate's LOCAL-ONLY probe
    // reads source starts; prewarmScope subscribes a scoped room up front.
    ephemeralSourceStarts: ephemeralWiring.sourceStarts,
    prewarmEphemeral: ephemeralWiring.prewarmScope,
    mount: (component, options = {}) => {
      assertActive();
      return rememberMountHandle(mountedHandles, mountSnapbackContractHeadless(runtime, component, options));
    },
    flush: async () => {
      await Promise.all([...pending]);
    },
    dispose: () => {
      disposed = true;
      detachReceiptListener?.();
      ephemeralWiring.dispose();
      liveHandle?.dispose();
      liveHandle = null;
      liveCellObservers.clear();
      inFlightOptimistic.clear();
      for (const handle of [...mountedHandles]) {
        handle.dispose();
      }
      mountedHandles.clear();
      pending.clear();
    },
  };
}


// ---------------------------------------------------------------------------
// Ephemeral read-path wiring (ENG-22479; Exact LLP 0284 §2.5 / LLP 0034 §4)
// ---------------------------------------------------------------------------
//
// For every manifest descriptor with `ephemeral: true`, the surface provides:
// - a BoundaryEphemeralSource (options.ephemerals) mapping the kit's
//   EphemeralOverlay to the normative EphemeralMapCell shape — entries carry
//   key/value/updatedAt/expiresAt/sourceClientId/self per LLP 0034 §4's
//   key-mode rules, plus the §2.2 connection axis; a scope-epoch bump arrives
//   as a fresh snapshot (the kit's D2 receipts already mark the resubscribed
//   boundary);
// - links: `<name>(args)` returns a provider-backed ephemeral handle for the
//   `ephemeral` binding, and `<name>Publish(args)` is the mutation-shaped
//   publish (scope fields + value + ttlMs) until Exact LLP 0281 lands;
// - a per-collection source-start counter (the conformance gate's LOCAL-ONLY
//   probe asserts forced subscribers never start the provider source).
//
// Force semantics (forceEphemeralState LOCAL-ONLY, force-reaches-live,
// dispose-restores) come from the Exact runtime's boundary provider force
// plane — the adapter deliberately does NOT wrap subscribeEphemeral or
// forceEphemeralState, so forced cells flow verbatim.
//
// Overlays are SHARED per (collection, scope) and prewarmed at surface
// creation, so a source start delivers its ready snapshot synchronously —
// presence rooms the surface serves are subscribed once, not per observer.
// Idle-room teardown (ENG-22527 item 3): when the LAST observer of a
// (collection, scope) overlay disposes, the shared subscription lingers for
// this window — a re-bind inside it cancels the timer and reuses the room;
// on expiry the overlay is torn down and the server registration is
// best-effort unsubscribed. Overridable per surface (ephemeralIdleLingerMs).
export const EPHEMERAL_IDLE_LINGER_MS = 30_000;

function buildEphemeralWiring({ client, manifest, connectionId, userId, ephemeralPermissions = null, ephemeralIdleLingerMs = EPHEMERAL_IDLE_LINGER_MS }) {
  const descriptors = Object.entries(manifest?.queries ?? {}).filter(
    ([, descriptor]) => descriptor?.ephemeral === true,
  );
  const sourceStarts = {};
  const sources = {};
  const recordCache = new Map(); // cacheKey -> resolved record (sync attach path)
  const pendingCache = new Map(); // cacheKey -> in-flight Promise<record> (ENG-22479 review fix 1)
  const disposals = new Set();
  // ENG-22479 review fix 4: once the surface is disposed, any late-resolving
  // subscribe must be torn down immediately — it would otherwise re-register
  // a lane consumer and onState demand (reopening the closed socket).
  let disposed = false;
  const supportsEphemeral =
    descriptors.length > 0
    && typeof client.subscribeEphemeral === 'function'
    && typeof client.liveStreamManager === 'function';

  // Resync re-subscribe backoff — mirrors the kit's LIVE_RECONNECT_* policy
  // (ENG-22479 review fix 3; the adapter takes the client by injection, so
  // the constants are mirrored rather than imported).
  const RESYNC_BASE_DELAY_MS = 250;
  const RESYNC_MAX_DELAY_MS = 10_000;

  const scopeKeyOf = (args) => JSON.stringify(Object.entries(args ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)));

  const selfKeyFor = (descriptor) => {
    switch (descriptor.keyMode) {
      case 'User':
        return userId ?? null;
      case 'Connection':
        return connectionId;
      default:
        // Session/Custom lease identity is not modeled by this kit client;
        // `self` degrades to false rather than guessing (LLP 0034 §4 / OQ6).
        return null;
    }
  };

  const toMapCell = (record, descriptor) => {
    // Exact 0284 §2.5: an entry past provider TTL is deleted from `entries`
    // and never exposed again; freeze-at-last-known is reserved for
    // stale/disconnected, where entries may age past TTL locally and the
    // connection axis is the trust signal (ENG-22479 review fix 2).
    const connection = record.subscribed === false ? 'stale' : record.connection;
    const frozen = connection === 'stale' || connection === 'disconnected';
    const now = Date.now();
    return {
      status: 'ready',
      entries: record.overlay
        .currentEntries({ prune: false })
        .filter((entry) => frozen || entry.expiresAtMs > now)
        .map((entry) => ({
          key: entry.key,
          value: entry.value,
          updatedAt: entry.receivedAtMs,
          expiresAt: entry.expiresAtMs,
          // The lease key IS the presence provenance (LLP 0034 §4).
          sourceClientId: entry.key,
          self: entry.key === selfKeyFor(descriptor),
        }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      connection,
    };
  };

  // Pruning without a change event never re-renders: arm a one-shot timer at
  // the earliest future expiry so the binding re-emits when an entry ages out
  // on an otherwise-quiet room (ENG-22479 review fix 2). Re-armed after every
  // notification; cleared on dispose.
  const scheduleExpiryReemit = (record) => {
    if (record.expiryTimer) {
      clearTimeout(record.expiryTimer);
      record.expiryTimer = null;
    }
    if (disposed) return;
    const now = Date.now();
    let earliest = Infinity;
    for (const entry of record.overlay.currentEntries({ prune: false })) {
      if (entry.expiresAtMs > now && entry.expiresAtMs < earliest) earliest = entry.expiresAtMs;
    }
    if (earliest === Infinity) return;
    record.expiryTimer = setTimeout(() => {
      record.expiryTimer = null;
      record.notify();
    }, Math.max(16, earliest - now + 5));
    record.expiryTimer.unref?.();
  };

  const createRecord = async (name, args, permissions) => {
    const overlay = await client.subscribeEphemeral(name, {
      connectionId,
      scope: { ...args },
      userId,
      permissions,
    });
    if (disposed) {
      overlay.dispose();
      throw new Error('surface disposed during ephemeral subscribe');
    }
    const record = {
      overlay,
      connection: 'connecting',
      subscribed: true,
      listeners: new Set(),
      offState: null,
      expiryTimer: null,
      resyncTimer: null,
      resyncAttempts: 0,
      lingerTimer: null,
      tornDown: false,
      disposalEntry: null,
      notify: null,
    };
    record.notify = () => {
      for (const listener of [...record.listeners]) listener();
      scheduleExpiryReemit(record);
    };

    // Failed resync re-subscribes retry on bounded backoff while the map
    // presents its honest degraded state — no active subscription while
    // retrying maps to 'stale' per the kit's connection table (ENG-22479
    // review fix 3). A retired subscription emits no further signals, so
    // silence here would freeze the map as empty-but-ready-and-live forever.
    const attemptResync = () => {
      if (disposed) return;
      void client
        .subscribeEphemeral(name, { connectionId, scope: { ...args }, userId, permissions })
        .then((fresh) => {
          if (disposed) {
            fresh.dispose(); // fix 4: never leak past surface disposal
            return;
          }
          const superseded = record.overlay;
          record.overlay = fresh;
          superseded.dispose();
          record.subscribed = true;
          record.resyncAttempts = 0;
          fresh.onChange(handleChange);
          record.notify();
        })
        .catch(() => {
          if (disposed) return;
          const delay = Math.min(
            RESYNC_BASE_DELAY_MS * 2 ** record.resyncAttempts,
            RESYNC_MAX_DELAY_MS,
          );
          record.resyncAttempts += 1;
          record.resyncTimer = setTimeout(() => {
            record.resyncTimer = null;
            attemptResync();
          }, delay);
          record.resyncTimer.unref?.();
        });
    };

    const handleChange = (result) => {
      if (result === 'needs_resync') {
        // The server retired the room's epoch (collection replace/reset) or
        // the queue overflowed: re-enter through a fresh
        // snapshot-with-subscribe and swap the overlay generation (the D2
        // epoch work guarantees the fresh snapshot's epoch is strictly
        // newer, and the kit receipts the resubscribed boundary). Until the
        // fresh subscribe lands the map presents 'stale' (fix 3).
        record.subscribed = false;
        record.notify();
        attemptResync();
        return;
      }
      record.notify();
    };

    // Connection axis: the shared live socket's state is the map's transport
    // truth (same connection the durable lanes ride).
    const manager = client.liveStreamManager(connectionId);
    record.connection = manager.isOpen() ? 'live' : 'connecting';
    record.offState = manager.onState((state) => {
      const next = state === 'open' ? 'live'
        : state === 'budget-missed' ? 'stale'
        : state === 'lost' ? 'stale'
        : state === 'closed' ? 'disconnected'
        : record.connection;
      if (next !== record.connection) {
        record.connection = next;
        record.notify();
      }
    });
    overlay.onChange(handleChange);
    record.disposalEntry = () => {
      record.tornDown = true;
      record.offState?.();
      for (const timer of ['expiryTimer', 'resyncTimer', 'lingerTimer']) {
        if (record[timer]) {
          clearTimeout(record[timer]);
          record[timer] = null;
        }
      }
      record.overlay.dispose();
    };
    disposals.add(record.disposalEntry);
    scheduleExpiryReemit(record);
    return record;
  };

  // Idle-room teardown (ENG-22527 item 3): drop the cache entry, send the
  // best-effort server-side unsubscribe (the D2 ephemeral disposal receipt),
  // and detach locally only once the unsubscribe settles. Ordering matters:
  // each record's manager.onState subscription is shared-socket demand, and
  // dropping the LAST one closes the socket — the server's disconnect
  // cleanup would then remove every registration on the connection before
  // the unsubscribe arrives (nondeterministic receipts, and it would
  // silently unregister sibling rooms mid-teardown). So the unsubscribe is
  // dispatched first; offState/overlay detach in its settle. The in-flight
  // teardown is parked in teardownCache so a rebind after expiry subscribes
  // strictly AFTER the old registration is gone (same (room, connectionId)
  // key — a late unsubscribe must never remove a fresh registration).
  const teardownCache = new Map();
  const teardownIdleRecord = (cacheKey, name, args, permissions, record) => {
    if (record.tornDown || disposed) return;
    record.tornDown = true;
    recordCache.delete(cacheKey);
    disposals.delete(record.disposalEntry);
    for (const timer of ['expiryTimer', 'resyncTimer', 'lingerTimer']) {
      if (record[timer]) {
        clearTimeout(record[timer]);
        record[timer] = null;
      }
    }
    const unsubscribe = client.unsubscribeEphemeral?.(name, {
      connectionId,
      scope: { ...args },
      userId,
      permissions,
    });
    const settled = Promise.resolve(unsubscribe)
      .catch(() => {
        // Best-effort: disconnect/reap covers the registration otherwise.
      })
      .finally(() => {
        record.offState?.();
        record.overlay.dispose();
        teardownCache.delete(cacheKey);
      });
    teardownCache.set(cacheKey, settled);
  };

  const armIdleLinger = (cacheKey, name, args, permissions, record) => {
    if (record.tornDown || disposed || record.listeners.size > 0 || record.lingerTimer) return;
    record.lingerTimer = setTimeout(() => {
      record.lingerTimer = null;
      if (record.listeners.size === 0) {
        teardownIdleRecord(cacheKey, name, args, permissions, record);
      }
    }, ephemeralIdleLingerMs);
    record.lingerTimer.unref?.();
  };

  // In-flight dedup (ENG-22479 review fix 1): two bindings of the same
  // (collection, scope) mounting in one flush share ONE server subscription —
  // the in-flight promise is cached before the await, and the resolved
  // record replaces it for the synchronous attach path.
  const ensureOverlay = (name, descriptor, args) => {
    const cacheKey = `${name}\u0000${scopeKeyOf(args)}`;
    const resolved = recordCache.get(cacheKey);
    if (resolved) return Promise.resolve(resolved);
    const inflight = pendingCache.get(cacheKey);
    if (inflight) return inflight;
    const tearing = teardownCache.get(cacheKey);
    if (tearing) {
      // Rebind racing an idle teardown: wait for the old registration to be
      // unsubscribed, then subscribe fresh (ENG-22527 item 3).
      return tearing.then(() => ensureOverlay(name, descriptor, args));
    }
    const permissions = ephemeralPermissions?.(name, args) ?? [];
    const pending = createRecord(name, args, permissions)
      .then((record) => {
        recordCache.set(cacheKey, record);
        return record;
      })
      .finally(() => {
        pendingCache.delete(cacheKey);
      });
    pendingCache.set(cacheKey, pending);
    return pending;
  };

  for (const [name, descriptor] of descriptors) {
    sourceStarts[name] = 0;
    if (!supportsEphemeral) continue;
    sources[name] = (args, emit) => {
      sourceStarts[name] += 1;
      let active = true;
      let offListener = null;
      const cacheKey = `${name}\u0000${scopeKeyOf(args)}`;
      const cached = recordCache.get(cacheKey);
      const permissions = ephemeralPermissions?.(name, args) ?? [];
      const attach = (record) => {
        if (!active || disposed) {
          // The observer went away while the subscribe was in flight: give
          // the now-observerless room its linger window (ENG-22527 item 3).
          armIdleLinger(cacheKey, name, args, permissions, record);
          return;
        }
        if (record.lingerTimer) {
          // Re-bind within the linger window: cancel and reuse.
          clearTimeout(record.lingerTimer);
          record.lingerTimer = null;
        }
        const listener = () => emit(toMapCell(record, descriptor));
        record.listeners.add(listener);
        offListener = () => {
          record.listeners.delete(listener);
          if (record.listeners.size === 0) {
            armIdleLinger(cacheKey, name, args, permissions, record);
          }
        };
        emit(toMapCell(record, descriptor));
      };
      if (cached) {
        // Prewarmed/shared overlay: the ready snapshot delivers synchronously.
        attach(cached);
      } else {
        void ensureOverlay(name, descriptor, args)
          .then((record) => attach(record))
          .catch((error) => {
            if (!active || disposed) return;
            console.warn(`[snapback-contract] ephemeral subscribe failed for "${name}"`, error);
            emit({ status: 'error', entries: [] });
          });
      }
      return () => {
        active = false;
        offListener?.();
      };
    };
  }

  return {
    descriptors,
    sources,
    sourceStarts: (name) => sourceStarts[name] ?? 0,
    prewarm: async () => {
      if (!supportsEphemeral) return;
      // Prewarm zero-arg scopes only when the descriptor has no scope fields;
      // scoped rooms subscribe on first bind (their args are app data).
      for (const [name, descriptor] of descriptors) {
        if ((descriptor.scopeFields ?? []).length === 0) {
          await ensureOverlay(name, descriptor, {}).catch(() => {});
        }
      }
    },
    prewarmScope: async (name, args) => {
      const descriptor = manifest?.queries?.[name];
      if (!supportsEphemeral || !descriptor) return;
      await ensureOverlay(name, descriptor, args ?? {}).catch(() => {});
    },
    buildLinks: (provider, runtime) => {
      const links = {};
      for (const [name] of descriptors) {
        links[name] = (args = {}) => runtime.createProviderEphemeralHandle(provider, name, args ?? {});
        links[`${name}Publish`] = (args = {}) => {
          const { value, ttlMs = null, ...scope } = args ?? {};
          const permissions = ephemeralPermissions?.(name, scope) ?? [];
          // Presence publishes are not durable mutations: no optimistic
          // layer, no pending/flush participation; the socket's latest-state
          // coalescing owns delivery (LLP 0013).
          return client.publishEphemeral(name, {
            connectionId,
            scope,
            value,
            ttlMs,
            userId,
            permissions,
          });
        };
      }
      return links;
    },
    dispose: () => {
      disposed = true;
      for (const dispose of [...disposals]) {
        try {
          dispose();
        } catch {
          // best-effort teardown
        }
      }
      disposals.clear();
      recordCache.clear();
      pendingCache.clear();
    },
  };
}

function defaultContractRootId() {
  const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  return `root_${unique}`;
}

function defaultContractConnectionId() {
  const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  return `contract_${unique}`;
}

// Multi-query live surface (LLP 0034 §6 ownership row 3; Exact LLP 0284 §5.3).
//
// Each named live query gets its own boundary key (the query name), its own
// snapshot-with-subscribe over the kit's stream transport (one shared socket
// per connection), and its own connection axis; server-authored live_replace
// rows are written straight into the boundary — no app-code pump. Query links
// return provider-backed handles (runtime.createProviderQueryHandle) whose
// deliveries carry the full cell, so `async … stale rows` sugar and
// `<binding>.connection` work in the .contract. Non-live queries serve empty
// ready cells (nothing in the All Aboard surface consumes them — the static
// schedule ships in the shared model); mutations persist server-side with
// pending tracking and no optimistic layer — freshness for live-bound queries
// is owned by the push, not reconcile-on-mutate.
async function createMultiLiveContractSurface({
  runtime,
  client,
  userId,
  manifest,
  liveQueries,
  livePush,
  connectionId,
  liveStreamOptions,
  onConnectionChange,
  onSubscriptionEvent,
  rootId,
  detachReceiptListener = null,
  ephemeralPermissions = null,
  ephemeralIdleLingerMs = EPHEMERAL_IDLE_LINGER_MS,
  diagnostics,
  pending,
  mountedHandles,
}) {
  if (typeof runtime.createProviderQueryHandle !== 'function') {
    throw new Error(
      'createSnapbackContractSurface liveQueries mode requires an Exact runtime with createProviderQueryHandle (LLP 0284 §2.2).',
    );
  }
  const queryNames = Object.keys(manifest?.queries ?? {});
  const mutationNames = Object.keys(manifest?.mutations ?? {});
  for (const name of liveQueries) {
    if (!manifest?.queries?.[name]) {
      throw new Error(`liveQueries names an unknown manifest query "${name}".`);
    }
  }

  let disposed = false;
  let boundary = null;
  const sharedConnectionId = connectionId ?? defaultContractConnectionId();
  const liveHandles = new Map(); // query name -> kit live handle
  const liveCellObservers = new Map(); // query name -> Set<record>
  const wantLivePush = livePush && typeof client.liveQuery === 'function';
  const ephemeralWiring = buildEphemeralWiring({
    client,
    manifest,
    connectionId: sharedConnectionId,
    userId,
    ephemeralPermissions,
    ephemeralIdleLingerMs,
  });

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

  const connectionFor = (name) =>
    (wantLivePush && liveHandles.has(name) ? liveHandles.get(name).connection ?? 'connecting' : null);

  const reemitCells = (name, connection) => {
    for (const record of [...(liveCellObservers.get(name) ?? [])]) {
      if (record.lastCell) record.emit({ ...record.lastCell, connection });
    }
  };

  // Establish every live subscription (snapshot-with-subscribe each; one
  // shared socket via the connection id) before the boundary exists, then
  // build the boundary from the snapshots.
  const initialRows = {};
  for (const name of queryNames) {
    if (manifest?.queries?.[name]?.ephemeral === true) continue;
    initialRows[name] = [];
  }
  if (wantLivePush) {
    for (const name of liveQueries) {
      const handle = await client.liveQuery(name, {
        connectionId: sharedConnectionId,
        args: {},
        userId,
        transport: 'stream',
        stream: liveStreamOptions,
        // Adapter-stitched correlation (LLP 0034 §3.2); TODO(Exact LLP
        // 0231/0278): thread action/wave ids when the runtime supplies them.
        correlation: { rootId, bindingIds: [name] },
        onUpdate: (rows) => {
          if (!disposed && boundary) boundary.write(name, () => rows);
        },
        onConnectionChange: (connection, detail) => {
          // Connection is data (Exact LLP 0284 §2.1 rule 2): re-emit last
          // cells so slot sugar sees transitions without a data change.
          reemitCells(name, connection);
          onConnectionChange?.(connection, { ...detail, queryName: name });
        },
        onSubscriptionEvent: onSubscriptionEvent
          ? (event) => onSubscriptionEvent({ ...event, queryName: name })
          : null,
      });
      liveHandles.set(name, handle);
      liveCellObservers.set(name, new Set());
      initialRows[name] = handle.rows;
    }
  }
  boundary = runtime.createContractMockQueryBoundary(initialRows);
  for (const [name, handle] of liveHandles) {
    if (handle.rows !== initialRows[name]) {
      // An update that raced boundary creation is not lost.
      boundary.write(name, () => handle.rows);
    }
  }

  const track = (promise) => {
    const task = Promise.resolve(promise);
    pending.add(task);
    task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
  };

  const persistMutation = async (name, args) => {
    try {
      await client.mutate(name, {
        args,
        userId,
        correlation: { rootId, bindingIds: [...liveQueries] },
      });
    } catch (error) {
      publishDiagnostic('SNAPBACK_CONTRACT_MUTATION_FAILED', error instanceof Error ? error.message : String(error), {
        mutation: name,
        args,
      });
      throw error;
    }
  };

  const providerQueries = {};
  for (const name of queryNames) {
    if (manifest?.queries?.[name]?.ephemeral === true) continue; // §2.4 kind split
    providerQueries[name] = (_args, qb) => qb.query(name, (rows) => rows, { key: name });
  }
  const providerMutations = {};
  for (const name of mutationNames) {
    providerMutations[name] = async (args) => {
      assertActive();
      await track(persistMutation(name, args));
    };
  }

  await ephemeralWiring.prewarm();

  const baseProvider = runtime.createBoundaryContractDataProvider(manifest, boundary, {
    queries: providerQueries,
    mutations: providerMutations,
    ephemerals: ephemeralWiring.sources,
  });

  // DataCellV2 connection axis: cells for live-bound queries carry their own
  // query's connection; the field stays absent elsewhere.
  const provider = {
    ...baseProvider,
    subscribe(subscribedQuery, args, observer) {
      if (!liveHandles.has(subscribedQuery)) {
        return baseProvider.subscribe(subscribedQuery, args, observer);
      }
      const records = liveCellObservers.get(subscribedQuery);
      const record = {
        lastCell: null,
        emit: (cell) => observer(cell),
      };
      records.add(record);
      const subscription = baseProvider.subscribe(subscribedQuery, args, (cell) => {
        record.lastCell = cell;
        observer({ ...cell, connection: connectionFor(subscribedQuery) });
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
  for (const name of queryNames) {
    if (manifest?.queries?.[name]?.ephemeral === true) continue; // bound below
    links[name] = (args = {}) => {
      assertActive();
      return runtime.createProviderQueryHandle(provider, name, args ?? {});
    };
  }
  for (const name of mutationNames) {
    links[name] = (args) => {
      assertActive();
      return track(persistMutation(name, args));
    };
  }
  Object.assign(links, ephemeralWiring.buildLinks(provider, runtime));

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
    livePush: wantLivePush,
    liveQueries: [...liveQueries],
    connectionId: sharedConnectionId,
    rootId,
    receipts: () => (typeof client.receipts === 'function' ? client.receipts() : []),
    ephemeralSourceStarts: ephemeralWiring.sourceStarts,
    prewarmEphemeral: ephemeralWiring.prewarmScope,
    // Per-query connection facts; no argument = the first live query.
    connection: (name = liveQueries[0]) => connectionFor(name),
    connections: () => Object.fromEntries(liveQueries.map((name) => [name, connectionFor(name)])),
    mount: (component, options = {}) => {
      assertActive();
      return rememberMountHandle(mountedHandles, mountSnapbackContractHeadless(runtime, component, options));
    },
    flush: async () => {
      await Promise.all([...pending]);
    },
    dispose: () => {
      disposed = true;
      detachReceiptListener?.();
      ephemeralWiring.dispose();
      for (const [, handle] of liveHandles) {
        handle.dispose();
      }
      liveHandles.clear();
      liveCellObservers.clear();
      for (const handle of [...mountedHandles]) {
        handle.dispose();
      }
      mountedHandles.clear();
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
  const mountedHandles = new Set();
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
    const task = Promise.resolve(promise);
    pending.add(task);
    task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
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
    mount: (component, options = {}) => {
      assertActive();
      return rememberMountHandle(mountedHandles, mountSnapbackContractHeadless(runtime, component, options));
    },
    flush: async () => {
      await Promise.all([...pending]);
    },
    dispose: () => {
      disposed = true;
      for (const handle of [...mountedHandles]) {
        handle.dispose();
      }
      mountedHandles.clear();
      pending.clear();
    },
  };
}

function rememberMountHandle(mountedHandles, handle) {
  if (!handle || typeof handle.dispose !== 'function') {
    throw new Error('Contract runtime mount() did not return a disposable mount handle.');
  }

  let disposed = false;
  const trackedHandle = {
    ...handle,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      mountedHandles.delete(trackedHandle);
      handle.dispose();
    },
  };
  mountedHandles.add(trackedHandle);
  return trackedHandle;
}

function wrapMountHandle(handle, { runtime = null, mountOptions = {} } = {}) {
  if (!handle || typeof handle.dispose !== 'function') {
    throw new Error('Contract runtime mount() did not return a disposable mount handle.');
  }

  let disposed = false;
  return {
    ...handle,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (!mountOptions.container && typeof runtime?.unmount === 'function') {
        runtime.unmount(mountOptions.rootId ?? 0);
      } else {
        handle.dispose();
      }
    },
  };
}

function normalizeContractMountOptions(options = {}) {
  return {
    ...options,
    host: options.host ?? 'headless',
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
    // Actions are not Contract data bindings (codegen skips them when
    // emitting descriptors) — cron-run functions like all-aboard's
    // refreshFeed must not be demanded as query bindings.
    if (fn.kind === 'Action') continue;
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
    // Ephemeral read descriptors live in the queries map (Exact LLP 0284
    // §2.5) but are collections, not server functions (ENG-22479).
    if (queries[name]?.ephemeral === true) continue;
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
    const expectedFiles = manifest.queries[name]?.ephemeral === true
      ? [
          `contract/${name}.ephemeral.ts`,
          `contract/${name}.ephemeral.contract-meta.ts`,
          `contract/${name}.publish.ts`,
          `contract/${name}.publish.contract-meta.ts`,
        ]
      : [`contract/${name}.query.ts`, `contract/${name}.query.contract-meta.ts`];
    for (const file of expectedFiles) {
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

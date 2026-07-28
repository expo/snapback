// Deterministic package fixture for the comparator runner. This is not a fake
// pass switch: each fault mode breaks one observable provider property so the
// package tests prove the corresponding check turns red.

const waitForever = () => new Promise(() => {});

function fixtureIdentity() {
  return {
    target: {
      available: true,
      kind: 'package-fixture',
      profileId: 'fixture-v1',
      serverUrl: 'fixture://snapback',
      databaseMode: 'isolated-memory',
      managed: true,
    },
    artifact: {
      available: true,
      appId: 'app',
      bundleHash: 'sha256:fixture-bundle',
      inputsHash: 'fixture-inputs',
      schemaHash: 'sha256:fixture-schema',
    },
    binary: {
      available: true,
      path: '/fixture/snapback',
      sha256: `sha256:${'a'.repeat(64)}`,
      crateVersion: '0.1.0-fixture',
      gitCommit: 'fixture-commit',
      gitDirty: false,
      buildProfile: 'fixture',
      startupNonce: 'fixture-startup',
    },
  };
}

export function createComparatorFixtureTarget(fault = null) {
  const state = {
    durableVersion: 1,
    liveRows: fault === 'live-preexisting'
      ? [{ body: 'native push witness' }]
      : [],
    primaryRows: [],
    activityRows: [],
    rejectionRows: [{ value: 'before' }],
    presence: new Map(),
    liveHandles: new Set(),
    closed: false,
  };

  const sweep = () => {
    if (fault === 'presence-ttl') return;
    const now = Date.now();
    for (const [key, entry] of state.presence) {
      if (entry.expiresAtMs !== null && entry.expiresAtMs <= now) state.presence.delete(key);
    }
  };

  const createClient = ({ userId }) => ({
    principalId: userId,
    principalSource: 'fixture-asserted',
    inspect: async () => ({ storage: { version: state.durableVersion } }),
    query: async (ref) => {
      const name = typeof ref === 'string' ? ref : ref.name;
      return { rows: structuredClone(state[name] ?? []) };
    },
    async liveQuery(_ref, options) {
      if (fault === 'timeout') return waitForever();
      const handle = {
        rows: structuredClone(state.liveRows),
        version: state.durableVersion,
        disposed: false,
        dispose() {
          handle.disposed = true;
          state.liveHandles.delete(handle);
        },
        onUpdate: options.onUpdate,
      };
      state.liveHandles.add(handle);
      options.onSubscriptionEvent?.({
        kind: 'subscription',
        event: 'established',
        subscriptionId: 'fixture-subscription',
        transport: fault === 'polling-as-push' ? 'poll' : 'push',
      });
      return handle;
    },
    async mutate(ref, options) {
      const name = typeof ref === 'string' ? ref : ref.name;
      if (name === 'publishLiveRow') {
        if (fault !== 'live-delivery') {
          state.liveRows.push({ body: options.args.body });
          state.durableVersion += 1;
          for (const handle of state.liveHandles) {
            if (handle.disposed) continue;
            handle.rows = structuredClone(state.liveRows);
            handle.version = state.durableVersion;
            handle.onUpdate?.(handle.rows, {
              kind: 'live_replace',
              version: handle.version,
            });
          }
        }
        return { changed_count: fault === 'live-delivery' ? 0 : 1 };
      }
      if (name === 'writePrimaryAndActivity') {
        state.primaryRows.push({ value: options.args.primary });
        if (fault !== 'atomic-write-set') {
          state.activityRows.push({ value: options.args.activity });
        }
        state.durableVersion += 1;
        return { changed_count: fault === 'atomic-write-set' ? 1 : 2 };
      }
      if (name === 'rejectInvalidWrite') {
        if (fault === 'rejection-rollback') {
          state.rejectionRows.push({ value: options.args.value });
          state.durableVersion += 1;
        }
        const error = new Error('fixture rejection');
        error.diagnostic = { code: 'FIXTURE_REJECTED', message: 'fixture rejection' };
        throw error;
      }
      throw new Error(`unknown fixture mutation ${name}`);
    },
    async subscribeEphemeral() {
      sweep();
      return {
        async publish() {},
        async drain() {
          sweep();
        },
        currentEntries() {
          sweep();
          return [...state.presence.values()].map((entry) => structuredClone(entry));
        },
        dispose() {},
      };
    },
    async publishEphemeral(_ref, options) {
      state.presence.set(options.connectionId, {
        key: options.connectionId,
        value: structuredClone(options.value),
        expiresAtMs: options.ttlMs === null || options.ttlMs === undefined
          ? null
          : Date.now() + options.ttlMs,
      });
      if (fault === 'ephemeral-version') state.durableVersion += 1;
      return { entry_version: 1, scope_epoch: 1, key: options.connectionId };
    },
    async unsubscribeEphemeral() {
      return { removed: true };
    },
    async disconnect(connectionId) {
      if (fault !== 'presence-disconnect') state.presence.delete(connectionId);
      return { disconnected: true };
    },
  });

  return {
    identity: fixtureIdentity(),
    capabilities: fault === 'missing-capability'
      ? ['live_subscriptions', 'ephemeral_collections']
      : ['live_subscriptions', 'websocket_push_transport', 'ephemeral_collections'],
    capabilityGaps: fault === 'missing-capability' ? ['websocket_push_transport'] : [],
    createClient,
    assertAlive() {
      if (fault === 'dead-server') {
        const error = new Error('fixture server died');
        error.code = 'SNAPBACK_COMPARATOR_SERVER_DEAD';
        error.diagnostic = {
          code: 'SNAPBACK_COMPARATOR_SERVER_DEAD',
          message: 'fixture server died',
        };
        throw error;
      }
    },
    async close() {
      state.closed = true;
      if (fault === 'cleanup') throw new Error('fixture cleanup rejected');
      return {
        ok: true,
        managed: true,
        leaderExited: true,
        temporaryStateRemoved: true,
        errors: [],
      };
    },
    state,
  };
}

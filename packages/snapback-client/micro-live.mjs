// Smallest Phase-B live composition: grant-owned HTTP polling, snapshots,
// replace/delta application, conservative resnapshot, and explicit release.
// @ref LLP 0147#live-operations — this module is reachable only when codegen
//   selects a LiveQuery and records `live` in the profile artifact.

import {
  MICRO_CORE_INTERNALS,
  microAuthInput,
  microCodedError,
  microFiniteVersion,
  microIsObject,
} from './micro-core.mjs';

function decodeDurablePayload(value) {
  if (!Array.isArray(value)
    || !value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw microCodedError('SNAPBACK_MICRO_LIVE_FRAME_INVALID', 'durable polling payload must be a byte array');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(value));
  } catch (error) {
    throw microCodedError('SNAPBACK_MICRO_LIVE_FRAME_INVALID', 'durable polling payload is not valid UTF-8', {}, error);
  }
}

function applyDelta(rows, operations) {
  if (!Array.isArray(operations)) {
    throw microCodedError('SNAPBACK_MICRO_LIVE_FRAME_INVALID', 'live_delta ops must be an array');
  }
  const next = [...rows];
  for (const operation of operations) {
    if (!microIsObject(operation)
      || !['add', 'update', 'remove'].includes(operation.op)
      || typeof operation.id !== 'string') {
      throw microCodedError('SNAPBACK_MICRO_LIVE_FRAME_INVALID', 'live_delta contains a malformed operation');
    }
    const index = next.findIndex((row) => microIsObject(row) && row._id === operation.id);
    if (operation.op === 'remove') {
      if (index !== -1) next.splice(index, 1);
      continue;
    }
    if (!microIsObject(operation.row) || operation.row._id !== operation.id) {
      throw microCodedError('SNAPBACK_MICRO_LIVE_FRAME_INVALID', 'live_delta add/update requires a matching row identity');
    }
    if (index === -1) next.push(operation.row);
    else next[index] = operation.row;
  }
  return next;
}

export function withMicroLive(core) {
  const internals = core?.[MICRO_CORE_INTERNALS];
  if (!internals) throw new TypeError('withMicroLive requires a Micro core runtime');
  const { capture, request, validateFacts, expectedGeneration, addParticipant } = internals;

  const subscribe = async (descriptor, args = {}, { onUpdate = null } = {}) => {
    if (!microIsObject(descriptor)
      || descriptor.kind !== 'LiveQuery'
      || typeof descriptor.name !== 'string') {
      throw microCodedError('SNAPBACK_MICRO_DESCRIPTOR_INVALID', 'generated live descriptor is invalid');
    }
    if (onUpdate !== null && typeof onUpdate !== 'function') {
      throw new TypeError('Micro live onUpdate must be a function');
    }
    const label = `micro-${Math.random().toString(36).slice(2)}`;
    let owner = capture();
    let grant = null;
    let subscriptionId = null;
    let rows = [];
    let version = 0;
    let disposed = false;
    let stopped = false;
    let tail = Promise.resolve();
    let removeParticipant = () => {};

    const blank = () => {
      rows = [];
      version = 0;
      onUpdate?.(rows, { kind: 'blank', version });
    };
    const grantHeaders = () => ({ 'x-snapback-connection-token': grant.token });
    const openGrant = async () => {
      const opened = await request('POST', '/connection/open', {
        connectionId: label,
        wireVersion: 'snapback.v1',
      }, owner);
      if (!microIsObject(opened)
        || typeof opened.connectionId !== 'string'
        || typeof opened.connectionToken !== 'string'
        || opened.wireVersion !== 'snapback.v1') {
        throw microCodedError('SNAPBACK_MICRO_LIVE_GRANT_INVALID', 'connection open returned an invalid grant or wire-version binding');
      }
      grant = { id: opened.connectionId, token: opened.connectionToken };
    };
    const unsubscribeOwned = async () => {
      if (grant === null || subscriptionId === null) return;
      const old = subscriptionId;
      subscriptionId = null;
      await request('POST', `/live/${encodeURIComponent(descriptor.name)}/unsubscribe`, {
        subscription_id: old,
        connection_id: grant.id,
        auth: microAuthInput(owner.userId),
      }, owner, {
        staleCleanup: owner !== capture(),
        headers: grantHeaders(),
      }).catch(() => {});
    };
    const establish = async (supersedes = null) => {
      if (disposed) return;
      if (stopped) {
        throw microCodedError('SNAPBACK_MICRO_STALE_ARTIFACT', 'generated live client is stale and has stopped');
      }
      if (grant === null) await openGrant();
      const response = await request('POST', `/live/${encodeURIComponent(descriptor.name)}/subscribe`, {
        connection_id: grant.id,
        input: { args, auth: microAuthInput(owner.userId), read_set: [] },
        expectedGeneration,
        ...(supersedes === null ? {} : { supersedes }),
      }, owner, { headers: grantHeaders() });
      if (!microIsObject(response)
        || typeof response.subscription_id !== 'string'
        || !microIsObject(response.snapshot)
        || !microFiniteVersion(response.snapshot.version)
        || !Array.isArray(response.snapshot.rows)) {
        throw microCodedError('SNAPBACK_MICRO_LIVE_SNAPSHOT_INVALID', 'subscribe returned an invalid snapshot');
      }
      if (supersedes !== null) {
        const retired = response.superseded === supersedes;
        const absent = response.supersessionRefusal === 'SNAPBACK_LIVE_SUPERSESSION_TARGET_UNKNOWN';
        if (retired === absent) {
          throw microCodedError('SNAPBACK_MICRO_LIVE_SUPERSESSION_INVALID', 'subscribe omitted the exact predecessor disposition');
        }
      }
      validateFacts(response);
      subscriptionId = response.subscription_id;
      version = response.snapshot.version;
      rows = response.snapshot.rows;
      onUpdate?.(rows, { kind: 'snapshot', version });
    };
    const establishOrStop = async (supersedes = null) => {
      try {
        await establish(supersedes);
      } catch (error) {
        if ([
          'SNAPBACK_ARTIFACT_IDENTITY_MISMATCH',
          'SNAPBACK_MICRO_GENERATION_FACTS_MISMATCH',
          'SNAPBACK_MICRO_GENERATION_FACTS_MISSING',
        ].includes(error?.code)) {
          stopped = true;
          blank();
          throw microCodedError(
            'SNAPBACK_MICRO_STALE_ARTIFACT',
            'generated live client is stale and has stopped',
            {},
            error,
          );
        }
        throw error;
      }
    };
    const resnapshot = async () => {
      const previous = subscriptionId;
      blank();
      try {
        await establishOrStop(previous);
      } catch (error) {
        if (error?.code === 'SNAPBACK_MICRO_STALE_ARTIFACT') throw error;
        grant = null;
        subscriptionId = null;
        await establishOrStop(null);
      }
    };
    const applyFrame = async (frame) => {
      if (!microIsObject(frame) || typeof frame.kind !== 'string') {
        throw microCodedError('SNAPBACK_MICRO_LIVE_FRAME_INVALID', 'live frame requires a string kind');
      }
      if (!['live_replace', 'live_delta', 'resync_required'].includes(frame.kind)) return;
      if (frame.kind === 'resync_required') {
        if (frame.subscription_id === undefined || frame.subscription_id === subscriptionId) await resnapshot();
        return;
      }
      if (frame.subscription_id !== subscriptionId) return;
      if (!microFiniteVersion(frame.version)) {
        throw microCodedError('SNAPBACK_MICRO_LIVE_FRAME_INVALID', 'live frame version is invalid');
      }
      if (frame.version <= version) return;
      if (frame.version !== version + 1) {
        await resnapshot();
        return;
      }
      let next;
      if (frame.kind === 'live_replace') {
        if (!Array.isArray(frame.rows)) {
          throw microCodedError('SNAPBACK_MICRO_LIVE_FRAME_INVALID', 'live_replace rows must be an array');
        }
        next = frame.rows;
      } else {
        next = applyDelta(rows, frame.ops);
      }
      rows = next;
      version = frame.version;
      onUpdate?.(rows, { kind: frame.kind, version });
    };
    const poll = () => {
      tail = tail.catch(() => {}).then(async () => {
        if (disposed) return;
        if (stopped) {
          throw microCodedError('SNAPBACK_MICRO_STALE_ARTIFACT', 'generated live client is stale and has stopped');
        }
        let envelopes;
        try {
          envelopes = await request(
            'GET',
            `/outbox/${encodeURIComponent(grant.id)}`,
            undefined,
            owner,
            { headers: grantHeaders() },
          );
        } catch (error) {
          if (![
            'SNAPBACK_MICRO_TRANSPORT_FAILED',
            'SNAPBACK_CONNECTION_TOKEN_INVALID',
          ].includes(error?.code)) throw error;
          // Poll loss may coincide with server-side owner teardown. Blank and
          // build a complete new grant+snapshot relationship; no old rows are
          // shown as current while the replacement is unknown.
          blank();
          grant = null;
          subscriptionId = null;
          await establishOrStop(null);
          return;
        }
        if (!Array.isArray(envelopes)) {
          throw microCodedError('SNAPBACK_MICRO_LIVE_FRAME_INVALID', 'outbox drain must return an array');
        }
        const failures = [];
        // The GET response is the LLP 0059 ownership cut. Isolate every
        // acknowledged item so one malformed payload cannot discard its
        // valid batch remainder; then force a fresh snapshot before surfacing.
        // @ref LLP 0095#4.3 — post-cut poll decode loss forces resnapshot.
        for (const envelope of envelopes) {
          if (!microIsObject(envelope) || !Object.hasOwn(envelope, 'Durable')) continue;
          if (!microIsObject(envelope.Durable)) {
            failures.push({
              code: 'SNAPBACK_MICRO_LIVE_FRAME_INVALID',
              message: 'recognized Durable wrapper must be an object',
            });
            continue;
          }
          try {
            const frame = JSON.parse(decodeDurablePayload(envelope.Durable.payload));
            await applyFrame(frame);
          } catch (error) {
            failures.push({
              code: error?.code ?? 'SNAPBACK_MICRO_LIVE_FRAME_INVALID',
              message: error?.message ?? String(error),
            });
          }
        }
        if (failures.length > 0) {
          await resnapshot();
          throw microCodedError(
            'SNAPBACK_MICRO_LIVE_DECODE_FAILED',
            'one or more acknowledged live frames failed to decode; state was resnapshotted',
            { failures },
          );
        }
      });
      return tail;
    };
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      removeParticipant();
      await tail.catch(() => {});
      await unsubscribeOwned();
      blank();
    };
    const authorityChanged = async (next) => {
      blank();
      await unsubscribeOwned();
      owner = next;
      grant = null;
      subscriptionId = null;
      if (!disposed && !stopped) await establishOrStop();
    };
    const participant = { authorityChanged, dispose };
    const handle = Object.freeze({
      get rows() { return rows; },
      get version() { return version; },
      get subscriptionId() { return subscriptionId; },
      poll,
      resnapshot: () => { tail = tail.catch(() => {}).then(resnapshot); return tail; },
      dispose,
    });
    removeParticipant = addParticipant(participant);
    try {
      await establish();
      return handle;
    } catch (error) {
      removeParticipant();
      disposed = true;
      throw error;
    }
  };

  return Object.freeze({
    invoke: core.invoke,
    subscribe,
    setIdentity: core.setIdentity,
    dispose: core.dispose,
    [MICRO_CORE_INTERNALS]: internals,
  });
}

// TEMPORARY L4 MERGE STAND-IN: replace this module with lane L3's
// registration-ledger.mjs at integration. DemandBroker depends only on the
// four methods returned here; this implementation exists so L4 can be tested
// before the serialized L3 stream is merged.
//
// @ref LLP 0166#the-registration-record — this stand-in implements only the
// broker-facing registration merge/durability seam, not L3's hydration API.

import { jcsBytes } from './rqs.mjs';

export const DURABLE_REGISTRATION_CEILING = 512;
export const REGISTRATION_BYTE_CEILING = 16 * 1024;

const clone = (value) => structuredClone(value);
let defaultStandIn = null;

export function createRegistrationLedger({
  storeHandle,
  resolveRegistration,
} = {}) {
  if (typeof storeHandle?.materializationTransaction !== 'function') {
    throw new TypeError('registration ledger requires a v3 store handle');
  }
  if (typeof resolveRegistration !== 'function') {
    throw new TypeError('registration ledger requires resolveRegistration(registration)');
  }
  const activePairs = new Map();

  const resolved = (registration) => {
    const result = resolveRegistration(clone(registration));
    if (
      !result
      || typeof result.addressKey !== 'string'
      || typeof result.authorityPartitionDigest !== 'string'
    ) throw new TypeError('resolveRegistration must return addressKey and authorityPartitionDigest');
    return result;
  };

  const all = async () => storeHandle.materializationTransaction('readonly', (view) => {
    const durable = Object.values(view.storeMeta.durableRegistrations).map(clone);
    return [...durable, ...[...activePairs.values()].flatMap((pair) => pair.demands.map(clone))];
  });

  const effectivePolicyFor = async (addressKey) => {
    const registrations = (await all()).filter((entry) => {
      try { return resolved(entry).addressKey === addressKey; } catch { return false; }
    });
    const retentionRequest = registrations.some((entry) => entry.retentionRequest === 'durable')
      ? 'durable' : 'none';
    const ranks = { none: 0, default: 1, pinned: 2 };
    const idleTtlClass = registrations.reduce(
      (best, entry) => ranks[entry.idleTtlClass] > ranks[best] ? entry.idleTtlClass : best,
      'none',
    );
    const demandState = registrations.some((entry) => entry.source === 'active')
      ? 'demanded-active'
      : registrations.length > 0 ? 'demanded-idle' : 'undemanded';
    return { retentionRequest, idleTtlClass, demandState };
  };

  const ledger = Object.freeze({
    async applyContextDemands({ contextId, authorityPartitionDigest, revision, demands }) {
      const key = `${contextId}\u0000${authorityPartitionDigest}`;
      const prior = activePairs.get(key);
      if (prior && revision <= prior.revision) return { applied: false };
      activePairs.set(key, { revision, demands: demands.map(clone) });
      return { applied: true };
    },

    async releaseContextDemands({ contextId }) {
      for (const key of [...activePairs.keys()]) {
        if (key.startsWith(`${contextId}\u0000`)) activePairs.delete(key);
      }
    },

    async registerDurable(registration) {
      const info = resolved(registration);
      return storeHandle.materializationTransaction('readwrite', (view) => {
        const records = view.storeMeta.durableRegistrations;
        const existing = records[registration.registrationId];
        if (existing !== undefined) {
          return JSON.stringify(existing) === JSON.stringify(registration)
            ? { committed: true }
            : { refused: { code: 'SNAPBACK_REGISTRATION_ID_REUSED' } };
        }
        if (Object.keys(records).length >= DURABLE_REGISTRATION_CEILING) {
          return { refused: { code: 'SNAPBACK_DURABLE_REGISTRATION_FULL' } };
        }
        if (jcsBytes(registration).length > REGISTRATION_BYTE_CEILING) {
          return { refused: { code: 'SNAPBACK_DURABLE_REGISTRATION_OVERSIZE' } };
        }
        records[registration.registrationId] = clone(registration);
        return { committed: true };
      });
    },

    async releaseDurable({ registrationId }) {
      await storeHandle.materializationTransaction('readwrite', (view) => {
        delete view.storeMeta.durableRegistrations[registrationId];
      });
      return { released: true };
    },

    effectivePolicy: effectivePolicyFor,

    async demandState(addressKey) {
      return (await effectivePolicyFor(addressKey)).demandState;
    },
  });
  defaultStandIn ??= ledger;
  return ledger;
}

const requireDefault = () => {
  if (defaultStandIn === null) {
    throw new Error('temporary registration-ledger stand-in has not been bound to a store');
  }
  return defaultStandIn;
};

// Named proxies preserve the parallel L3 seam's exact method names. L4 uses
// the per-store object returned above; these disappear with this stand-in.
export const applyContextDemands = (input) => requireDefault().applyContextDemands(input);
export const releaseContextDemands = (input) => requireDefault().releaseContextDemands(input);
export const registerDurable = (input) => requireDefault().registerDurable(input);
export const releaseDurable = (input) => requireDefault().releaseDurable(input);
export const effectivePolicy = (addressKey) => requireDefault().effectivePolicy(addressKey);
export const demandState = (addressKey) => requireDefault().demandState(addressKey);

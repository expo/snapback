// Transactional commit machinery loaded at materialization-store construction.
// The public module keeps the store types and constructor seam lightweight;
// the actual store family crosses this existing async construction boundary.

import { pendingOutboxRecords } from './outbox-shared.mjs';
import {
  prepareStoreMeta,
  RQS_STORE_META_KEY,
} from './rqs-store-meta.mjs';

const transactionInput = (mode, operation) => {
  if (mode !== 'readonly' && mode !== 'readwrite') {
    throw new TypeError('materialization transaction mode must be readonly or readwrite');
  }
  if (typeof operation !== 'function') {
    throw new TypeError('materialization transaction operation must be a function');
  }
};

const synchronousResult = (operation, view) => {
  const result = operation(view);
  if (result && typeof result.then === 'function') {
    throw new TypeError('materialization transaction callbacks must be synchronous');
  }
  return result;
};

export async function indexedDbMaterializationTransaction(input) {
  const [
    mode, operation, writer, closed, database, requestResult, readOutboxState,
    readMetaFromStore, storeError, transactionDone,
  ] = input;
  transactionInput(mode, operation);
  if (mode === 'readwrite' && (!writer || closed)) {
    throw storeError('SNAPBACK_RQS_STORE_NOT_WRITER', 'materialization writes require store ownership');
  }
  const db = await database();
  const names = ['materializations', 'pageSets', 'memberships', 'entries'];
  const tx = db.transaction([...names, 'outbox', 'storeMeta'], mode);
  const readSection = async (name) => {
    const section = tx.objectStore(name);
    const [keys, values] = await Promise.all([
      requestResult(section.getAllKeys()),
      requestResult(section.getAll()),
    ]);
    return new Map(keys.map((key, index) => [String(key), values[index]]));
  };
  try {
    const [materializations, pageSets, memberships, entries, outbox, storeMeta] = await Promise.all([
      ...names.map(readSection),
      readOutboxState(tx.objectStore('outbox')),
      readMetaFromStore(tx.objectStore('storeMeta')),
    ]);
    const view = { materializations, pageSets, memberships, entries, outbox, storeMeta };
    const result = synchronousResult(operation, view);
    if (mode === 'readwrite') {
      const preparedMeta = prepareStoreMeta(view.storeMeta);
      if (preparedMeta === null) {
        throw storeError('SNAPBACK_RQS_STORE_CORRUPT', 'materialization transaction produced invalid metadata');
      }
      for (const name of names) {
        const section = tx.objectStore(name);
        section.clear();
        for (const [key, value] of view[name]) section.put(value, key);
      }
      tx.objectStore('outbox').put(view.outbox, 'state');
      tx.objectStore('storeMeta').put(preparedMeta, RQS_STORE_META_KEY);
    }
    await transactionDone(tx);
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* transaction already completed/aborted */ }
    throw error;
  }
}

export async function fileMaterializationTransaction(input) {
  const [
    mode, operation, requireOpen, acquireLock, isWriter, readState,
    writeState, corruptError, blobPath,
  ] = input;
  requireOpen();
  transactionInput(mode, operation);
  await acquireLock();
  if (mode === 'readwrite' && !isWriter()) {
    const error = new Error('SNAPBACK_RQS_STORE_NOT_WRITER: materialization writes require store ownership');
    error.code = 'SNAPBACK_RQS_STORE_NOT_WRITER';
    throw error;
  }
  const state = await readState();
  const names = ['materializations', 'pageSets', 'memberships', 'entries'];
  const view = Object.fromEntries(names.map((name) => [
    name,
    new Map(Object.entries(structuredClone(state[name]))),
  ]));
  view.outbox = structuredClone(state.outbox);
  view.storeMeta = structuredClone(state.storeMeta);
  const result = synchronousResult(operation, view);
  if (mode === 'readwrite') {
    const preparedMeta = prepareStoreMeta(view.storeMeta);
    if (preparedMeta === null) throw corruptError(blobPath);
    await writeState({
      ...state,
      ...Object.fromEntries(names.map((name) => [name, Object.fromEntries(view[name])])),
      outbox: view.outbox,
      storeMeta: preparedMeta,
    });
  }
  return result;
}

export async function memoryMaterializationTransaction(input) {
  const [mode, operation, requireOpen, state, instance] = input;
  requireOpen();
  transactionInput(mode, operation);
  if (mode === 'readwrite' && state.writer !== instance) {
    const error = new Error('SNAPBACK_RQS_STORE_NOT_WRITER: materialization writes require store ownership');
    error.code = 'SNAPBACK_RQS_STORE_NOT_WRITER';
    throw error;
  }
  const names = ['materializations', 'pageSets', 'memberships', 'entries'];
  const view = Object.fromEntries(names.map((name) => [
    name,
    new Map(structuredClone([...state[name]])),
  ]));
  view.outbox = structuredClone(state.outbox);
  view.storeMeta = structuredClone(state.storeMeta);
  const result = synchronousResult(operation, view);
  if (mode === 'readwrite') {
    const preparedMeta = prepareStoreMeta(view.storeMeta);
    if (preparedMeta === null) {
      const error = new Error('SNAPBACK_RQS_STORE_CORRUPT: materialization transaction produced invalid metadata');
      error.code = 'SNAPBACK_RQS_STORE_CORRUPT';
      throw error;
    }
    for (const name of names) state[name] = view[name];
    state.outbox = view.outbox;
    state.storeMeta = preparedMeta;
  }
  return result;
}

export async function bootMaterializationStore(input) {
  const [
    storeHandle,
    loadFrom,
    resolveValidationContext,
    clone,
    plain,
    prepareTrustedActivation,
    verifySignatureCandidates,
    decodeRecord,
    refuse,
    removePayload,
    revalidateRetainedRecord,
    cache,
    snapshotFor,
  ] = input;
  const bootCandidates = await storeHandle.materializationTransaction('readonly', (view) => {
    const candidates = [];
    for (const [key] of view.materializations) {
      const record = loadFrom(view, key);
      if (record.productState.freshness !== 'retained') continue;
      let context = null;
      try {
        context = resolveValidationContext?.({
          address: clone(record.address),
          record: clone(record),
          phase: 'retained-boot',
        }) ?? null;
      } catch {
        context = null;
      }
      if (
        !plain(context)
        || context.trustedActivation === null
        || context.retentionEligible === false
      ) continue;
      try { prepareTrustedActivation(context.trustedActivation); } catch { continue; }
      for (const fragment of record.fragments) {
        candidates.push({ proof: fragment.proof, trustedActivation: context.trustedActivation });
      }
    }
    return candidates;
  });
  const bootSignatureReceipts = await verifySignatureCandidates(bootCandidates);
  await storeHandle.materializationTransaction(
    storeHandle.isWriter?.() === true ? 'readwrite' : 'readonly',
    (view) => {
      for (const [key, stored] of view.materializations) {
        const record = decodeRecord(stored);
        if (record === null) {
          refuse(
            'SNAPBACK_MATERIALIZATION_RECORD_INVALID',
            `stored materialization ${key} is invalid`,
          );
        }
        if (
          record.fragments.length > 0
          && (
            record.storageProfile === 'volatile-online-v1'
            || record.productState.freshness === 'current'
          )
        ) removePayload(view, key, record);
        const validated = record.productState.freshness === 'retained'
          ? revalidateRetainedRecord(
              view,
              key,
              record,
              resolveValidationContext,
              'retained-boot',
              bootSignatureReceipts,
            ).record
          : record;
        cache.set(key, snapshotFor(validated));
      }
    },
  );
  return bootSignatureReceipts;
}

export function commitPageInView(input) {
  const [
    view,
    key,
    admittedAddress,
    fragmentInput,
    proofInput,
    resolutionBundle,
    expectedFence,
    signatureReceipts,
    loadFrom,
    refuse,
    assertActive,
    assertFence,
    exact,
    prepareFragment,
    requireContext,
    resolveValidationContext,
    retainedAuthorityValid,
    validateProof,
    prepareMembership,
    applyOwnerInput,
    clone,
    snapshotFor,
    membershipKey,
    pageIdentityDigestV1,
    projectAuthority,
    encodeRecord,
    enforceMaterializationEnvelope,
    materializationLimits,
    now,
  ] = input;
  const record = loadFrom(view, key);
  if (record === null) {
    refuse('SNAPBACK_MATERIALIZATION_NOT_INITIALIZED', 'page commit cannot allocate an instance');
  }
  assertActive(record);
  assertFence(record, expectedFence);
  exact(fragmentInput, [
    'pageIdentityDigest', 'resultContractHash', 'bytes', 'authorizedLeaseHash',
    'memberships', 'freshness',
  ], 'fragment input');
  if (!['current', 'retained'].includes(fragmentInput.freshness)) {
    refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'fragment freshness is invalid');
  }
  if (fragmentInput.freshness === 'retained' && record.storageProfile !== 'durable-fragments-v1') {
    refuse(
      'SNAPBACK_MATERIALIZATION_STORAGE_PROFILE_GAP',
      'volatile-online-v1 cannot install retained payload',
      { requiredCapability: 'durable_fragments_v1' },
    );
  }
  if (!Array.isArray(fragmentInput.memberships)) {
    refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'fragment memberships must be an array');
  }
  const fragment = prepareFragment({
    pageIdentityDigest: fragmentInput.pageIdentityDigest,
    resultContractHash: fragmentInput.resultContractHash,
    bytes: fragmentInput.bytes,
    proof: proofInput,
    authorizedLeaseHash: fragmentInput.authorizedLeaseHash,
  });
  const context = requireContext(resolveValidationContext, admittedAddress, record, 'commit');
  fragment.proof = validateProof(record, fragment, proofInput, context, signatureReceipts);
  if (
    fragmentInput.freshness === 'retained'
    && !retainedAuthorityValid(
      context,
      fragmentInput.authorizedLeaseHash,
      fragment.proof,
    )
  ) {
    refuse(
      'SNAPBACK_COMPLETENESS_LEASE_INVALID',
      'retained commit lacks exact owner lease custody or a signed public-exact class proof',
    );
  }
  const memberships = fragmentInput.memberships.map(
    (entry, index) => prepareMembership(entry, `fragment.memberships[${index}]`),
  );
  for (const membership of memberships) {
    if (
      membership.materializationKey !== record.address[2]
      || membership.pageIdentityDigest !== fragment.pageIdentityDigest
    ) refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'membership does not bind the committed page');
  }
  if (resolutionBundle !== null) applyOwnerInput(view, key, record, resolutionBundle);
  if (record.authorityState.effective_disposition === 'delete') {
    return { value: clone(record), snapshot: snapshotFor(record) };
  }
  record.fragments = record.fragments.filter(
    (entry) => entry.pageIdentityDigest !== fragment.pageIdentityDigest,
  );
  record.fragments.push(fragment);
  record.memberships = record.memberships.filter(
    (entry) => entry.pageIdentityDigest !== fragment.pageIdentityDigest,
  );
  for (const [membershipKeyValue, entry] of view.memberships) {
    if (
      entry?.materializationKey === record.address[2]
      && entry?.pageIdentityDigest === fragment.pageIdentityDigest
    ) view.memberships.delete(membershipKeyValue);
  }
  for (const membership of memberships) {
    record.memberships.push(membership);
    view.memberships.set(membershipKey(key, membership), clone(membership));
  }
  record.productState.heldProofs = record.productState.heldProofs.filter((entry) => (
    pageIdentityDigestV1(entry.page) !== fragment.pageIdentityDigest
  ));
  record.productState.heldProofs.push(fragment.proof);
  record.productState.freshness = fragmentInput.freshness;
  record.productState.attempt = 'idle';
  projectAuthority(record, record.authorityState);
  view.materializations.set(key, encodeRecord(record));
  const budgetError = enforceMaterializationEnvelope(view, key, materializationLimits, now());
  const storedAfterBudget = loadFrom(view, key);
  return budgetError
    ? { error: budgetError, snapshot: snapshotFor(storedAfterBudget) }
    : { value: clone(storedAfterBudget), snapshot: snapshotFor(storedAfterBudget) };
}

export async function commitLegacyAdoption(input) {
  const [
    address,
    legacyKey,
    expectedLegacyRecord,
    fragmentInput,
    proofInput,
    resolutionBundle,
    expectedFence,
    preverifyAddressProofs,
    assertActive,
    assertFence,
    write,
    refuse,
    same,
    commitPageInView,
  ] = input;
  if (typeof legacyKey !== 'string' || legacyKey.length === 0) {
    refuse('SNAPBACK_SINGLE_TABLE_ADOPTION_LEGACY_MISMATCH', 'legacy adoption key is invalid');
  }
  const signatureReceipts = await preverifyAddressProofs(address, 'commit', (record) => {
    assertActive(record);
    assertFence(record, expectedFence);
    return [proofInput];
  });
  return write(address, (view, key, admittedAddress) => {
    if (!(view.entries instanceof Map)) {
      refuse(
        'SNAPBACK_SINGLE_TABLE_ADOPTION_DOMAIN_UNAVAILABLE',
        'carrier omits legacy entries from the materialization transaction',
      );
    }
    let pending;
    try { pending = pendingOutboxRecords(view.outbox); } catch { pending = [null]; }
    if (pending.length > 0) {
      refuse(
        'SNAPBACK_SINGLE_TABLE_ADOPTION_PENDING_OUTBOX',
        'legacy adoption waits for the durable mutation outbox to settle',
      );
    }
    const currentLegacyRecord = view.entries.get(legacyKey);
    if (currentLegacyRecord === undefined || !same(currentLegacyRecord, expectedLegacyRecord)) {
      refuse(
        'SNAPBACK_SINGLE_TABLE_ADOPTION_LEGACY_MISMATCH',
        'legacy adoption candidate changed before the atomic switch',
      );
    }
    const committed = commitPageInView(
      view,
      key,
      admittedAddress,
      fragmentInput,
      proofInput,
      resolutionBundle,
      expectedFence,
      signatureReceipts,
    );
    if (committed.error) throw committed.error;
    view.entries.delete(legacyKey);
    return committed;
  });
}

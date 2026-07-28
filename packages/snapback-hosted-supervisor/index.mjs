// The shared hosted supervisor is the only writer of target bindings, control
// heads, provider-effect journals, spend reservations, and cleanup authority.
//
// @ref LLP 0105#always-on-supervisor-and-canonical-single-writer-head — an
// independently fenced supervisor commits mirror then external anchor before
// an effect is capable.
// @ref LLP 0105#stable-planned-bindings-and-immutable-reconciliation —
// provider ids never alter pre-target semantic effect identity and uncertain
// attempts remain immutable after reconciliation.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from 'node:crypto';

export class SupervisorRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SupervisorRefusal';
    this.code = code;
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function plannedBindingDigest({
  journeyId,
  planDigest,
  logicalResourceNames,
  provider,
  region,
  ownershipSentinel,
}) {
  const body = canonicalJson({
    journeyId,
    planDigest,
    logicalResourceNames,
    provider,
    region,
    ownershipSentinel,
  });
  return sha256(Buffer.concat([Buffer.from('snapback:planned-binding:v1'), Buffer.from(body)]));
}

export function lifecycleRequestDigest(request) {
  const { transportBearer: _transportBearer, ...closed } = request;
  return sha256(Buffer.concat([
    Buffer.from('snapback:fly-lifecycle-request:v2\n'),
    Buffer.from(canonicalJson(closed)),
  ]));
}

export function semanticEffectId({
  operationId,
  operation,
  targetBindingDigest,
  planDigest,
  effectKind,
  resourceIdentity,
  desiredProviderState,
}) {
  const input = canonicalJson({
    operationId,
    operation,
    targetBindingDigest,
    planDigest,
    effectKind,
    resourceIdentity,
    desiredProviderState,
  });
  return createHash('sha256')
    .update('snapback:fly-semantic-effect:v1\n')
    .update(input)
    .digest('base64url');
}

function requireDigest(value, field) {
  if (!/^sha256:[0-9a-f]{64}$/.test(value ?? '')) {
    throw new SupervisorRefusal('SNAPBACK_HOSTED_DIGEST_INVALID', `${field} must be lowercase sha256`);
  }
}

function clone(value) {
  return structuredClone(value);
}

function headDigest(head) {
  return sha256(Buffer.from(canonicalJson(head)));
}

/**
 * Deterministic core behind the packed service. Durable adapters supply a
 * SQLite transaction, encrypted mirror PUT, and conditional anchor CAS; the
 * test adapter models their ordering and crash boundaries without provider
 * credentials.
 */
export class HostedSupervisor {
  constructor({
    installationReceipt,
    incarnation = randomUUID(),
    database = null,
    mirror = null,
    anchor = null,
  }) {
    if (!installationReceipt?.installationId || !installationReceipt?.standingRootAuthorizationSha256) {
      throw new SupervisorRefusal(
        'SNAPBACK_SUPERVISOR_INSTALLATION_REQUIRED',
        'a pre-provisioned supervisor installation receipt is required',
      );
    }
    this.installationReceipt = clone(installationReceipt);
    this.incarnation = incarnation;
    this.database = database ? clone(database) : {
      generation: 0,
      journal: [],
      effects: {},
      reconciliations: [],
      promotions: {},
      spendLedgers: {},
      cleanupPlans: {},
      heads: {},
      floors: { spend: 0, cleanup: 0, replay: 0 },
    };
    this.mirror = mirror ? clone(mirror) : null;
    this.anchor = anchor ? clone(anchor) : {
      incarnation,
      generation: 0,
      journalDigest: sha256(Buffer.from('[]')),
      spendFloor: 0,
      cleanupFloor: 0,
      replayFloor: 0,
      controlHeadDigest: sha256(Buffer.from('{}')),
    };
    this.assertRecovered();
  }

  assertRecovered() {
    if (this.anchor.incarnation !== this.incarnation) {
      throw new SupervisorRefusal(
        'SNAPBACK_SUPERVISOR_INCARNATION_FENCED',
        'external incarnation anchor belongs to another supervisor',
      );
    }
    if (this.anchor.generation > this.database.generation) {
      if (!this.mirror || this.mirror.generation !== this.anchor.generation) {
        throw new SupervisorRefusal(
          'SNAPBACK_SUPERVISOR_RECONSTRUCTION_REQUIRED',
          'external anchor is ahead and no matching encrypted mirror is available',
        );
      }
      this.database = clone(this.mirror.database);
    }
    if (this.database.generation > this.anchor.generation) {
      throw new SupervisorRefusal(
        'SNAPBACK_SUPERVISOR_UNCOMMITTED_DATABASE',
        'database state without a matching external anchor cannot effect',
      );
    }
    for (const [field, key] of [['spendFloor', 'spend'], ['cleanupFloor', 'cleanup'], ['replayFloor', 'replay']]) {
      if (this.database.floors[key] < this.anchor[field]) {
        throw new SupervisorRefusal(
          'SNAPBACK_SUPERVISOR_FLOOR_REGRESSION',
          `${key} floor is behind the external anchor`,
        );
      }
    }
  }

  assertEffectAuthority() {
    this.assertRecovered();
    if (this.anchor.incarnation !== this.incarnation) {
      throw new SupervisorRefusal('SNAPBACK_SUPERVISOR_INCARNATION_FENCED', 'stale supervisor');
    }
  }

  /**
   * Commit ordering: SQLite -> encrypted mirror -> external CAS. `interruptAt`
   * exists only for the deterministic crash corpus.
   */
  commit(mutator, { interruptAt = null } = {}) {
    this.assertEffectAuthority();
    const previous = clone(this.database);
    const next = clone(this.database);
    mutator(next);
    next.generation += 1;
    next.floors.spend = Math.max(previous.floors.spend, next.floors.spend);
    next.floors.cleanup = Math.max(previous.floors.cleanup, next.floors.cleanup);
    next.floors.replay = Math.max(previous.floors.replay, next.floors.replay);
    this.database = next;
    if (interruptAt === 'afterSqlite') {
      throw new SupervisorRefusal('SNAPBACK_SUPERVISOR_INTERRUPTED', 'interrupted after SQLite commit');
    }
    const journalDigest = sha256(Buffer.from(canonicalJson(next.journal)));
    this.mirror = { generation: next.generation, database: clone(next), journalDigest };
    if (interruptAt === 'afterMirror') {
      throw new SupervisorRefusal('SNAPBACK_SUPERVISOR_INTERRUPTED', 'interrupted after mirror write');
    }
    if (this.anchor.generation !== previous.generation || this.anchor.incarnation !== this.incarnation) {
      throw new SupervisorRefusal('SNAPBACK_SUPERVISOR_ANCHOR_CAS_FAILED', 'external anchor changed');
    }
    this.anchor = {
      incarnation: this.incarnation,
      generation: next.generation,
      journalDigest,
      spendFloor: next.floors.spend,
      cleanupFloor: next.floors.cleanup,
      replayFloor: next.floors.replay,
      controlHeadDigest: sha256(Buffer.from(canonicalJson(next.heads))),
    };
    if (interruptAt === 'afterAnchor') {
      throw new SupervisorRefusal('SNAPBACK_SUPERVISOR_INTERRUPTED', 'interrupted after anchor CAS');
    }
    return clone(next);
  }

  createSpendLedger({
    journeyId,
    currency,
    tariffSource,
    tariffObservedAtMs,
    maximumMicros,
    cleanupReserveMicros,
  }) {
    if (cleanupReserveMicros <= 0 || cleanupReserveMicros >= maximumMicros) {
      throw new SupervisorRefusal('SNAPBACK_HOSTED_SPEND_INVALID', 'cleanup reserve must be positive and bounded');
    }
    return this.commit((db) => {
      if (db.spendLedgers[journeyId]) {
        throw new SupervisorRefusal('SNAPBACK_HOSTED_SPEND_EXISTS', 'journey ledger already exists');
      }
      db.spendLedgers[journeyId] = {
        schemaVersion: 'snapback.hosted-spend-ledger.v1',
        journeyId,
        currency,
        tariffSource,
        tariffObservedAtMs,
        maximumMicros,
        remainingMicros: maximumMicros - cleanupReserveMicros,
        cleanupReserveMicros,
        grants: [],
      };
      db.floors.cleanup += cleanupReserveMicros;
    }).spendLedgers[journeyId];
  }

  reserveSpend({
    journeyId,
    grantId,
    planDigest,
    targetOrPlannedBindingDigest,
    semanticEffectIds,
    maximumMicros,
  }) {
    requireDigest(planDigest, 'planDigest');
    return this.commit((db) => {
      const ledger = db.spendLedgers[journeyId];
      if (!ledger) throw new SupervisorRefusal('SNAPBACK_HOSTED_SPEND_MISSING', 'spend ledger is missing');
      if (ledger.grants.some((grant) => grant.grantId === grantId)) {
        throw new SupervisorRefusal('SNAPBACK_HOSTED_SPEND_GRANT_REUSED', 'grant ids are one-use');
      }
      if (maximumMicros > ledger.remainingMicros) {
        throw new SupervisorRefusal('SNAPBACK_HOSTED_SPEND_EXCEEDED', 'reservation exceeds remaining spend');
      }
      ledger.remainingMicros -= maximumMicros;
      ledger.grants.push({
        grantId,
        journeyId,
        planDigest,
        targetOrPlannedBindingDigest,
        semanticEffectIds: [...new Set(semanticEffectIds)].sort(),
        maximumMicros,
        heldMicros: maximumMicros,
        state: 'reserved',
      });
      db.floors.spend += maximumMicros;
    }).spendLedgers[journeyId];
  }

  appendIntent(intent, { journeyId, grantId, interruptAt = null } = {}) {
    requireDigest(intent.requestDigest, 'requestDigest');
    this.assertEffectAuthority();
    const existing = this.database.effects[intent.semanticEffectId];
    if (existing) {
      if (canonicalJson(existing.intent) !== canonicalJson(intent)) {
        throw new SupervisorRefusal('SNAPBACK_PROVIDER_EFFECT_ID_COLLISION', 'semantic effect id changed meaning');
      }
      return clone(existing);
    }
    const result = this.commit((db) => {
      const ledger = db.spendLedgers[journeyId];
      const grant = ledger?.grants.find((candidate) => candidate.grantId === grantId);
      if (!grant || grant.state !== 'reserved' || !grant.semanticEffectIds.includes(intent.semanticEffectId)) {
        throw new SupervisorRefusal('SNAPBACK_HOSTED_SPEND_AUTHORITY_REQUIRED', 'effect lacks a reserved one-use grant');
      }
      grant.state = 'effecting';
      db.effects[intent.semanticEffectId] = { intent: clone(intent), observations: [], terminal: null };
      db.journal.push({ kind: 'intent', ...clone(intent) });
    }, { interruptAt });
    return clone(result.effects[intent.semanticEffectId]);
  }

  markEffecting(semanticEffectId, observation, options = {}) {
    return this.commit((db) => {
      const effect = db.effects[semanticEffectId];
      if (!effect || effect.terminal) {
        throw new SupervisorRefusal('SNAPBACK_PROVIDER_EFFECT_STATE_INVALID', 'effect is not open');
      }
      effect.observations.push(clone(observation));
      db.journal.push({ kind: 'effecting', semanticEffectId, ...clone(observation) });
    }, options).effects[semanticEffectId];
  }

  appendTerminal(semanticEffectId, terminal, { journeyId, grantId, ...options } = {}) {
    return this.commit((db) => {
      const effect = db.effects[semanticEffectId];
      if (!effect) throw new SupervisorRefusal('SNAPBACK_PROVIDER_EFFECT_MISSING', 'intent is missing');
      if (effect.terminal) {
        if (canonicalJson(effect.terminal) !== canonicalJson(terminal)) {
          throw new SupervisorRefusal('SNAPBACK_PROVIDER_EFFECT_TERMINAL_IMMUTABLE', 'terminal already retained');
        }
        return;
      }
      if (!['notApplied', 'applied', 'commitUncertain'].includes(terminal.outcome)) {
        throw new SupervisorRefusal('SNAPBACK_PROVIDER_EFFECT_TERMINAL_INVALID', 'unknown terminal outcome');
      }
      effect.terminal = clone(terminal);
      db.journal.push({ kind: 'terminal', semanticEffectId, ...clone(terminal) });
      const ledger = db.spendLedgers[journeyId];
      const grant = ledger?.grants.find((candidate) => candidate.grantId === grantId);
      if (!grant || grant.state !== 'effecting') {
        throw new SupervisorRefusal('SNAPBACK_HOSTED_SPEND_STATE_INVALID', 'effect grant is not effecting');
      }
      if (terminal.outcome === 'notApplied') {
        grant.state = 'released';
        ledger.remainingMicros += grant.heldMicros;
        grant.heldMicros = 0;
      } else if (terminal.outcome === 'applied') {
        grant.state = 'consumed';
        grant.heldMicros = terminal.consumedMicros ?? grant.heldMicros;
      } else {
        grant.state = 'commitUncertain';
      }
    }, options).effects[semanticEffectId];
  }

  reconcileEffect(semanticEffectId, reconciliation, options = {}) {
    return this.commit((db) => {
      const effect = db.effects[semanticEffectId];
      if (!effect || effect.terminal?.outcome !== 'commitUncertain') {
        throw new SupervisorRefusal('SNAPBACK_PROVIDER_EFFECT_RECONCILE_INVALID', 'only uncertain effects reconcile');
      }
      if (!['notApplied', 'applied'].includes(reconciliation.resolvedOutcome)) {
        throw new SupervisorRefusal('SNAPBACK_PROVIDER_EFFECT_RECONCILE_UNKNOWN', 'reconciliation must prove a terminal fact');
      }
      if (db.reconciliations.some((entry) => entry.reconciliationId === reconciliation.reconciliationId)) {
        throw new SupervisorRefusal('SNAPBACK_PROVIDER_EFFECT_RECONCILIATION_REUSED', 'reconciliation id already retained');
      }
      db.reconciliations.push(clone(reconciliation));
      db.journal.push({ kind: 'reconciliation', semanticEffectId, ...clone(reconciliation) });
    }, options).reconciliations.at(-1);
  }

  promotePlannedBinding({
    journeyId,
    plannedBindingDigest: digest,
    logicalResourceNames,
    provider,
    region,
    ownershipSentinel,
    logicalResourceIds,
    targetBindingDigest,
  }) {
    const expectedNames = [...logicalResourceNames].sort();
    const promotedNames = logicalResourceIds.map(({ logicalName }) => logicalName).sort();
    if (
      new Set(expectedNames).size !== expectedNames.length
      || new Set(promotedNames).size !== promotedNames.length
      || canonicalJson(expectedNames) !== canonicalJson(promotedNames)
    ) {
      throw new SupervisorRefusal(
        'SNAPBACK_PLANNED_BINDING_PROMOTION_INVALID',
        'promotion must map every closed logical resource exactly once',
      );
    }
    return this.commit((db) => {
      if (db.promotions[digest]) {
        throw new SupervisorRefusal('SNAPBACK_PLANNED_BINDING_PROMOTION_REUSED', 'planned binding already promoted');
      }
      db.promotions[digest] = {
        schemaVersion: 'snapback.planned-binding-promotion.v1',
        journeyId,
        plannedBindingSha256: digest,
        provider,
        region,
        ownershipSentinel,
        logicalResourceIds: clone(logicalResourceIds),
        targetBindingSha256: targetBindingDigest,
      };
    }).promotions[digest];
  }

  admitRoster({
    targetId,
    expectedMachineId,
    machines,
    autoscaleEnabled,
    observedAtMs,
    expiresAtMs,
  }) {
    const routed = machines.filter((machine) => machine.productionRouted === true);
    const unsafe = (
      autoscaleEnabled
      || routed.length !== 1
      || routed[0]?.id !== expectedMachineId
      || expiresAtMs <= observedAtMs
    );
    if (unsafe) {
      throw new SupervisorRefusal(
        'SNAPBACK_EPHEMERAL_ROUTING_UNSAFE',
        'protected hosted serving requires one fresh exact routed Machine',
      );
    }
    return {
      targetId,
      machineId: expectedMachineId,
      exactRosterSha256: sha256(Buffer.from(canonicalJson(machines))),
      observedAtMs,
      expiresAtMs,
      allProtectedServingAdmitted: true,
    };
  }

  planCleanup({
    cleanupPlanId,
    journeyId,
    targetOrPlannedBindingDigest,
    ownershipSentinel,
    inventory,
    cleanupReserveMicros,
    confirmationSha256,
  }) {
    const resources = inventory.filter((resource) => resource.ownershipSentinel === ownershipSentinel);
    if (resources.length !== inventory.length) {
      throw new SupervisorRefusal('SNAPBACK_CLEANUP_FOREIGN_RESOURCE', 'cleanup inventory contains foreign resources');
    }
    const inventorySha256 = sha256(Buffer.from(canonicalJson(resources)));
    return this.commit((db) => {
      db.cleanupPlans[cleanupPlanId] = {
        schemaVersion: 'snapback.vm-adapter-cleanup-plan.v1',
        cleanupPlanId,
        journeyId,
        targetOrPlannedBindingSha256: targetOrPlannedBindingDigest,
        ownershipSentinel,
        resources: clone(resources),
        cleanupReserveMicros,
        inventorySha256,
        confirmationSha256,
        confirmed: false,
        applied: false,
      };
    }).cleanupPlans[cleanupPlanId];
  }

  confirmCleanup(cleanupPlanId, { inventorySha256, confirmationSha256 }) {
    return this.commit((db) => {
      const plan = db.cleanupPlans[cleanupPlanId];
      if (!plan || plan.inventorySha256 !== inventorySha256 || plan.confirmationSha256 !== confirmationSha256) {
        throw new SupervisorRefusal('SNAPBACK_CLEANUP_CONFIRMATION_INVALID', 'cleanup confirmation drifted');
      }
      plan.confirmed = true;
    }).cleanupPlans[cleanupPlanId];
  }

  applyCleanup(cleanupPlanId, absenceObservations) {
    return this.commit((db) => {
      const plan = db.cleanupPlans[cleanupPlanId];
      if (!plan?.confirmed || plan.applied) {
        throw new SupervisorRefusal('SNAPBACK_CLEANUP_STATE_INVALID', 'cleanup is not confirmed or already applied');
      }
      const expected = plan.resources.filter((resource) => resource.disposition === 'delete').map((r) => r.providerId).sort();
      const absent = absenceObservations.filter((fact) => fact.absent).map((fact) => fact.providerId).sort();
      if (canonicalJson(expected) !== canonicalJson(absent)) {
        throw new SupervisorRefusal('SNAPBACK_CLEANUP_INCOMPLETE', 'provider absence proof is incomplete');
      }
      plan.applied = true;
      plan.absenceProofSha256 = sha256(Buffer.from(canonicalJson(absenceObservations)));
      db.floors.cleanup += 1;
    }).cleanupPlans[cleanupPlanId];
  }
}

function exportPublicKey(key) {
  return key.export({ format: 'der', type: 'spki' }).toString('base64url');
}

function importPublicKey(value) {
  return createPublicKey({ key: Buffer.from(value, 'base64url'), format: 'der', type: 'spki' });
}

function exportPrivateKey(key) {
  return key.export({ format: 'der', type: 'pkcs8' }).toString('base64url');
}

function importPrivateKey(value) {
  return createPrivateKey({ key: Buffer.from(value, 'base64url'), format: 'der', type: 'pkcs8' });
}

export function createCertificateRecipient({
  journeyId,
  plannedBindingDigest: bindingDigest,
  successorMachineId,
  successorVolumeId,
  bindingGeneration,
  expiresAtMs,
}) {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    attestation: {
      schemaVersion: 'snapback.tls-certificate-recipient.v1',
      journeyId,
      plannedBindingSha256: bindingDigest,
      successorMachineId,
      successorVolumeId,
      bindingGeneration,
      expiresAtMs,
      publicKey: exportPublicKey(publicKey),
    },
    // The caller keeps this only in successor process memory.
    privateKey: exportPrivateKey(privateKey),
  };
}

function aeadSeal(key, plaintext, aad) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce, ciphertext, tag: cipher.getAuthTag() };
}

function aeadOpen(key, sealed, aad) {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
}

export function sealCertificateTransfer({
  attestation,
  manifest,
  plaintextBundle,
  nowMs,
  predecessorMachineId,
  expected,
}) {
  if (
    nowMs >= attestation.expiresAtMs
    || attestation.successorMachineId !== expected.successorMachineId
    || attestation.successorVolumeId !== expected.successorVolumeId
    || attestation.bindingGeneration !== expected.bindingGeneration
    || expected.successorRouted
  ) {
    throw new SupervisorRefusal('SNAPBACK_TLS_RECIPIENT_INVALID', 'certificate recipient attestation refused');
  }
  const { publicKey: wrappingPublic, privateKey: wrappingPrivate } = generateKeyPairSync('x25519');
  const shared = diffieHellman({ privateKey: wrappingPrivate, publicKey: importPublicKey(attestation.publicKey) });
  const kek = createHash('sha256').update('snapback:tls-wrap:v1').update(shared).digest();
  const dataKey = randomBytes(32);
  const aad = Buffer.from(canonicalJson({ attestation, manifest, predecessorMachineId }));
  const object = aeadSeal(dataKey, Buffer.from(plaintextBundle), aad);
  const wrappedKey = aeadSeal(kek, dataKey, aad);
  dataKey.fill(0);
  return {
    schemaVersion: 'snapback.tls-certificate-transfer.v1',
    attestation: clone(attestation),
    predecessorMachineId,
    manifest: clone(manifest),
    wrappingPublicKey: exportPublicKey(wrappingPublic),
    ciphertext: object.ciphertext.toString('base64url'),
    ciphertextNonce: object.nonce.toString('base64url'),
    ciphertextTag: object.tag.toString('base64url'),
    wrappedKey: wrappedKey.ciphertext.toString('base64url'),
    wrappedKeyNonce: wrappedKey.nonce.toString('base64url'),
    wrappedKeyTag: wrappedKey.tag.toString('base64url'),
    ciphertextSha256: sha256(object.ciphertext),
  };
}

export function openCertificateTransfer({ transfer, successorPrivateKey, nowMs }) {
  if (nowMs >= transfer.attestation.expiresAtMs) {
    throw new SupervisorRefusal('SNAPBACK_TLS_TRANSFER_EXPIRED', 'certificate transfer expired');
  }
  const privateKey = importPrivateKey(successorPrivateKey);
  const shared = diffieHellman({ privateKey, publicKey: importPublicKey(transfer.wrappingPublicKey) });
  const kek = createHash('sha256').update('snapback:tls-wrap:v1').update(shared).digest();
  const aad = Buffer.from(canonicalJson({
    attestation: transfer.attestation,
    manifest: transfer.manifest,
    predecessorMachineId: transfer.predecessorMachineId,
  }));
  const dataKey = aeadOpen(kek, {
    nonce: Buffer.from(transfer.wrappedKeyNonce, 'base64url'),
    ciphertext: Buffer.from(transfer.wrappedKey, 'base64url'),
    tag: Buffer.from(transfer.wrappedKeyTag, 'base64url'),
  }, aad);
  try {
    return aeadOpen(dataKey, {
      nonce: Buffer.from(transfer.ciphertextNonce, 'base64url'),
      ciphertext: Buffer.from(transfer.ciphertext, 'base64url'),
      tag: Buffer.from(transfer.ciphertextTag, 'base64url'),
    }, aad);
  } finally {
    dataKey.fill(0);
  }
}

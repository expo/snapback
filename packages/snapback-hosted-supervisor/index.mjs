// The shared hosted supervisor is the only writer of target bindings, control
// heads, provider-effect journals, spend reservations, and cleanup authority.
//
// @ref LLP 0111#always-on-supervisor-and-canonical-single-writer-head — an
// independently fenced supervisor commits mirror then external anchor before
// an effect is capable.
// @ref LLP 0111#stable-planned-bindings-and-immutable-reconciliation —
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
  const {
    transportBearer: _transportBearer,
    requestSha256: _requestSha256,
    effectIntent,
    ...rest
  } = request;
  const {
    requestSha256: _intentRequestSha256,
    ...intentPreimage
  } = effectIntent ?? {};
  const closed = {
    ...rest,
    effectIntent: intentPreimage,
  };
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
  logicalResourceName,
  desiredProviderStateSha256,
}) {
  const input = canonicalJson({
    operationId,
    operation,
    targetBindingDigest,
    planDigest,
    effectKind,
    logicalResourceName,
    desiredProviderStateSha256,
  });
  return createHash('sha256')
    .update('snapback:fly-semantic-effect:v1\n')
    .update(input)
    .digest('base64url');
}

export function machineIsProductionRouted(machine, serviceProcessGroups) {
  const services = [
    ...(machine.config?.services ?? []),
    ...(machine.config?.containers ?? []).flatMap((container) => container.services ?? []),
  ];
  return services.some((service) => {
    const processes = service.processes ?? [];
    return processes.length === 0
      || processes.some((process) => serviceProcessGroups.includes(process));
  });
}

export function verifyBoundFlyMachineRoster(binding, machines) {
  if (!Array.isArray(machines)) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_FLY_ROSTER_INVALID',
      'Fly roster response is not an array',
    );
  }
  const observedRoster = machines.map((machine) => String(machine.id)).sort();
  const boundRoster = [...binding.machineRoster].sort();
  if (canonicalJson(observedRoster) !== canonicalJson(boundRoster)) {
    throw new SupervisorRefusal(
      'SNAPBACK_EPHEMERAL_ROUTING_UNSAFE',
      'Fly roster drifted from the generation-fenced target binding',
    );
  }
  const active = machines.find((machine) => String(machine.id) === binding.activeMachineId);
  const services = [
    ...(active?.config?.services ?? []),
    ...(active?.config?.containers ?? [])
      .flatMap((container) => container.services ?? []),
  ];
  const serviceProcessGroups = [...new Set(
    services.flatMap((service) => service.processes ?? []),
  )].sort();
  const boundProcessGroups = [...new Set(binding.serviceProcessGroups)].sort();
  const mounts = active?.config?.mounts ?? [];
  const image = String(active?.config?.image ?? '');
  const autostop = (service) => (
    service.autostop === true
    || service.autostop === 'stop'
    || service.autostop === 'suspend'
  );
  const exactActiveConfig = (
    active
    && active.state === 'started'
    && active.region === binding.region
    && (
      image.endsWith(`@${binding.ociDigest}`)
      || image === `${binding.ociRepository}@${binding.ociDigest}`
    )
    && mounts.length === 1
    && String(mounts[0].volume) === binding.volumeId
    && services.length > 0
    && canonicalJson(serviceProcessGroups) === canonicalJson(boundProcessGroups)
    && services.every((service) => autostop(service) === binding.autostopEnabled)
    && services.every(
      (service) => Boolean(service.autostart) === binding.autostartEnabled,
    )
  );
  if (!exactActiveConfig) {
    throw new SupervisorRefusal(
      'SNAPBACK_HOSTED_ACTIVE_MACHINE_CONFIG_DRIFTED',
      'active Fly Machine image, volume, region, route, or autostart posture drifted',
    );
  }
  return active;
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

function requireClosedKeys(value, keys, label) {
  if (
    !value
    || Array.isArray(value)
    || typeof value !== 'object'
    || Object.keys(value).some((key) => !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new SupervisorRefusal(
      'SNAPBACK_FLY_TARGET_BINDING_INVALID',
      `${label} is not the closed version-2 shape`,
    );
  }
}

const FLY_TARGET_BINDING_KEYS = [
  'schemaVersion', 'targetId', 'bindingGeneration',
  'predecessorBindingSha256', 'organizationId', 'appId', 'region',
  'publicOrigin', 'activeMachineId', 'machineRoster', 'routedMachineIds',
  'serviceProcessGroups', 'autostopEnabled', 'autostartEnabled',
  'autoscaleEnabled', 'volumeId', 'ociRepository', 'ociDigest',
  'tigrisBucket', 'artifactPrefix', 'backupPrefix', 'controlStatePrefix',
  'auditPrefix', 'logPrefix', 'cleanupPrefix', 'tlsIssuer',
  'certificatePosture', 'externalHeadKey', 'ownershipSentinel',
  'supervisorInstallationId', 'supervisorOciDigest', 'credentials',
  'observedAtMs', 'expiresAtMs',
];

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
      controlHeads: {},
      targetEnrollments: {},
      targetBootAdmissions: {},
      floors: { spend: 0, cleanup: 0, replay: 0 },
    };
    this.database.targetEnrollments ??= {};
    this.database.targetBootAdmissions ??= {};
    this.database.controlHeads ??= {};
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
      controlHeadDigest: sha256(Buffer.from(canonicalJson(next.controlHeads))),
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
    confirmationDigest = null,
    semanticEffectIds,
    maximumMicros,
  }) {
    requireDigest(planDigest, 'planDigest');
    requireDigest(targetOrPlannedBindingDigest, 'targetOrPlannedBindingDigest');
    if (confirmationDigest !== null) requireDigest(confirmationDigest, 'confirmationDigest');
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
        confirmationDigest,
        semanticEffectIds: [...new Set(semanticEffectIds)].sort(),
        maximumMicros,
        heldMicros: maximumMicros,
        state: 'reserved',
      });
      db.floors.spend += maximumMicros;
    }).spendLedgers[journeyId];
  }

  appendIntent(intent, {
    journeyId,
    grantId,
    targetOrPlannedBindingDigest,
    confirmationDigest = null,
    interruptAt = null,
  } = {}) {
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
      if (
        !grant
        || grant.state !== 'reserved'
        || grant.journeyId !== journeyId
        || grant.planDigest !== intent.planSha256
        || grant.targetOrPlannedBindingDigest !== targetOrPlannedBindingDigest
        || grant.confirmationDigest !== confirmationDigest
        || !grant.semanticEffectIds.includes(intent.semanticEffectId)
      ) {
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

  appendTerminal(semanticEffectId, terminal, {
    journeyId,
    grantId,
    retainedResponse = null,
    ...options
  } = {}) {
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
      effect.retainedResponse = retainedResponse === null ? null : clone(retainedResponse);
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

  registerTargetBinding(binding) {
    requireClosedKeys(binding, FLY_TARGET_BINDING_KEYS, 'Fly target binding');
    if (
      !Array.isArray(binding.machineRoster)
      || !Array.isArray(binding.routedMachineIds)
      || !Array.isArray(binding.serviceProcessGroups)
      || !Array.isArray(binding.credentials)
    ) {
      throw new SupervisorRefusal(
        'SNAPBACK_FLY_TARGET_BINDING_INVALID',
        'Fly target binding roster and credential members must be arrays',
      );
    }
    for (const credential of binding.credentials) {
      requireClosedKeys(
        credential,
        ['role', 'credentialRef', 'fingerprint', 'allowedVerbs', 'resourcePrefixes'],
        'Fly credential binding',
      );
      if (
        typeof credential.role !== 'string'
        || typeof credential.credentialRef !== 'string'
        || !/^sha256:[0-9a-f]{64}$/.test(credential.fingerprint)
        || !Array.isArray(credential.allowedVerbs)
        || !Array.isArray(credential.resourcePrefixes)
      ) {
        throw new SupervisorRefusal(
          'SNAPBACK_FLY_TARGET_BINDING_INVALID',
          'Fly credential binding is incomplete',
        );
      }
    }
    const existing = this.database.heads[binding.targetId]?.binding ?? null;
    const expectedGeneration = existing ? existing.bindingGeneration + 1 : 1;
    const expectedPredecessor = existing
      ? sha256(Buffer.from(canonicalJson(existing)))
      : null;
    const roster = [...binding.machineRoster].sort();
    const routed = [...binding.routedMachineIds].sort();
    const credentialRoles = binding.credentials.map((credential) => credential.role);
    if (
      binding.schemaVersion !== 'snapback.fly-target-binding.v2'
      || binding.supervisorInstallationId !== this.installationReceipt.installationId
      || binding.bindingGeneration !== expectedGeneration
      || binding.predecessorBindingSha256 !== expectedPredecessor
      || !/^sha256:[0-9a-f]{64}$/.test(binding.ociDigest)
      || !/^sha256:[0-9a-f]{64}$/.test(binding.supervisorOciDigest)
      || new Set(roster).size !== roster.length
      || new Set(routed).size !== routed.length
      || routed.length !== 1
      || routed[0] !== binding.activeMachineId
      || !roster.includes(binding.activeMachineId)
      || binding.autoscaleEnabled
      || new Set(credentialRoles).size !== credentialRoles.length
      || !Number.isSafeInteger(binding.observedAtMs)
      || !Number.isSafeInteger(binding.expiresAtMs)
      || binding.expiresAtMs <= binding.observedAtMs
    ) {
      throw new SupervisorRefusal(
        'SNAPBACK_FLY_TARGET_BINDING_INVALID',
        'Fly target binding is stale, ambiguous, unsafe, or belongs to another supervisor',
      );
    }
    const bindingSha256 = sha256(Buffer.from(canonicalJson(binding)));
    return this.commit((db) => {
      db.heads[binding.targetId] = {
        schemaVersion: 'snapback.hosted-target-head.v1',
        binding: clone(binding),
        bindingSha256,
      };
      db.journal.push({
        kind: 'targetBinding',
        targetId: binding.targetId,
        bindingGeneration: binding.bindingGeneration,
        bindingSha256,
        predecessorBindingSha256: binding.predecessorBindingSha256,
      });
    }).heads[binding.targetId];
  }

  registerControlHead(head) {
    requireClosedKeys(head, [
      'activationGeneration',
      'activeReleaseId',
      'admissionGeneration',
      'bindingSha256',
      'cleanupFloor',
      'committedAtMs',
      'generation',
      'journalRootSha256',
      'predecessorSha256',
      'replayFloor',
      'schemaVersion',
      'spendFloor',
      'supervisorIncarnation',
      'targetId',
    ], 'Hosted control head');
    if (
      head.schemaVersion !== 'snapback.hosted-control-head.v2'
      || !this.database.heads[head.targetId]
      || head.bindingSha256 !== this.database.heads[head.targetId].bindingSha256
    ) {
      throw new SupervisorRefusal(
        'SNAPBACK_HOSTED_CONTROL_HEAD_INVALID',
        'control head does not bind an exact registered target generation',
      );
    }
    const previous = this.database.controlHeads[head.targetId] ?? null;
    if (
      previous !== null
      && (
        head.generation !== previous.generation + 1
        || head.predecessorSha256 !== headDigest(previous)
      )
    ) {
      throw new SupervisorRefusal(
        'SNAPBACK_HOSTED_CONTROL_HEAD_PREDECESSOR_MISMATCH',
        'control head is not the exact monotone successor',
      );
    }
    if (
      previous === null
      && (head.generation !== 0 || head.predecessorSha256 !== null)
    ) {
      throw new SupervisorRefusal(
        'SNAPBACK_HOSTED_CONTROL_HEAD_PREDECESSOR_MISMATCH',
        'first control head must be generation zero with no predecessor',
      );
    }
    return this.commit((db) => {
      db.controlHeads[head.targetId] = clone(head);
      db.journal.push({
        kind: 'controlHead',
        targetId: head.targetId,
        controlHeadSha256: headDigest(head),
      });
    }).controlHeads[head.targetId];
  }

  registerHostedTargetEnrollment(enrollment) {
    const keys = [
      'schemaVersion',
      'targetId',
      'deploymentId',
      'publicOrigin',
      'firstContactTransport',
      'admissionPublicKey',
      'supportSha256',
      'signingSeedCredentialRef',
      'clientCertificateSha256',
    ];
    requireClosedKeys(enrollment, keys, 'hosted target enrollment');
    const head = this.database.heads[enrollment.targetId];
    if (
      enrollment.schemaVersion !== 'snapback.hosted-target-enrollment.v1'
      || !head
      || head.binding?.publicOrigin !== enrollment.publicOrigin
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(enrollment.deploymentId ?? '')
    ) {
      throw new SupervisorRefusal(
        'SNAPBACK_HOSTED_TARGET_ENROLLMENT_INVALID',
        'enrollment does not match a current exact target binding',
      );
    }
    const existing = this.database.targetEnrollments[enrollment.targetId];
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(enrollment)) {
        throw new SupervisorRefusal(
          'SNAPBACK_HOSTED_TARGET_ENROLLMENT_IMMUTABLE',
          'a target enrollment cannot change under one target identity',
        );
      }
      return clone(existing);
    }
    return this.commit((db) => {
      db.targetEnrollments[enrollment.targetId] = clone(enrollment);
      db.journal.push({
        kind: 'hostedTargetEnrollment',
        targetId: enrollment.targetId,
        deploymentId: enrollment.deploymentId,
        enrollmentSha256: sha256(Buffer.from(canonicalJson(enrollment))),
      });
    }).targetEnrollments[enrollment.targetId];
  }

  reserveOnlineAdmission({
    targetId,
    machineId,
    processBootId,
    providerFactsSha256,
    issuedAtMs,
  }) {
    requireDigest(providerFactsSha256, 'providerFactsSha256');
    if (
      !this.database.targetEnrollments[targetId]
      || !this.database.heads[targetId]
      || this.database.heads[targetId].binding.activeMachineId !== machineId
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        processBootId ?? '',
      )
      || !Number.isSafeInteger(issuedAtMs)
      || issuedAtMs < 1
    ) {
      throw new SupervisorRefusal(
        'SNAPBACK_HOSTED_ADMISSION_INVALID',
        'online admission does not match the enrolled routed process',
      );
    }
    const current = this.database.targetBootAdmissions[targetId] ?? null;
    const sameBoot = current
      && current.machineId === machineId
      && current.processBootId === processBootId;
    if (sameBoot && issuedAtMs <= current.lastIssuedAtMs) {
      throw new SupervisorRefusal(
        'SNAPBACK_HOSTED_ADMISSION_REPLAYED',
        'online admission clock did not advance',
      );
    }
    return this.commit((db) => {
      const previous = db.targetBootAdmissions[targetId] ?? null;
      const next = {
        machineId,
        processBootId,
        admissionEpoch: sameBoot ? previous.admissionEpoch : db.floors.replay + 1,
        senderReplayEpochFloor: sameBoot
          ? previous.senderReplayEpochFloor
          : db.floors.replay + 1,
        lastIssuedAtMs: issuedAtMs,
        providerFactsSha256,
      };
      db.targetBootAdmissions[targetId] = next;
      db.floors.replay = Math.max(db.floors.replay, next.senderReplayEpochFloor);
      db.journal.push({
        kind: 'onlineAdmission',
        targetId,
        machineId,
        processBootId,
        admissionEpoch: next.admissionEpoch,
        senderReplayEpochFloor: next.senderReplayEpochFloor,
        issuedAtMs,
        providerFactsSha256,
      });
    }).targetBootAdmissions[targetId];
  }

  admitRoster({
    targetId,
    expectedMachineId,
    machines,
    autoscaleEnabled,
    observedAtMs,
    expiresAtMs,
  }) {
    if (
      !Array.isArray(machines)
      || machines.length > 64
      || !Number.isSafeInteger(observedAtMs)
      || !Number.isSafeInteger(expiresAtMs)
      || expiresAtMs - observedAtMs > 60_000
    ) {
      throw new SupervisorRefusal(
        'SNAPBACK_EPHEMERAL_ROUTING_UNSAFE',
        'protected hosted serving requires one bounded fresh provider roster',
      );
    }
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

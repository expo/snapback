import { createAssetClient } from './assets.mjs';
import { assertClientReferenceKind } from './reference-kinds.mjs';

let commandSequence = 0;

const terminalStatuses = new Set(['succeeded', 'failed', 'cancelled', 'ambiguous']);
const commandTaskHooks = Symbol('snapback.command-task-hooks');

function nextCommandId() {
  commandSequence += 1;
  return `snapback-command-${Date.now().toString(36)}-${commandSequence.toString(36)}`;
}

function diagnostic(code, message, details = {}) {
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message,
    details: Object.freeze({ ...details }),
  });
}

function diagnosticFrom(error, fallbackCode, fallbackMessage, details = {}) {
  const carried = error?.diagnostic?.diagnostic ?? error?.diagnostic;
  if (carried && typeof carried === 'object') {
    return Object.freeze({
      schemaVersion: carried.schemaVersion ?? 'snapback.client-diagnostic.v1',
      code: typeof carried.code === 'string' ? carried.code : fallbackCode,
      severity: carried.severity ?? 'error',
      message: carried.message ?? error?.message ?? fallbackMessage,
      details: Object.freeze({ ...(carried.details ?? {}), ...details }),
    });
  }
  return diagnostic(
    error?.code ?? fallbackCode,
    error?.message ?? fallbackMessage,
    details,
  );
}

function retryRemediation(task, status) {
  return Object.freeze({
    kind: 'retryCommand',
    riskClass: 'mechanical',
    machineApplicable: true,
    requiresApproval: false,
    authorityEffect: 'none',
    precondition: Object.freeze({
      commandTaskId: task.id,
      generation: task.generation,
      status,
      mutationIdentityReuse: true,
    }),
  });
}

function assertCommandDescriptor(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)
    || command.kind !== 'asset-bearing-command.v1'
    || !command.mutation
    || command.mutation.artifactKind !== 'functionReference'
    || command.mutation.kind !== 'Mutation'
    || !Array.isArray(command.passthroughArgs)
    || !(command.asset === null || (command.asset && typeof command.asset === 'object'))) {
    throw new TypeError('invalid asset-bearing-command.v1 descriptor');
  }
}

function assertAssetSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || typeof source.size !== 'number' || typeof source.slice !== 'function') {
    throw new TypeError('command asset input must be a File/Blob-like structural source');
  }
}

function normalizeAdaptedAssetSource(adapted) {
  const envelope = adapted && typeof adapted === 'object' && !Array.isArray(adapted)
    && Object.hasOwn(adapted, 'file')
    ? adapted
    : { file: adapted };
  assertAssetSource(envelope.file);
  for (const field of ['declaredFilename', 'declaredContentType', 'previewUrl']) {
    if (envelope[field] !== undefined && envelope[field] !== null
      && typeof envelope[field] !== 'string') {
      throw new TypeError(`non-string asset ${field}`);
    }
  }
  return Object.freeze({
    file: envelope.file,
    declaredFilename: envelope.declaredFilename ?? null,
    declaredContentType: envelope.declaredContentType ?? null,
    previewUrl: envelope.previewUrl ?? null,
  });
}

function commandCall(command, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('command input must be an object');
  }
  const allowed = new Set(command.passthroughArgs);
  if (command.asset) allowed.add(command.asset.input);
  const unknown = Object.keys(input).filter((name) => !allowed.has(name));
  if (unknown.length > 0) {
    throw new TypeError(`unknown input: ${unknown.join(', ')}`);
  }
  const required = new Set(command.mutation.argumentSchema?.required ?? []);
  if (command.asset) required.delete(command.asset.mutationArg);
  const missing = [...required].filter((name) => !Object.hasOwn(input, name));
  if (missing.length > 0) {
    throw new TypeError(`missing input: ${missing.join(', ')}`);
  }
  let source = null;
  if (command.asset && Object.hasOwn(input, command.asset.input)
    && input[command.asset.input] !== undefined && input[command.asset.input] !== null) {
    source = input[command.asset.input];
  } else if (command.asset && command.asset.optional !== true) {
    throw new TypeError(`missing asset source ${command.asset.input}`);
  }
  const mutationArgs = Object.fromEntries(
    command.passthroughArgs
      .filter((name) => Object.hasOwn(input, name))
      .map((name) => [name, input[name]]),
  );
  return { mutationArgs, source };
}

function authoritativeUnattachedFact(asset) {
  const fact = asset?.attachmentFact;
  return fact?.unattached === true && fact?.provenance === 'authoritative'
    ? fact
    : null;
}

function assertMediaCommandDescriptor(command) {
  const binding = command?.binding;
  if (!command || typeof command !== 'object' || Array.isArray(command)
    || command.kind !== 'media-command.v1'
    || !command.mutation
    || command.mutation.artifactKind !== 'functionReference'
    || command.mutation.kind !== 'Mutation'
    || command.intent?.artifactKind !== 'assetUploadReference'
    || command.intent?.name !== binding?.media?.intent
    || command.intent?.intentPolicyHash !== binding?.media?.intentPolicyHash
    || !Array.isArray(command.passthroughArgs)
    || binding?.format !== 'snapback.media-command-binding.v1'
    || typeof binding.identity !== 'string'
    || typeof binding.command?.id !== 'string'
    || typeof binding.media?.input !== 'string'
    || typeof binding.media?.intent !== 'string'
    || typeof binding.media?.mutationArg !== 'string'
    || !Number.isSafeInteger(binding.media?.minItems)
    || !Number.isSafeInteger(binding.media?.maxItems)
    || !Number.isSafeInteger(binding.taskProfile?.concurrency)) {
    throw new TypeError('invalid media-command.v1 descriptor');
  }
}

function mediaCommandCall(command, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('media command input must be an object');
  }
  const { media } = command.binding;
  const allowed = new Set([...command.passthroughArgs, media.input]);
  if (command.binding.principalInput) allowed.add(command.binding.principalInput.input);
  const unknown = Object.keys(input).filter((name) => !allowed.has(name));
  if (unknown.length > 0) throw new TypeError(`unknown input: ${unknown.join(', ')}`);
  const missing = command.passthroughArgs.filter((name) => (
    command.mutation.argumentSchema?.required?.includes(name)
    && !Object.hasOwn(input, name)
  ));
  if (missing.length > 0) throw new TypeError(`missing input: ${missing.join(', ')}`);
  const carried = Object.hasOwn(input, media.input) ? input[media.input] : undefined;
  const sources = carried === undefined || carried === null
    ? []
    : Array.isArray(carried) ? [...carried] : [carried];
  if (sources.length < media.minItems || sources.length > media.maxItems) {
    throw new RangeError(
      `media input ${media.input} requires ${media.minItems}..${media.maxItems} item(s)`,
    );
  }
  if (sources.some((source) => source === '' || source === undefined || source === null)) {
    throw new TypeError(`media input ${media.input} contains an empty source`);
  }
  const mutationArgs = Object.fromEntries(
    command.passthroughArgs
      .filter((name) => Object.hasOwn(input, name))
      .map((name) => [name, input[name]]),
  );
  let principals = [];
  if (command.binding.principalInput) {
    const principalInput = command.binding.principalInput;
    const carriedPrincipals = input[principalInput.input];
    if (!Array.isArray(carriedPrincipals)
      || carriedPrincipals.length < principalInput.minItems
      || carriedPrincipals.length > principalInput.maxItems
      || carriedPrincipals.some((principal) => typeof principal !== 'string' || principal.length === 0)
      || new Set(carriedPrincipals).size !== carriedPrincipals.length) {
      throw new TypeError(
        `principal input ${principalInput.input} requires ${principalInput.minItems}..${principalInput.maxItems} unique principal ids`,
      );
    }
    principals = [...carriedPrincipals];
  }
  return { mutationArgs, sources, principals };
}

function mediaProgress(items) {
  const totals = items.reduce((progress, item) => {
    const snapshot = item.task?.snapshot?.() ?? null;
    progress.bytesTransferred += Number.isFinite(snapshot?.bytesTransferred)
      ? snapshot.bytesTransferred : 0;
    progress.totalBytes += Number.isFinite(snapshot?.totalBytes) ? snapshot.totalBytes : 0;
    if (snapshot?.status === 'ready') progress.finalizedItems += 1;
    return progress;
  }, { bytesTransferred: 0, totalBytes: 0, finalizedItems: 0 });
  return Object.freeze({ ...totals, totalItems: items.length });
}

function mediaItemSnapshots(items) {
  return Object.freeze(items.map((item) => Object.freeze({
    ordinal: item.ordinal,
    status: item.task?.snapshot?.()?.status ?? (item.started ? 'starting' : 'pending'),
    asset: item.task?.snapshot?.() ?? null,
  })));
}

// @ref LLP 0180#command-task — this wrapper owns no alternate asset or
// mutation truth. Its snapshot is rebuilt only from the existing asset task
// and the one ordinary mutation attempt driven by invokeMutation.
class CommandTaskImpl {
  #owner;
  #command;
  #input;
  #capture;
  #externalTransportGeneration;
  #listeners = new Set();
  #snapshot;
  #resolveDone;
  #rejectDone;
  #settled = false;
  #assetTask = null;
  #assetOff = null;
  #mutation = null;
  #mutationInvoked = false;
  #networkStarted = false;
  #cancelled = false;
  #mutationId;
  #seed;

  constructor(owner, command, input, {
    id = nextCommandId(),
    generation = 0,
    capture,
    externalTransportGeneration = undefined,
    mutationId = `${id}:mutation`,
    seed = null,
    immediateOutcome = null,
    inertSnapshot = null,
  } = {}) {
    this.#owner = owner;
    this.#command = command;
    this.#input = input;
    this.id = id;
    this.generation = generation;
    this.#capture = capture;
    this.#externalTransportGeneration = externalTransportGeneration;
    this.#mutationId = mutationId;
    this.#seed = seed;
    this.#snapshot = inertSnapshot ?? Object.freeze({ status: 'preparing', asset: null, mutation: null });
    this.done = new Promise((resolve, reject) => {
      this.#resolveDone = resolve;
      this.#rejectDone = reject;
    });
    if (immediateOutcome !== null) {
      this.#settled = true;
      this.#resolveDone(immediateOutcome);
    } else {
      queueMicrotask(() => this.#run());
    }
  }

  snapshot() { return this.#snapshot; }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('invalid command listener');
    this.#listeners.add(listener);
    listener();
    return () => this.#listeners.delete(listener);
  }

  #publish(snapshot) {
    if (this.#settled) return;
    this.#snapshot = Object.freeze(snapshot);
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch { /* observational */ }
    }
  }

  #finish(status, { result, diagnostic: failure, residue = null } = {}) {
    if (this.#settled) return;
    this.#settled = true;
    this.#owner[commandTaskHooks]('settled', this);
    this.#assetOff?.();
    this.#assetOff = null;
    const asset = this.#assetTask?.snapshot?.() ?? null;
    if (status === 'succeeded') {
      this.#snapshot = Object.freeze({ status, result, asset, residue: null });
      this.#resolveDone(Object.freeze({ kind: 'committed', result }));
    } else if (status === 'cancelled') {
      const cancelledDiagnostic = failure ?? diagnostic(
        'SNAPBACK_COMMAND_CANCELLED',
        'command cancelled before mutation invocation',
      );
      this.#snapshot = Object.freeze({
        status,
        diagnostic: cancelledDiagnostic,
        asset,
        mutation: this.#mutation,
        residue,
        repairs: Object.freeze([]),
      });
      this.#resolveDone(Object.freeze({ kind: 'cancelled' }));
    } else {
      const repairs = Object.freeze([retryRemediation(this, status)]);
      this.#snapshot = Object.freeze({
        status,
        diagnostic: failure,
        asset,
        mutation: this.#mutation,
        residue,
        repairs,
      });
      this.#resolveDone(Object.freeze({ kind: status, diagnostic: failure, residue, repairs }));
    }
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch { /* observational */ }
    }
  }

  #rejectLocal(error) {
    if (this.#settled) return;
    this.#settled = true;
    this.#owner[commandTaskHooks]('settled', this);
    this.#rejectDone(error);
  }

  #authorityCurrent() {
    return this.#owner.isAuthorityCurrent(
      this.#capture,
      this.#externalTransportGeneration,
    );
  }

  #residue(status, basis) {
    const asset = this.#assetTask?.snapshot?.() ?? null;
    if (asset?.status !== 'ready' || typeof asset.assetId !== 'string') return null;
    const authoritative = authoritativeUnattachedFact(asset);
    const unattached = authoritative
      ? 'authoritative'
      : status === 'failed' && this.#authorityCurrent()
        ? 'inferred'
        : 'unknown';
    return Object.freeze({
      assetId: asset.assetId,
      unattached,
      basis: authoritative?.basis ?? basis,
      cleanupPolicy: authoritative?.cleanupPolicy
        ?? 'Cleanup remains governed by the declared LLP 0044 asset lifecycle policy.',
    });
  }

  #adoptAssetTask(task) {
    this.#assetTask = task;
    this.#assetOff?.();
    this.#assetOff = task.subscribe(() => {
      if (this.#settled || this.#mutationInvoked) return;
      this.#publish({ status: 'transferring', asset: task.snapshot(), mutation: null });
    });
  }

  async #runAsset(call) {
    if (this.#seed?.assetReadyTask) {
      this.#adoptAssetTask(this.#seed.assetReadyTask);
      return this.#assetTask.snapshot();
    }
    if (this.#seed?.assetRetryFrom) {
      this.#networkStarted = true;
      const successor = await this.#seed.assetRetryFrom.retry();
      if (this.#settled || this.#cancelled) {
        await successor.cancel();
        return successor.snapshot();
      }
      this.#adoptAssetTask(successor);
    } else {
      this.#networkStarted = true;
      this.#adoptAssetTask(this.#owner.assets.start({
        upload: this.#command.asset.intent,
        args: {},
        file: call.source.file,
        declaredFilename: call.source.declaredFilename,
        declaredContentType: call.source.declaredContentType,
        previewUrl: call.source.previewUrl,
        authorityCapture: this.#capture,
        externalTransportGeneration: this.#externalTransportGeneration,
      }));
    }
    return this.#assetTask.done;
  }

  async #run() {
    let call;
    try {
      assertCommandDescriptor(this.#command);
      call = commandCall(this.#command, this.#input);
      if (call.source !== null) {
        call.source = await this.#owner.adaptAssetSource(call.source);
      }
    } catch (error) {
      this.#rejectLocal(error);
      return;
    }
    if (this.#cancelled) {
      this.#finish('cancelled');
      return;
    }
    let asset = null;
    if (call.source !== null || this.#seed?.assetReadyTask || this.#seed?.assetRetryFrom) {
      try {
        asset = await this.#runAsset(call);
      } catch (error) {
        if (this.#settled) return;
        this.#finish('failed', {
          diagnostic: diagnosticFrom(
            error,
            'SNAPBACK_COMMAND_ASSET_FAILED',
            'command asset transfer did not start or settle',
            { phase: 'asset-transfer' },
          ),
        });
        return;
      }
      if (this.#settled || this.#cancelled) return;
      if (asset.status === 'cancelled') {
        this.#finish('cancelled');
        return;
      }
      if (asset.status !== 'ready') {
        this.#finish('failed', {
          diagnostic: diagnosticFrom(
            { diagnostic: asset.diagnostic },
            'SNAPBACK_COMMAND_ASSET_FAILED',
            'command asset transfer did not finalize',
            { phase: 'asset-transfer', assetStatus: asset.status },
          ),
        });
        return;
      }
      call.mutationArgs[this.#command.asset.mutationArg] = asset.assetRef;
    }
    if (!this.#authorityCurrent()) {
      const failure = diagnostic(
        'SNAPBACK_COMMAND_AUTHORITY_REPLACED',
        'command authority was replaced before mutation invocation',
        { phase: asset ? 'after-finalization' : 'preparing' },
      );
      this.#finish('failed', {
        diagnostic: failure,
        residue: this.#residue('failed', 'authority changed after finalization; attachment state was not inspected'),
      });
      return;
    }
    this.#mutationInvoked = true;
    this.#networkStarted = true;
    this.#mutation = Object.freeze({
      id: this.#mutationId,
      status: 'pending',
      diagnostic: null,
      result: null,
    });
    this.#publish({ status: 'committing', asset, mutation: this.#mutation });
    try {
      const result = await this.#owner.invokeMutation(this.#command.mutation, call.mutationArgs, {
        clientMutationId: this.#mutationId,
        authorityCapture: this.#capture,
      });
      if (this.#settled) return;
      this.#mutation = Object.freeze({
        id: this.#mutationId,
        status: 'confirmed',
        diagnostic: null,
        result,
      });
      this.#finish('succeeded', { result });
    } catch (error) {
      if (this.#settled) return;
      const errorCode = error?.diagnostic?.code ?? error?.code ?? null;
      const provedRefusal = Boolean(error?.receipt)
        || error?.status === 401
        || error?.status === 403
        || (typeof errorCode === 'string' && errorCode.startsWith('SNAPBACK_AUTH_'))
        || error?.diagnostic?.details?.effectCommitted === false
        || error?.effectCommitted === false;
      const status = provedRefusal ? 'failed' : 'ambiguous';
      const failure = diagnosticFrom(
        error,
        provedRefusal ? 'SNAPBACK_COMMAND_MUTATION_FAILED' : 'SNAPBACK_COMMAND_MUTATION_AMBIGUOUS',
        provedRefusal
          ? 'command mutation was refused'
          : 'command mutation began but no settlement proof was received',
        { phase: 'mutation-commit', mutationAttemptId: this.#mutationId },
      );
      this.#mutation = Object.freeze({
        id: this.#mutationId,
        status: provedRefusal ? 'rejected' : 'ambiguous',
        diagnostic: failure,
        result: null,
        receipt: error?.receipt ?? null,
      });
      this.#finish(status, {
        diagnostic: failure,
        residue: this.#residue(
          status,
          provedRefusal
            ? 'this same-authority mutation attempt was proved not to attach the finalized asset; global absence is inferred'
            : 'mutation settlement or authority is unknown; no global attachment fact is available',
        ),
      });
    }
  }

  async cancel() {
    if (this.#settled || this.#snapshot.status === 'succeeded') return;
    this.#cancelled = true;
    if (this.#mutationInvoked) {
      const failure = diagnostic(
        'SNAPBACK_COMMAND_CANCELLED_DURING_COMMIT',
        'local interest stopped after mutation invocation; server settlement is unknown',
        { mutationAttemptId: this.#mutationId },
      );
      this.#finish('ambiguous', {
        diagnostic: failure,
        residue: this.#residue('ambiguous', 'cancellation occurred after mutation invocation; attachment settlement is unknown'),
      });
      return;
    }
    if (this.#assetTask && !terminalStatuses.has(this.#assetTask.snapshot().status)) {
      await this.#assetTask.cancel();
    }
    this.#finish('cancelled');
  }

  async [commandTaskHooks]() {
    if (this.#settled) return;
    this.#cancelled = true;
    if (this.#mutationInvoked) {
      const failure = diagnostic(
        'SNAPBACK_COMMAND_CLIENT_DISPOSED_DURING_COMMIT',
        'command client was disposed after mutation invocation; server settlement is unknown',
        { mutationAttemptId: this.#mutationId },
      );
      this.#finish('ambiguous', {
        diagnostic: failure,
        residue: this.#residue(
          'ambiguous',
          'command client disposal occurred after mutation invocation; attachment settlement is unknown',
        ),
      });
      return;
    }
    const assetBeforeCancellation = this.#assetTask?.snapshot?.() ?? null;
    const phase = assetBeforeCancellation?.status === 'ready'
      ? 'after-finalization'
      : this.#snapshot.status;
    const failure = diagnostic(
      'SNAPBACK_COMMAND_CLIENT_DISPOSED',
      'command client was disposed before mutation invocation',
      { phase },
    );
    const basis = 'the mutation was never invoked, so this command attempt provably did not attach the finalized asset';
    let residue = this.#residue('failed', basis);
    try {
      if (this.#assetTask && !terminalStatuses.has(assetBeforeCancellation?.status)) {
        await this.#assetTask.cancel();
      }
    } finally {
      residue ??= this.#residue('failed', basis);
      this.#finish('failed', { diagnostic: failure, residue });
    }
  }

  retry() {
    const status = this.#snapshot.status;
    const cleanCancelled = status === 'cancelled' && this.#networkStarted === false;
    if (status === 'succeeded' || cleanCancelled || !terminalStatuses.has(status)) {
      const refusal = diagnostic(
        'SNAPBACK_COMMAND_NOT_RETRYABLE',
        status === 'succeeded'
          ? 'a committed command cannot be retried'
          : cleanCancelled
            ? 'a cleanly cancelled command has no attempt to resume'
            : 'retry requires a terminal command task',
        { predecessorStatus: status },
      );
      return new CommandTaskImpl(this.#owner, this.#command, this.#input, {
        id: this.id,
        generation: this.generation + 1,
        capture: this.#capture,
        externalTransportGeneration: this.#externalTransportGeneration,
        mutationId: this.#mutationId,
        immediateOutcome: Object.freeze({ kind: 'notRetryable', diagnostic: refusal }),
        inertSnapshot: this.#snapshot,
      });
    }
    const assetSnapshot = this.#assetTask?.snapshot?.() ?? null;
    const seed = assetSnapshot?.status === 'ready'
      ? { assetReadyTask: this.#assetTask }
      : this.#assetTask && typeof assetSnapshot?.assetId === 'string'
        ? { assetRetryFrom: this.#assetTask }
        : null;
    return startCommandTask(this.#owner, this.#command, this.#input, {
      id: this.id,
      generation: this.generation + 1,
      capture: this.#capture,
      externalTransportGeneration: this.#externalTransportGeneration,
      mutationId: this.#mutationId,
      seed,
    });
  }
}

// @ref LLP 0239#d3-one-mediacommand-owns-multi-upload-plus-atomic-commit —
// this specialization coordinates existing upload children, then hands one
// ordered plan to the ordinary mutation attempt. It owns no second commit.
class MediaCommandTaskImpl {
  #owner;
  #command;
  #input;
  #capture;
  #externalTransportGeneration;
  #listeners = new Set();
  #snapshot;
  #resolveDone;
  #rejectDone;
  #settled = false;
  #items = [];
  #mutation = null;
  #mutationInvoked = false;
  #networkStarted = false;
  #cancelled = false;
  #mutationId;
  #seed;

  constructor(owner, command, input, {
    id = nextCommandId(),
    generation = 0,
    capture,
    externalTransportGeneration = undefined,
    mutationId = `${id}:mutation`,
    seed = null,
    immediateOutcome = null,
    inertSnapshot = null,
  } = {}) {
    this.#owner = owner;
    this.#command = command;
    this.#input = input;
    this.id = id;
    this.generation = generation;
    this.#capture = capture;
    this.#externalTransportGeneration = externalTransportGeneration;
    this.#mutationId = mutationId;
    this.#seed = seed;
    this.#snapshot = inertSnapshot ?? Object.freeze({
      status: 'validating',
      items: Object.freeze([]),
      progress: Object.freeze({ bytesTransferred: 0, totalBytes: 0, finalizedItems: 0, totalItems: 0 }),
      mutation: null,
    });
    this.done = new Promise((resolve, reject) => {
      this.#resolveDone = resolve;
      this.#rejectDone = reject;
    });
    if (immediateOutcome !== null) {
      this.#settled = true;
      this.#resolveDone(immediateOutcome);
    } else {
      queueMicrotask(() => this.#run());
    }
  }

  snapshot() { return this.#snapshot; }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('invalid command listener');
    this.#listeners.add(listener);
    listener();
    return () => this.#listeners.delete(listener);
  }

  #notify() {
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch { /* observational */ }
    }
  }

  #publish(status, extra = {}) {
    if (this.#settled) return;
    this.#snapshot = Object.freeze({
      status,
      items: mediaItemSnapshots(this.#items),
      progress: mediaProgress(this.#items),
      mutation: this.#mutation,
      ...extra,
    });
    this.#notify();
  }

  #authorityCurrent() {
    return this.#owner.isAuthorityCurrent(
      this.#capture,
      this.#externalTransportGeneration,
    );
  }

  #residue(status, basis) {
    return Object.freeze(this.#items.flatMap((item) => {
      const asset = item.task?.snapshot?.() ?? null;
      if (asset?.status !== 'ready' || typeof asset.assetId !== 'string') return [];
      const authoritative = authoritativeUnattachedFact(asset);
      const unattached = authoritative
        ? 'authoritative'
        : status === 'failed' && this.#authorityCurrent() ? 'inferred' : 'unknown';
      return [Object.freeze({
        ordinal: item.ordinal,
        assetId: asset.assetId,
        unattached,
        basis: authoritative?.basis ?? basis,
        cleanupPolicy: authoritative?.cleanupPolicy
          ?? 'Cleanup remains governed by the declared LLP 0044 asset lifecycle policy.',
        cleanupProvenance: authoritative ? 'asset-authoritative' : 'llp0044-policy',
      })];
    }));
  }

  #finish(status, { result, diagnostic: failure, residue = Object.freeze([]) } = {}) {
    if (this.#settled) return;
    this.#settled = true;
    this.#owner[commandTaskHooks]('settled', this);
    for (const item of this.#items) {
      item.off?.();
      item.off = null;
    }
    if (status === 'committed') {
      this.#snapshot = Object.freeze({
        status,
        result,
        items: mediaItemSnapshots(this.#items),
        progress: mediaProgress(this.#items),
        mutation: this.#mutation,
        residue: Object.freeze([]),
      });
      this.#resolveDone(Object.freeze({ kind: 'committed', result }));
    } else if (status === 'cancelled') {
      this.#snapshot = Object.freeze({
        status,
        diagnostic: failure ?? diagnostic(
          'SNAPBACK_MEDIA_COMMAND_CANCELLED',
          'media command cancelled before mutation invocation',
        ),
        items: mediaItemSnapshots(this.#items),
        progress: mediaProgress(this.#items),
        mutation: this.#mutation,
        residue,
        repairs: Object.freeze([]),
      });
      this.#resolveDone(Object.freeze({ kind: 'cancelled' }));
    } else {
      const repairs = Object.freeze([retryRemediation(this, status)]);
      this.#snapshot = Object.freeze({
        status,
        diagnostic: failure,
        items: mediaItemSnapshots(this.#items),
        progress: mediaProgress(this.#items),
        mutation: this.#mutation,
        residue,
        repairs,
      });
      this.#resolveDone(Object.freeze({ kind: status, diagnostic: failure, residue, repairs }));
    }
    this.#notify();
  }

  #rejectLocal(error) {
    if (this.#settled) return;
    this.#settled = true;
    this.#owner[commandTaskHooks]('settled', this);
    this.#rejectDone(error);
  }

  #adoptTask(item, task) {
    item.task = task;
    item.started = true;
    item.off?.();
    item.off = task.subscribe(() => {
      if (!this.#settled && !this.#mutationInvoked) this.#publish('uploading');
    });
  }

  async #uploadItem(item) {
    const seeded = this.#seed?.items?.[item.ordinal] ?? null;
    if (seeded?.task?.snapshot?.()?.status === 'ready') {
      this.#adoptTask(item, seeded.task);
      return;
    }
    let task;
    if (seeded?.task && typeof seeded.task.retry === 'function') {
      task = await seeded.task.retry();
    } else {
      task = this.#owner.assets.start({
        upload: this.#command.intent,
        args: {},
        file: item.source.file,
        declaredFilename: item.source.declaredFilename,
        declaredContentType: item.source.declaredContentType,
        previewUrl: item.source.previewUrl,
        authorityCapture: this.#capture,
        externalTransportGeneration: this.#externalTransportGeneration,
      });
    }
    this.#networkStarted = true;
    if (this.#settled || this.#cancelled) {
      await task.cancel?.();
      return;
    }
    this.#adoptTask(item, task);
    await task.done;
  }

  async #uploadAll() {
    if (this.#items.length === 0) return;
    this.#publish('uploading');
    let cursor = 0;
    let firstError = null;
    const concurrency = Math.max(1, Math.min(
      this.#command.binding.taskProfile.concurrency,
      this.#items.length,
    ));
    const worker = async () => {
      while (!this.#cancelled && firstError === null) {
        const ordinal = cursor;
        cursor += 1;
        if (ordinal >= this.#items.length) return;
        const item = this.#items[ordinal];
        try {
          await this.#uploadItem(item);
          const snapshot = item.task?.snapshot?.() ?? null;
          if (snapshot?.status !== 'ready') {
            firstError = { item, snapshot };
          }
        } catch (error) {
          firstError = { item, error, snapshot: item.task?.snapshot?.() ?? null };
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (this.#cancelled || this.#settled) return;
    if (firstError !== null) {
      await Promise.allSettled(this.#items.map(async (item) => {
        const status = item.task?.snapshot?.()?.status;
        if (item.task && status !== 'ready') await item.task.cancel?.();
      }));
      const error = firstError.error ?? { diagnostic: firstError.snapshot?.diagnostic };
      const failure = diagnosticFrom(
        error,
        'SNAPBACK_MEDIA_COMMAND_UPLOAD_FAILED',
        'one or more media uploads did not finalize',
        { phase: 'uploading', ordinal: firstError.item.ordinal },
      );
      this.#finish('failed', {
        diagnostic: failure,
        residue: this.#residue(
          'failed',
          'the mutation was never invoked; this attempt did not attach the finalized asset, but global absence is inferred',
        ),
      });
    }
  }

  async #run() {
    let call;
    try {
      assertMediaCommandDescriptor(this.#command);
      call = mediaCommandCall(this.#command, this.#input);
      const adapted = await Promise.all(call.sources.map((source) => this.#owner.adaptAssetSource(source)));
      this.#items = adapted.map((source, ordinal) => ({
        ordinal, source, task: null, off: null, started: false,
      }));
    } catch (error) {
      this.#rejectLocal(error);
      return;
    }
    if (this.#cancelled) {
      this.#finish('cancelled');
      return;
    }
    await this.#uploadAll();
    if (this.#settled) return;
    if (this.#cancelled) {
      this.#finish('cancelled', {
        residue: this.#residue(
          'cancelled',
          'cancellation preceded mutation invocation; global attachment state was not inspected',
        ),
      });
      return;
    }
    if (!this.#authorityCurrent()) {
      const failure = diagnostic(
        'SNAPBACK_MEDIA_COMMAND_AUTHORITY_REPLACED',
        'media command authority was replaced before mutation invocation',
        { phase: this.#items.length === 0 ? 'validating' : 'after-finalization' },
      );
      this.#finish('failed', {
        diagnostic: failure,
        residue: this.#residue(
          'ambiguous',
          'authority changed after finalization; attachment state was not inspected',
        ),
      });
      return;
    }
    const itemPlan = Object.freeze(this.#items.map((item) => {
      const asset = item.task.snapshot();
      const assetId = typeof asset.assetRef === 'string' ? asset.assetRef : asset.assetId;
      if (typeof assetId !== 'string' || assetId.length === 0) {
        throw new TypeError(`ready media item ${item.ordinal} has no asset id`);
      }
      return Object.freeze({ ordinal: item.ordinal, assetId });
    }));
    call.mutationArgs[this.#command.binding.media.mutationArg] = itemPlan.map(({ assetId }) => assetId);
    const mediaCommand = Object.freeze({
      bindingIdentity: this.#command.binding.identity,
      commandIdentity: this.#command.binding.command.id,
      attemptId: this.#mutationId,
      items: itemPlan,
      ...(call.principals.length === 0 ? {} : { principals: Object.freeze([...call.principals]) }),
    });
    this.#mutationInvoked = true;
    this.#networkStarted = true;
    this.#mutation = Object.freeze({
      id: this.#mutationId,
      status: 'pending',
      diagnostic: null,
      result: null,
      itemPlan,
    });
    this.#publish('committing');
    try {
      const result = await this.#owner.invokeMutation(
        this.#command.mutation,
        call.mutationArgs,
        {
          clientMutationId: this.#mutationId,
          authorityCapture: this.#capture,
          mediaCommand,
        },
      );
      if (this.#settled) return;
      this.#mutation = Object.freeze({
        ...this.#mutation,
        status: 'confirmed',
        result,
      });
      this.#finish('committed', { result });
    } catch (error) {
      if (this.#settled) return;
      const errorCode = error?.diagnostic?.code ?? error?.code ?? null;
      const provedRefusal = Boolean(error?.receipt)
        || error?.status === 401
        || error?.status === 403
        || (typeof errorCode === 'string' && errorCode.startsWith('SNAPBACK_AUTH_'))
        || error?.diagnostic?.details?.effectCommitted === false
        || error?.effectCommitted === false;
      const status = provedRefusal ? 'failed' : 'ambiguous';
      const failure = diagnosticFrom(
        error,
        provedRefusal ? 'SNAPBACK_MEDIA_COMMAND_COMMIT_FAILED' : 'SNAPBACK_MEDIA_COMMAND_COMMIT_AMBIGUOUS',
        provedRefusal
          ? 'media command mutation was refused'
          : 'media command mutation began but no settlement proof was received',
        { phase: 'committing', mutationAttemptId: this.#mutationId },
      );
      this.#mutation = Object.freeze({
        ...this.#mutation,
        status: provedRefusal ? 'rejected' : 'ambiguous',
        diagnostic: failure,
        receipt: error?.receipt ?? null,
      });
      this.#finish(status, {
        diagnostic: failure,
        residue: this.#residue(
          status,
          provedRefusal
            ? 'this same-authority mutation attempt was proved not to attach these assets; global absence is inferred'
            : 'mutation settlement is unknown; no global attachment fact is available',
        ),
      });
    }
  }

  async cancel() {
    if (this.#settled || this.#snapshot.status === 'committed') return;
    this.#cancelled = true;
    if (this.#mutationInvoked) {
      const failure = diagnostic(
        'SNAPBACK_MEDIA_COMMAND_CANCELLED_DURING_COMMIT',
        'local interest stopped after mutation invocation; server settlement is unknown',
        { mutationAttemptId: this.#mutationId },
      );
      this.#finish('ambiguous', {
        diagnostic: failure,
        residue: this.#residue(
          'ambiguous',
          'cancellation occurred after mutation invocation; attachment settlement is unknown',
        ),
      });
      return;
    }
    await Promise.allSettled(this.#items.map(async (item) => {
      const status = item.task?.snapshot?.()?.status;
      if (item.task && status !== 'ready') await item.task.cancel?.();
    }));
    this.#finish('cancelled', {
      residue: this.#residue(
        'cancelled',
        'cancellation preceded mutation invocation; global attachment state was not inspected',
      ),
    });
  }

  async [commandTaskHooks]() {
    if (this.#settled) return;
    if (this.#mutationInvoked) {
      const failure = diagnostic(
        'SNAPBACK_MEDIA_COMMAND_CLIENT_DISPOSED_DURING_COMMIT',
        'command client was disposed after mutation invocation; server settlement is unknown',
        { mutationAttemptId: this.#mutationId },
      );
      this.#finish('ambiguous', {
        diagnostic: failure,
        residue: this.#residue('ambiguous', 'client disposal left mutation settlement unknown'),
      });
      return;
    }
    await this.cancel();
  }

  retry() {
    const status = this.#snapshot.status;
    const cleanCancelled = status === 'cancelled' && this.#networkStarted === false;
    if (status === 'committed' || cleanCancelled || !['failed', 'cancelled', 'ambiguous'].includes(status)) {
      const refusal = diagnostic(
        'SNAPBACK_MEDIA_COMMAND_NOT_RETRYABLE',
        status === 'committed'
          ? 'a committed media command cannot be retried'
          : cleanCancelled
            ? 'a cleanly cancelled media command has no attempt to resume'
            : 'retry requires a terminal media command task',
        { predecessorStatus: status },
      );
      return new MediaCommandTaskImpl(this.#owner, this.#command, this.#input, {
        id: this.id,
        generation: this.generation + 1,
        capture: this.#capture,
        externalTransportGeneration: this.#externalTransportGeneration,
        mutationId: this.#mutationId,
        immediateOutcome: Object.freeze({ kind: 'notRetryable', diagnostic: refusal }),
        inertSnapshot: this.#snapshot,
      });
    }
    return startMediaCommandTask(this.#owner, this.#command, this.#input, {
      id: this.id,
      generation: this.generation + 1,
      capture: this.#capture,
      externalTransportGeneration: this.#externalTransportGeneration,
      mutationId: this.#mutationId,
      seed: { items: this.#items.map((item) => ({ task: item.task })) },
    });
  }
}

function startCommandTask(owner, command, input, options) {
  const task = new CommandTaskImpl(owner, command, input, options);
  owner[commandTaskHooks]('started', task);
  return task;
}

function startMediaCommandTask(owner, command, input, options) {
  const task = new MediaCommandTaskImpl(owner, command, input, options);
  owner[commandTaskHooks]('started', task);
  return task;
}

export class SnapbackCommandClient {
  #activeCommandTasks = new Set();
  #disposed = false;
  #disposePromise = null;

  constructor(client, { assets = null, invokeMutation = null, assetSourceAdapter = null } = {}) {
    if (!client || typeof client !== 'object') throw new TypeError('invalid command client owner');
    this.client = client;
    this.assets = assets ?? createAssetClient(client);
    this.assetSourceAdapter = assetSourceAdapter;
    this.invokeMutation = invokeMutation ?? (async (reference, args, options) => {
      const output = await client.mutate(reference, {
        args,
        clientMutationId: options.clientMutationId,
        authorityCapture: options.authorityCapture,
        ...(options.mediaCommand === undefined ? {} : { mediaCommand: options.mediaCommand }),
        // A finalized multi-asset plan is self-contained and may enter the
        // existing durable outbox before dispatch. Single-asset legacy
        // commands retain their established online-only posture.
        queue: options.mediaCommand === undefined ? false : 'auto',
      });
      return output.result;
    });
  }


  // @ref LLP 0180#input-and-platform-adapters — a host adapter may normalize
  // a picker URI while the command is still preparing; only its structural
  // File/Blob result enters the existing LLP 0044 asset task.
  async adaptAssetSource(source) {
    if (source && typeof source === 'object' && !Array.isArray(source)
      && typeof source.size === 'number' && typeof source.slice === 'function') {
      return normalizeAdaptedAssetSource(source);
    }
    if (typeof this.assetSourceAdapter !== 'function') {
      assertAssetSource(source);
      throw new TypeError('invalid asset source');
    }
    const adapted = await this.assetSourceAdapter(source);
    return normalizeAdaptedAssetSource(adapted);
  }

  isAuthorityCurrent(capture, externalTransportGeneration = undefined) {
    const fenced = typeof this.client.isAuthorityCaptureCurrent === 'function'
      ? this.client.isAuthorityCaptureCurrent(capture)
      : capture === null;
    return fenced && (
      externalTransportGeneration === undefined
      || (
        this.client.__externalBearerTransition === null
        && this.client.__authTransportGeneration === externalTransportGeneration
      )
    );
  }

  [commandTaskHooks](event, task) {
    if (event === 'settled') {
      this.#activeCommandTasks.delete(task);
      return;
    }
    if (event !== 'started') throw new TypeError(`unknown event ${String(event)}`);
    this.#activeCommandTasks.add(task);
    if (this.#disposed) void task[commandTaskHooks]();
  }

  inspection() {
    return Object.freeze({ activeCommandTasks: this.#activeCommandTasks.size });
  }

  dispose() {
    if (this.#disposePromise !== null) return this.#disposePromise;
    this.#disposed = true;
    const tasks = [...this.#activeCommandTasks];
    this.#disposePromise = (async () => {
      await Promise.allSettled(tasks.map((task) => task[commandTaskHooks]()));
      this.#activeCommandTasks.clear();
    })();
    return this.#disposePromise;
  }

  start(command, input) {
    assertClientReferenceKind({
      reference: command,
      acceptedKinds: ['Command'],
      invokedVerb: 'commandClient.start',
      diagnosticsChannel: this.client.__clientDiagnosticsChannel,
    });
    let capture;
    try {
      capture = typeof this.client.captureAuthority === 'function'
        ? this.client.captureAuthority()
        : null;
    } catch {
      capture = null;
    }
    const externalTransportGeneration = capture === null
      && !this.client.authorityFence
      && Number.isSafeInteger(this.client.__authTransportGeneration)
      ? this.client.__authTransportGeneration
      : undefined;
    const options = { capture, externalTransportGeneration };
    return command?.kind === 'media-command.v1'
      ? startMediaCommandTask(this, command, input, options)
      : startCommandTask(this, command, input, options);
  }
}

export function createCommandClient(client, options) {
  return new SnapbackCommandClient(client, options);
}

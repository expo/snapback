import { createAssetClient } from './assets.mjs';

let commandSequence = 0;

const terminalStatuses = new Set(['succeeded', 'failed', 'cancelled', 'ambiguous']);

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
  if (carried && typeof carried === 'object' && typeof carried.code === 'string') {
    return Object.freeze({
      schemaVersion: carried.schemaVersion ?? 'snapback.client-diagnostic.v1',
      code: carried.code,
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
    throw new TypeError('command start requires a generated asset-bearing-command.v1 descriptor');
  }
}

function assertAssetSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || typeof source.size !== 'number' || typeof source.slice !== 'function') {
    throw new TypeError('command asset input must be the File/Blob-like structural source accepted by the asset client');
  }
}

function commandCall(command, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('command input must be an object');
  }
  const allowed = new Set(command.passthroughArgs);
  if (command.asset) allowed.add(command.asset.input);
  const unknown = Object.keys(input).filter((name) => !allowed.has(name));
  if (unknown.length > 0) {
    throw new TypeError(`command input has unknown members: ${unknown.join(', ')}`);
  }
  const required = new Set(command.mutation.argumentSchema?.required ?? []);
  if (command.asset) required.delete(command.asset.mutationArg);
  const missing = [...required].filter((name) => !Object.hasOwn(input, name));
  if (missing.length > 0) {
    throw new TypeError(`command input is missing required members: ${missing.join(', ')}`);
  }
  let source = null;
  if (command.asset && Object.hasOwn(input, command.asset.input)
    && input[command.asset.input] !== undefined && input[command.asset.input] !== null) {
    source = input[command.asset.input];
    assertAssetSource(source);
  } else if (command.asset && command.asset.optional !== true) {
    throw new TypeError(`command input requires asset source ${command.asset.input}`);
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
    if (typeof listener !== 'function') throw new TypeError('command task listener must be a function');
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
        file: call.source,
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
      if (this.#settled) return;
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
    return new CommandTaskImpl(this.#owner, this.#command, this.#input, {
      id: this.id,
      generation: this.generation + 1,
      capture: this.#capture,
      externalTransportGeneration: this.#externalTransportGeneration,
      mutationId: this.#mutationId,
      seed,
    });
  }
}

export class SnapbackCommandClient {
  constructor(client, { assets = null, invokeMutation = null } = {}) {
    if (!client || typeof client !== 'object') throw new TypeError('SnapbackCommandClient requires a SnapbackClient-like owner');
    this.client = client;
    this.assets = assets ?? createAssetClient(client);
    this.invokeMutation = invokeMutation ?? (async (reference, args, options) => {
      const output = await client.mutate(reference, {
        args,
        clientMutationId: options.clientMutationId,
        authorityCapture: options.authorityCapture,
        queue: false,
      });
      return output.result;
    });
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

  start(command, input) {
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
    return new CommandTaskImpl(this, command, input, {
      capture,
      externalTransportGeneration,
    });
  }
}

export function createCommandClient(client, options) {
  return new SnapbackCommandClient(client, options);
}

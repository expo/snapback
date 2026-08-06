// Development-only mounted-provider HMR re-admission. This module is reached
// through a literal dynamic import after a strict same-app generation split
// has been positively classified; production bundles do not execute it.
// @ref LLP 0114#mounted-provider-hmr-generation-handoff-dated-amendment-2026-08-05
// — re-prove complete function admission off to the side, then publish one
// atomic generation overlay or return an honest reload reason.
// @ref LLP 0145#phase-a--establish-a-size-ratchet — keep this optional
// validator/RQS closure outside the frozen successful React entry.

import {
  __hmrCanonicalizeClientValueV1 as canonicalizeClientValueV1,
  __hmrCompileResultContractValidator as compileResultContractValidator,
  __hmrDeepFreeze as deepFreeze,
  __hmrDiagnosticError as diagnosticError,
  __hmrExactDeploymentFunction as exactDeploymentFunction,
  __hmrPreparedReactBindingGenerationOverlays as preparedReactBindingGenerationOverlays,
  __hmrPreparedReactBindingInternals as preparedReactBindingInternals,
  __hmrPublicReference as publicReference,
  __hmrQueryArtifactHash as queryArtifactHash,
  __hmrResultContractHash as resultContractHash,
  __hmrSleep as sleep,
} from './react-binding.mjs';

async function rebuiltGenerationAdmission(binding, deployed, targetGeneration) {
  const referenceSchemaVersion = preparedReactBindingInternals.get(binding)
    ?.referenceSchemaVersion ?? deployed.schemaVersion;
  if (!Array.isArray(deployed.functions)) {
    throw diagnosticError(
      'SNAPBACK_REACT_MANIFEST_INVALID',
      'deployed function manifest is incomplete',
    );
  }
  const references = Object.create(null);
  const referencesById = new Map();
  const resultContractsById = new Map();
  const queryArtifactsById = new Map();
  const authorityIndependentById = new Map();
  for (const definition of deployed.functions) {
    const reference = publicReference(
      definition,
      binding.appId,
      referenceSchemaVersion,
      targetGeneration,
    );
    if (reference.appId !== binding.appId) {
      throw diagnosticError(
        'SNAPBACK_REACT_MANIFEST_INVALID',
        `deployed function ${reference.name} names a foreign app`,
        { functionId: reference.id },
      );
    }
    if (Object.prototype.hasOwnProperty.call(references, reference.name)) {
      throw diagnosticError(
        'SNAPBACK_REACT_MANIFEST_INVALID',
        `deployed manifest repeats function name ${reference.name}`,
      );
    }
    const descriptor = deepFreeze(
      structuredClone(definition.resultContract ?? { kind: 'unknown' }),
    );
    const validator = compileResultContractValidator(descriptor);
    if (await resultContractHash(descriptor) !== reference.resultContractHash) {
      throw diagnosticError(
        'SNAPBACK_REACT_MANIFEST_INVALID',
        `deployed result contract for ${reference.name} does not match its hash`,
        { functionId: reference.id },
      );
    }
    references[reference.name] = reference;
    referencesById.set(reference.id, reference);
    queryArtifactsById.set(reference.id, queryArtifactHash(definition));
    authorityIndependentById.set(
      reference.id,
      definition.authorityIndependent === true,
    );
    resultContractsById.set(reference.id, Object.freeze({
      hash: reference.resultContractHash,
      descriptor,
      validator,
    }));
  }
  Object.freeze(references);
  return {
    references,
    referencesById,
    resultContractsById,
    queryArtifactsById,
    authorityIndependentById,
  };
}

async function attemptGenerationRebind(binding, inspection, target) {
  const deployed = inspection?.functions;
  if (!deployed || typeof deployed !== 'object') {
    return { ok: false, terminal: false, reason: 'deployment-not-current' };
  }
  if (deployed.appId !== binding.appId) {
    return { ok: false, terminal: true, reason: 'deployed-app-mismatch' };
  }
  const identity = {
    schemaHash: inspection.schema?.schemaHash ?? null,
    bundleHash: deployed.bundleHash,
    inputsHash: deployed.inputsHash ?? null,
  };
  if (
    identity.bundleHash !== target.bundleHash
    || identity.schemaHash !== target.schemaHash
    || identity.inputsHash !== target.inputsHash
  ) {
    return { ok: false, terminal: false, reason: 'deployment-not-current' };
  }
  if (
    binding.routesManifest !== null
    && inspection.routeManifestHash !== binding.routeManifestHash
  ) {
    return { ok: false, terminal: true, reason: 'route-manifest-changed' };
  }
  try {
    const deployedCollections = Array.isArray(inspection.schema?.ephemeralCollections)
      ? inspection.schema.ephemeralCollections
      : [];
    const currentDefinitions = [...binding.ephemeralDefinitionsById.values()];
    if (currentDefinitions.length > 0 || deployedCollections.length > 0) {
      const byName = new Map(
        deployedCollections.map((definition) => [definition?.name, definition]),
      );
      const unchanged = currentDefinitions.length === byName.size
        && currentDefinitions.every(({ definition }) => {
          const next = byName.get(definition.name);
          return next !== undefined
            && canonicalizeClientValueV1(next)
              === canonicalizeClientValueV1(definition);
        });
      if (!unchanged) {
        return { ok: false, terminal: true, reason: 'ephemeral-collections-changed' };
      }
    }
  } catch {
    return { ok: false, terminal: true, reason: 'ephemeral-collections-changed' };
  }
  let admission;
  try {
    admission = await rebuiltGenerationAdmission(binding, deployed, target);
  } catch (error) {
    return {
      ok: false,
      terminal: true,
      reason: 'deployed-manifest-invalid',
      cause: error?.code ?? String(error),
    };
  }
  for (const group of binding.queryGroupsById.values()) {
    for (const child of group.queries) {
      const next = admission.referencesById.get(child.ref.id);
      if (!next || exactDeploymentFunction(next) !== exactDeploymentFunction(child.ref)) {
        return {
          ok: false,
          terminal: true,
          reason: 'query-group-child-changed',
          groupId: group.id,
        };
      }
    }
  }
  const overlay = Object.freeze({
    deploymentIdentity: Object.freeze({
      ...binding.deploymentIdentity,
      schemaHash: identity.schemaHash,
      bundleHash: identity.bundleHash,
      inputsHash: identity.inputsHash,
    }),
    ...admission,
  });
  preparedReactBindingGenerationOverlays.set(binding, overlay);
  return { ok: true, terminal: false, generation: overlay.deploymentIdentity };
}

export async function runGenerationHandoff(binding, target, { timeoutMs, pollIntervalMs }) {
  const deadline = Date.now() + timeoutMs;
  let lastOutcome = { ok: false, reason: 'deployment-not-current' };
  for (;;) {
    let inspection = null;
    try {
      inspection = await binding.client.inspect();
    } catch {
      // Unreachable or restarting local backend: keep waiting inside budget.
    }
    if (inspection !== null && inspection !== undefined) {
      let outcome;
      try {
        outcome = await attemptGenerationRebind(binding, inspection, target);
      } catch (error) {
        outcome = {
          ok: false,
          terminal: true,
          reason: 'deployed-manifest-invalid',
          cause: error?.code ?? String(error),
        };
      }
      if (outcome.ok || outcome.terminal) {
        const { terminal: _terminal, ...settled } = outcome;
        return settled;
      }
      lastOutcome = { ok: false, reason: outcome.reason };
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return lastOutcome;
    await sleep(Math.min(pollIntervalMs, Math.max(0, remainingMs)));
  }
}

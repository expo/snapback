import {
  canonicalDeclaredDevOrigin,
  classifyHostedDevelopmentHostname,
  declaredDevCapabilityFromApp,
  deploymentIdentitiesEqual,
  stampedDeclaredDevIdentity,
} from '@expo/snapback-client/app-client-internal';
import {
  admitHostedDevelopmentBindingForAppClient,
} from './app-binding-internal.mjs';
import {
  declaredDevCandidateStamp,
} from './declared-dev-binding-internal.mjs';

export const APP_BINDING_FORMAT = 'snapback.app-binding.v1';

const ROOT_KEYS = [
  'capabilities',
  'descriptorIdentity',
  'format',
  'integrity',
  'provenance',
  'source',
  'target',
];
const TARGET_KEYS = ['app', 'functions', 'origin', 'routing', 'schema'];
const CAPABILITY_KEYS = ['offered'];
const DEV_PROVENANCE_KEYS = ['expiresAt', 'issuedAt', 'supervisorGeneration'];
const HOSTED_DEVELOPMENT_PROVENANCE_KEYS = ['hostedTargetReceipt'];
const RELEASE_PROVENANCE_KEYS = ['buildReceipt', 'environment', 'releaseChannel'];
const DECLARED_DEV_PROVENANCE_KEYS = ['deploymentIdentity'];
const SUPERVISED_ISSUANCE_CLOCK_SKEW_MS = 60_000;
const AUTHORING_PROFILES = new Set([
  'snapback-explicit-v1',
  'snapback-familiar-ts-v1',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function problem(code, path, message, details = {}) {
  return Object.freeze({ code, path, message, details: Object.freeze({ ...details }) });
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

function diagnosticError(value, remediations = []) {
  const error = new Error(`${value.code}: ${value.message}`);
  error.code = value.code;
  error.diagnostic = value;
  error.remediations = Object.freeze([...remediations]);
  return error;
}

function remediation(kind, description, precondition, {
  riskClass = 'mechanical',
  machineApplicable = false,
  requiresApproval = false,
  authorityEffect = 'none',
} = {}) {
  return Object.freeze({
    kind,
    riskClass,
    machineApplicable,
    requiresApproval,
    authorityEffect,
    precondition: Object.freeze({ ...precondition }),
    description,
  });
}

function bindingFailure(code, message, details, remediations = []) {
  throw diagnosticError(diagnostic(code, message, details), remediations);
}

function parseOrigin(value) {
  if (!nonEmptyString(value)) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.username !== ''
      || parsed.password !== ''
      || parsed.pathname !== '/'
      || parsed.search !== ''
      || parsed.hash !== ''
      || parsed.origin === 'null'
      || parsed.origin !== value.replace(/\/$/u, '')
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname) {
  // @ref LLP 0302#1-structural-gating-one-stable-module-two-generated-variants
  // — source admission is closed by generated capability/release facts, not
  // by ambient NODE_ENV, which may be misleading in a development app.
  return hostname === 'localhost'
    || hostname === '[::1]'
    || hostname === '::1'
    || /^127(?:\.[0-9]{1,3}){3}$/u.test(hostname);
}

function isSupervisedDeviceLocalHostname(hostname, routing) {
  return isLoopbackHostname(hostname)
    || (routing === 'port-forward' && hostname === '10.0.2.2');
}

function validTimestamp(value) {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

// @ref LLP 0181#appbinding-v1 — source is the union discriminator: the exact
// key sets below prevent release provenance, supervised provenance, hosted-
// target provenance, and any authority-bearing extension from being combined
// in one portable value.
export function validateAppBindingV1(candidate) {
  const problems = [];
  if (!exactKeys(candidate, ROOT_KEYS)) {
    problems.push(problem(
      'SNAPBACK_APP_BINDING_SCHEMA_INVALID',
      '$',
      'AppBinding must be the closed snapback.app-binding.v1 root record',
      { expectedKeys: ROOT_KEYS, actualKeys: isRecord(candidate) ? Object.keys(candidate) : [] },
    ));
    return problems;
  }
  if (candidate.format !== APP_BINDING_FORMAT) {
    problems.push(problem(
      'SNAPBACK_APP_BINDING_FORMAT_UNSUPPORTED',
      '$.format',
      `AppBinding format must be ${APP_BINDING_FORMAT}`,
      { observedFormat: candidate.format ?? null },
    ));
  }
  if (!['supervised-dev', 'hosted-development', 'declared-dev', 'release'].includes(candidate.source)) {
    problems.push(problem(
      'SNAPBACK_APP_BINDING_SOURCE_UNSUPPORTED',
      '$.source',
      'AppBinding source must be supervised-dev, hosted-development, declared-dev, or release',
      { observedSource: candidate.source ?? null },
    ));
  }
  if (!nonEmptyString(candidate.descriptorIdentity)) {
    problems.push(problem(
      'SNAPBACK_APP_BINDING_SCHEMA_INVALID',
      '$.descriptorIdentity',
      'descriptorIdentity must be a non-empty generated descriptor identity',
    ));
  }
  if (!exactKeys(candidate.target, TARGET_KEYS)) {
    problems.push(problem(
      'SNAPBACK_APP_BINDING_SCHEMA_INVALID',
      '$.target',
      'target must be the closed app/schema/functions/origin/routing record',
    ));
  } else {
    for (const field of ['app', 'schema', 'functions', 'origin']) {
      if (field === 'origin' && candidate.source === 'declared-dev') continue;
      if (!nonEmptyString(candidate.target[field])) {
        problems.push(problem(
          'SNAPBACK_APP_BINDING_SCHEMA_INVALID',
          `$.target.${field}`,
          `target.${field} must be a non-empty public identity fact`,
        ));
      }
    }
    const origin = parseOrigin(candidate.target.origin);
    if (candidate.source === 'declared-dev') {
      const canonical = canonicalDeclaredDevOrigin(candidate.target.origin);
      if (!canonical.ok || canonical.origin !== candidate.target.origin) {
        problems.push(problem(
          'SNAPBACK_APP_BINDING_URL_INVALID',
          '$.target.origin',
          `declared-dev URL refused by rule ${canonical.ok ? 'canonical-origin' : canonical.rule}`,
          { rule: canonical.ok ? 'canonical-origin' : canonical.rule },
        ));
      }
      if (candidate.target.routing !== 'declared-dev') {
        problems.push(problem(
          'SNAPBACK_APP_BINDING_SOURCE_MISMATCH',
          '$.target.routing',
          'declared-dev bindings admit only declared-dev routing',
        ));
      }
    } else if (origin === null) {
      problems.push(problem(
        'SNAPBACK_APP_BINDING_TARGET_INVALID',
        '$.target.origin',
        'target.origin must be an absolute URL origin without credentials, path, query, or fragment',
      ));
    } else if (candidate.source === 'supervised-dev') {
      if (!['loopback', 'port-forward'].includes(candidate.target.routing)) {
        problems.push(problem(
          'SNAPBACK_APP_BINDING_SOURCE_MISMATCH',
          '$.target.routing',
          'supervised-dev bindings admit only loopback or port-forward routing',
        ));
      }
      if (!['http:', 'https:'].includes(origin.protocol)
        || !isSupervisedDeviceLocalHostname(origin.hostname, candidate.target.routing)) {
        problems.push(problem(
          'SNAPBACK_APP_BINDING_TARGET_INVALID',
          '$.target.origin',
          'supervised-dev origins must be HTTP(S) loopback or the Android-emulator host alias under port-forward routing',
          { hostname: origin.hostname, protocol: origin.protocol },
        ));
      }
    } else if (candidate.source === 'hosted-development') {
      const refusedHostnameClass = classifyHostedDevelopmentHostname(origin.hostname);
      if (origin.protocol !== 'https:' || refusedHostnameClass !== null) {
        problems.push(problem(
          'SNAPBACK_APP_BINDING_TARGET_INVALID',
          '$.target.origin',
          'hosted-development origins must use public HTTPS, not a loopback name, unspecified address, or private IP literal',
          {
            hostname: origin.hostname,
            protocol: origin.protocol,
            classification: refusedHostnameClass,
          },
        ));
      }
      if (candidate.target.routing !== 'https') {
        problems.push(problem(
          'SNAPBACK_APP_BINDING_SOURCE_MISMATCH',
          '$.target.routing',
          'hosted-development bindings admit only https routing',
        ));
      }
    } else if (candidate.source === 'release') {
      if (candidate.target.routing !== 'https') {
        problems.push(problem(
          'SNAPBACK_APP_BINDING_SOURCE_MISMATCH',
          '$.target.routing',
          'release bindings admit only https routing',
        ));
      }
      if (origin.protocol !== 'https:') {
        problems.push(problem(
          'SNAPBACK_APP_BINDING_TARGET_INVALID',
          '$.target.origin',
          'release origins must use HTTPS',
          { protocol: origin.protocol },
        ));
      }
    }
  }
  if (
    !exactKeys(candidate.capabilities, CAPABILITY_KEYS)
    || !Array.isArray(candidate.capabilities?.offered)
    || candidate.capabilities.offered.some((entry) => !nonEmptyString(entry))
    || new Set(candidate.capabilities.offered).size !== candidate.capabilities.offered.length
  ) {
    problems.push(problem(
      'SNAPBACK_APP_BINDING_SCHEMA_INVALID',
      '$.capabilities',
      'capabilities.offered must be a duplicate-free string array',
    ));
  }
  if (candidate.source === 'declared-dev') {
    if (!exactKeys(candidate.provenance, DECLARED_DEV_PROVENANCE_KEYS)) {
      problems.push(problem(
        'SNAPBACK_APP_BINDING_SOURCE_MISMATCH',
        '$.provenance',
        'declared-dev provenance must contain only deploymentIdentity',
      ));
    }
    if (!exactKeys(candidate.integrity, ['channel'])
      || candidate.integrity.channel !== 'generated-declared-dev') {
      problems.push(problem(
        'SNAPBACK_APP_BINDING_INTEGRITY_INVALID',
        '$.integrity',
        'declared-dev integrity must name only generated-declared-dev',
      ));
    }
  } else if (candidate.source === 'supervised-dev') {
    if (!exactKeys(candidate.provenance, DEV_PROVENANCE_KEYS)) {
      problems.push(problem(
        'SNAPBACK_APP_BINDING_SOURCE_MISMATCH',
        '$.provenance',
        'supervised-dev provenance must contain only supervisorGeneration, issuedAt, and expiresAt',
      ));
    } else {
      if (!nonEmptyString(candidate.provenance.supervisorGeneration)) {
        problems.push(problem(
          'SNAPBACK_APP_BINDING_SCHEMA_INVALID',
          '$.provenance.supervisorGeneration',
          'supervisorGeneration must be non-empty',
        ));
      }
      for (const field of ['issuedAt', 'expiresAt']) {
        if (!validTimestamp(candidate.provenance[field])) {
          problems.push(problem(
            'SNAPBACK_APP_BINDING_SCHEMA_INVALID',
            `$.provenance.${field}`,
            `${field} must be an RFC 3339 timestamp`,
          ));
        }
      }
      if (
        validTimestamp(candidate.provenance.issuedAt)
        && validTimestamp(candidate.provenance.expiresAt)
        && Date.parse(candidate.provenance.expiresAt) <= Date.parse(candidate.provenance.issuedAt)
      ) {
        problems.push(problem(
          'SNAPBACK_APP_BINDING_SCHEMA_INVALID',
          '$.provenance.expiresAt',
          'expiresAt must be later than issuedAt',
        ));
      }
    }
    if (!exactKeys(candidate.integrity, ['channel'])
      || candidate.integrity.channel !== 'local-supervised-ipc') {
      problems.push(problem(
        'SNAPBACK_APP_BINDING_SOURCE_MISMATCH',
        '$.integrity',
        'supervised-dev integrity must name only local-supervised-ipc',
      ));
    }
  } else if (candidate.source === 'hosted-development') {
    if (!exactKeys(candidate.provenance, HOSTED_DEVELOPMENT_PROVENANCE_KEYS)) {
      problems.push(problem(
        'SNAPBACK_APP_BINDING_SOURCE_MISMATCH',
        '$.provenance',
        'hosted-development provenance must contain only hostedTargetReceipt',
      ));
    } else if (!nonEmptyString(candidate.provenance.hostedTargetReceipt)) {
      problems.push(problem(
        'SNAPBACK_APP_BINDING_SCHEMA_INVALID',
        '$.provenance.hostedTargetReceipt',
        'hostedTargetReceipt must be non-empty',
      ));
    }
    if (!exactKeys(candidate.integrity, ['channel'])
      || candidate.integrity.channel !== 'hosted-target-admission') {
      problems.push(problem(
        'SNAPBACK_APP_BINDING_INTEGRITY_INVALID',
        '$.integrity',
        'hosted-development integrity must name only hosted-target-admission',
      ));
    }
  } else if (candidate.source === 'release') {
    if (!exactKeys(candidate.provenance, RELEASE_PROVENANCE_KEYS)) {
      problems.push(problem(
        'SNAPBACK_APP_BINDING_SOURCE_MISMATCH',
        '$.provenance',
        'release provenance must contain only environment, releaseChannel, and buildReceipt',
      ));
    } else {
      for (const field of RELEASE_PROVENANCE_KEYS) {
        if (!nonEmptyString(candidate.provenance[field])) {
          problems.push(problem(
            'SNAPBACK_APP_BINDING_SCHEMA_INVALID',
            `$.provenance.${field}`,
            `${field} must be non-empty`,
          ));
        }
      }
    }
    const signed = exactKeys(candidate.integrity, ['channel', 'signature'])
      && candidate.integrity.channel === 'signed-artifact'
      && nonEmptyString(candidate.integrity.signature);
    const embedded = exactKeys(candidate.integrity, ['channel'])
      && candidate.integrity.channel === 'embedded-at-build';
    if (!signed && !embedded) {
      problems.push(problem(
        'SNAPBACK_APP_BINDING_INTEGRITY_INVALID',
        '$.integrity',
        'release integrity must be signed-artifact with a signature or embedded-at-build',
      ));
    }
  }
  return Object.freeze(problems);
}

function assertDescriptorV1(app) {
  const rootKeys = ['api', 'authoringProfile', 'capabilities', 'commands', 'format', 'identity', 'surfaces'];
  const legacyRootKeys = ['api', 'capabilities', 'commands', 'format', 'identity', 'surfaces'];
  const bootstrapRootKeys = [...rootKeys, 'authBootstrap'];
  const legacyBootstrapRootKeys = [...legacyRootKeys, 'authBootstrap'];
  const identityKeys = ['app', 'descriptor', 'functions', 'schema'];
  if (
    (!exactKeys(app, rootKeys)
      && !exactKeys(app, legacyRootKeys)
      && !exactKeys(app, bootstrapRootKeys)
      && !exactKeys(app, legacyBootstrapRootKeys))
    || app.format !== 'snapback.app.v1'
    || (Object.hasOwn(app, 'authoringProfile') && !AUTHORING_PROFILES.has(app.authoringProfile))
    || !exactKeys(app.identity, identityKeys)
    || identityKeys.some((key) => !nonEmptyString(app.identity[key]))
    || !isRecord(app.capabilities)
    || !Array.isArray(app.capabilities.required)
    || app.capabilities.required.some((entry) => !nonEmptyString(entry))
  ) {
    bindingFailure(
      'SNAPBACK_APP_DESCRIPTOR_INVALID',
      'SnapbackExpoProvider requires an LLP 0179 snapback.app.v1 descriptor',
      { observedFormat: app?.format ?? null },
      [remediation(
        'regenerateAppDescriptor',
        'Regenerate the application artifacts and import their generated app export.',
        { expectedFormat: 'snapback.app.v1' },
        { machineApplicable: true },
      )],
    );
  }
  return app;
}

function targetTuple(target) {
  return TARGET_KEYS.map((key) => target[key]).join('\u0000');
}

function exactTarget(left, right) {
  return isRecord(left) && isRecord(right) && targetTuple(left) === targetTuple(right);
}

function freezeClone(value) {
  const clone = structuredClone(value);
  const visit = (entry) => {
    if (entry === null || typeof entry !== 'object' || Object.isFrozen(entry)) return entry;
    for (const child of Object.values(entry)) visit(child);
    return Object.freeze(entry);
  };
  return visit(clone);
}

async function verified(callback, ...args) {
  if (typeof callback !== 'function') return false;
  try {
    return await callback(...args) === true;
  } catch {
    return false;
  }
}

// @ref LLP 0179#appbinding-seam — all four stable identities plus capability,
// provenance, expiry, and source facts are admitted before a client exists.
// @ref LLP 0181#appbinding-v1 — override proofs split by source; a live
// supervisor confirms supervised-dev overrides while hosted-development facts
// come from the generated app-binding module and release facts come from their
// separate generated target/attestation inputs.
export async function admitAppBindingV1(candidate, app, {
  mode = 'resolved',
  now = Date.now(),
  productionCondition = false,
  delivery = null,
  generatedReleaseTargets = [],
  confirmSupervisedIssuance,
  verifySignedArtifact,
  verifyBuildReceipt,
} = {}) {
  let admittedHostedDevelopmentBinding = null;
  const descriptor = assertDescriptorV1(app);
  const problems = validateAppBindingV1(candidate);
  if (problems.length > 0) {
    const first = problems[0];
    bindingFailure(first.code, first.message, {
      path: first.path,
      problems,
    }, [remediation(
      'replaceBinding',
      'Resolve a fresh binding from the supervised runtime or admitted release artifact.',
      { descriptorIdentity: descriptor.identity.descriptor },
    )]);
  }
  if (!['resolved', 'override'].includes(mode)) {
    throw new TypeError('AppBinding admission mode must be resolved or override');
  }
  const mismatches = [];
  const identityPairs = [
    ['descriptor', descriptor.identity.descriptor, candidate.descriptorIdentity],
    ['app', descriptor.identity.app, candidate.target.app],
    ['schema', descriptor.identity.schema, candidate.target.schema],
    ['functions', descriptor.identity.functions, candidate.target.functions],
  ];
  for (const [field, expected, observed] of identityPairs) {
    if (expected !== observed) mismatches.push(Object.freeze({ field, expected, observed }));
  }
  if (mismatches.length > 0) {
    bindingFailure(
      'SNAPBACK_APP_BINDING_IDENTITY_MISMATCH',
      'AppBinding identities do not match the imported AppDescriptor',
      { mismatches: Object.freeze(mismatches) },
      [remediation(
        'resolveMatchingBinding',
        'Resolve the binding issued for this exact generated descriptor.',
        { descriptorIdentity: descriptor.identity.descriptor },
      )],
    );
  }
  const offered = new Set(candidate.capabilities.offered);
  const missingCapabilities = descriptor.capabilities.required.filter(
    (capability) => !offered.has(capability),
  );
  if (missingCapabilities.length > 0) {
    bindingFailure(
      'SNAPBACK_APP_BINDING_CAPABILITY_MISMATCH',
      'The selected target does not offer every capability required by the AppDescriptor',
      { missingCapabilities: Object.freeze([...missingCapabilities]) },
      [remediation(
        'selectCompatibleTarget',
        'Select a generated target that offers every required application capability.',
        { descriptorIdentity: descriptor.identity.descriptor },
      )],
    );
  }
  if (candidate.source === 'declared-dev') {
    const stamp = declaredDevCandidateStamp(candidate);
    const appCapability = declaredDevCapabilityFromApp(descriptor);
    const appDeploymentIdentity = stampedDeclaredDevIdentity(appCapability);
    const candidateDeploymentIdentity = stamp?.deploymentIdentity ?? null;
    if (
      candidateDeploymentIdentity === null
      || appDeploymentIdentity === null
      || !deploymentIdentitiesEqual(candidateDeploymentIdentity, candidate.provenance.deploymentIdentity)
      || !deploymentIdentitiesEqual(candidateDeploymentIdentity, appDeploymentIdentity)
    ) {
      bindingFailure(
        'SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED',
        'The declared-dev binding was not minted for this generated application.',
        {
          branded: stamp !== null,
          generatedIdentity: appDeploymentIdentity,
          candidateIdentity: candidate.provenance.deploymentIdentity ?? null,
        },
      );
    }
    return freezeClone(candidate);
  }
  if (candidate.source === 'supervised-dev') {
    if (productionCondition === true) {
      bindingFailure(
        'SNAPBACK_APP_BINDING_SOURCE_MISMATCH',
        'A supervised development binding cannot be admitted in a production release condition',
        { source: candidate.source, productionCondition: true },
      );
    }
    if (delivery?.channel !== 'local-supervised-ipc') {
      bindingFailure(
        'SNAPBACK_APP_BINDING_INTEGRITY_INVALID',
        'The supervised binding was not delivered over the admitted local-supervised-ipc seam',
        { deliveredBy: delivery?.channel ?? null },
      );
    }
    if (Date.parse(candidate.provenance.issuedAt) > now + SUPERVISED_ISSUANCE_CLOCK_SKEW_MS) {
      bindingFailure(
        'SNAPBACK_APP_BINDING_NOT_YET_VALID',
        'The supervised development binding is outside the admitted issuance clock-skew window',
        {
          issuedAt: candidate.provenance.issuedAt,
          allowedClockSkewMs: SUPERVISED_ISSUANCE_CLOCK_SKEW_MS,
          supervisorGeneration: candidate.provenance.supervisorGeneration,
        },
        [remediation(
          'restartExpoSupervisor',
          'Check the host clock and restart the supervised Expo development session.',
          { supervisorGeneration: candidate.provenance.supervisorGeneration },
        )],
      );
    }
    if (Date.parse(candidate.provenance.expiresAt) <= now) {
      bindingFailure(
        'SNAPBACK_APP_BINDING_EXPIRED',
        'The supervised development binding has expired',
        {
          expiresAt: candidate.provenance.expiresAt,
          supervisorGeneration: candidate.provenance.supervisorGeneration,
        },
        [remediation(
          'restartExpoSupervisor',
          'Reload to fetch the current supervisor\'s lazily refreshed binding. '
            + 'If this client is attached to an older supervisor that cannot refresh, '
            + 'stop that stale supervisor and restart `snapback dev --expo`.',
          { supervisorGeneration: candidate.provenance.supervisorGeneration },
        )],
      );
    }
    if (mode === 'override' && !await verified(confirmSupervisedIssuance, candidate)) {
      bindingFailure(
        'SNAPBACK_APP_BINDING_OVERRIDE_UNCONFIRMED',
        'The live supervisor did not confirm issuing this exact binding override',
        {
          descriptorIdentity: candidate.descriptorIdentity,
          supervisorGeneration: candidate.provenance.supervisorGeneration,
        },
      );
    }
  } else if (candidate.source === 'hosted-development') {
    if (productionCondition === true) {
      bindingFailure(
        'SNAPBACK_APP_BINDING_SOURCE_MISMATCH',
        'A hosted development binding cannot be admitted in a production release condition',
        { source: candidate.source, productionCondition: true },
      );
    }
    const hostedAdmission = await admitHostedDevelopmentBindingForAppClient(
      candidate,
      descriptor,
    );
    if (hostedAdmission.status === 'target-invalid') {
      bindingFailure(
        'SNAPBACK_APP_BINDING_TARGET_INVALID',
        'The hosted development target must use public HTTPS, not a loopback name, unspecified address, or private IP literal',
        {
          target: freezeClone(candidate.target),
          classification: hostedAdmission.classification,
        },
      );
    }
    if (hostedAdmission.status === 'target-unadmitted') {
      bindingFailure(
        'SNAPBACK_APP_BINDING_TARGET_UNADMITTED',
        'The hosted development target tuple is absent from generated hosted target facts',
        { target: freezeClone(candidate.target), mode },
        [remediation(
          'selectGeneratedHostedTarget',
          'Select an already-admitted hosted target generated for this application.',
          { descriptorIdentity: candidate.descriptorIdentity },
        )],
      );
    }
    if (hostedAdmission.status === 'generated-module-unavailable') {
      bindingFailure(
        'SNAPBACK_APP_BINDING_INTEGRITY_INVALID',
        'Hosted development requires the generated app export that carries this application\'s hosted-target admission facts',
        {
          descriptorIdentity: candidate.descriptorIdentity,
          generatedBindingModuleAvailable: false,
        },
        [remediation(
          'importGeneratedAppBinding',
          'Import app from the generated app-binding module path instead of loading the descriptor JSON directly.',
          { descriptorIdentity: candidate.descriptorIdentity },
        )],
      );
    }
    if (hostedAdmission.status === 'integrity-invalid') {
      bindingFailure(
        'SNAPBACK_APP_BINDING_INTEGRITY_INVALID',
        'The generated app-binding module did not admit this hosted development receipt',
        {
          channel: candidate.integrity.channel,
          hostedTargetReceipt: candidate.provenance.hostedTargetReceipt,
        },
      );
    }
    admittedHostedDevelopmentBinding = hostedAdmission.binding;
  } else {
    const targetAdmitted = Array.isArray(generatedReleaseTargets)
      && generatedReleaseTargets.some((target) => exactTarget(target, candidate.target));
    if (!targetAdmitted) {
      bindingFailure(
        'SNAPBACK_APP_BINDING_TARGET_UNADMITTED',
        'The release binding target tuple is absent from generated release target facts',
        { target: freezeClone(candidate.target), mode },
        [remediation(
          'selectGeneratedReleaseTarget',
          'Select a release target generated for this application and build channel.',
          { descriptorIdentity: candidate.descriptorIdentity },
        )],
      );
    }
    const integrityVerified = candidate.integrity.channel === 'signed-artifact'
      ? await verified(verifySignedArtifact, candidate)
      : await verified(verifyBuildReceipt, candidate.provenance.buildReceipt, candidate);
    if (!integrityVerified) {
      bindingFailure(
        'SNAPBACK_APP_BINDING_INTEGRITY_INVALID',
        'The release binding did not verify through its declared integrity arm',
        {
          channel: candidate.integrity.channel,
          buildReceipt: candidate.provenance.buildReceipt,
        },
      );
    }
  }
  return admittedHostedDevelopmentBinding ?? freezeClone(candidate);
}

export function publicBindingFacts(binding) {
  const problems = validateAppBindingV1(binding);
  if (problems.length > 0) {
    throw diagnosticError(diagnostic(
      problems[0].code,
      problems[0].message,
      { path: problems[0].path },
    ));
  }
  return freezeClone({
    format: binding.format,
    source: binding.source,
    descriptorIdentity: binding.descriptorIdentity,
    target: binding.target,
    capabilities: binding.capabilities,
    provenance: binding.provenance,
    integrity: { channel: binding.integrity.channel },
  });
}

export function isAppBindingDiagnostic(error) {
  return error?.diagnostic?.schemaVersion === 'snapback.client-diagnostic.v1'
    && typeof error.diagnostic.code === 'string';
}

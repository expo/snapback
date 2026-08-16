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
const RELEASE_PROVENANCE_KEYS = ['buildReceipt', 'environment', 'releaseChannel'];
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
  // @ref LLP 0181#package-contract — release exports must not retain the supervised
  // endpoint vocabulary; production builds prune this branch (LLP 0176 G4).
  if (process.env.NODE_ENV !== 'production') {
    return hostname === 'localhost'
      || hostname === '[::1]'
      || hostname === '::1'
      || /^127(?:\.[0-9]{1,3}){3}$/u.test(hostname);
  }
  return false;
}

function isSupervisedDeviceLocalHostname(hostname, routing) {
  // @ref LLP 0181#package-contract — release exports must not retain the supervised
  // endpoint vocabulary; production builds prune this branch (LLP 0176 G4).
  if (process.env.NODE_ENV !== 'production') {
    return isLoopbackHostname(hostname)
      || (routing === 'port-forward' && hostname === '10.0.2.2');
  }
  return false;
}

function validTimestamp(value) {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

// @ref LLP 0181#appbinding-v1 — source is the union discriminator: the exact
// key sets below prevent release provenance, supervised provenance, and any
// authority-bearing extension from being combined in one portable value.
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
  if (!['supervised-dev', 'release'].includes(candidate.source)) {
    problems.push(problem(
      'SNAPBACK_APP_BINDING_SOURCE_UNSUPPORTED',
      '$.source',
      'AppBinding source must be supervised-dev or release',
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
      if (!nonEmptyString(candidate.target[field])) {
        problems.push(problem(
          'SNAPBACK_APP_BINDING_SCHEMA_INVALID',
          `$.target.${field}`,
          `target.${field} must be a non-empty public identity fact`,
        ));
      }
    }
    const origin = parseOrigin(candidate.target.origin);
    if (origin === null) {
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
  if (candidate.source === 'supervised-dev') {
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
// supervisor confirms dev overrides while release targets and attestations
// come from generated build facts.
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
          'Restart the supervised Expo development session to obtain a fresh binding.',
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
  return freezeClone(candidate);
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

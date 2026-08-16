// CLI-owned done-oracle composition.
//
// @ref LLP 0146#d2-snapback-verify--the-done-oracle — verification composes
// existing authorities in a fixed order and emits a portable, identity-bound
// receipt; it is intentionally not a new acceptance.run host operation.
// @ref LLP 0146#d1-declarationobservation-conformance — registered acceptance
// paths must contribute the exact D1 read/write conformance report. Aggregate
// over-declaration is the intersection across complete observations, so a
// conditionally used table is not mislabeled as dead declaration surface.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from '@expo/snapback-codegen';
import {
  resolveGeneratedArtifact,
  verifyGeneratedGraph,
} from '@expo/snapback-codegen/review-surface';

export const VERIFY_CONFIG_SCHEMA_VERSION = 'snapback.verify-config.v1';
export const VERIFY_RECEIPT_SCHEMA_VERSION = 'snapback.verify-receipt.v1';
export const VERIFY_CONFIG_CONVENTION = 'snapback.verify.config.mjs';
export const DEFAULT_VERIFY_PROFILE_TIMEOUT_MS = 300_000;
export const CLOUDFLARE_ACCEPTANCE_SCHEMA_VERSION = 'snapback.cloudflare-acceptance.v1';

export const VERIFY_STAGE_IDS = Object.freeze([
  'artifact-freshness',
  'runtime-readiness',
  'admission-and-conformance',
  'capability-resolution',
  'acceptance-profiles',
]);

const PATH_KINDS = new Set([
  'success',
  'failure',
  'action',
  'relational',
  'search',
  'snapshot-bundle',
]);
const REPORT_KEYS = Object.freeze([
  'missingReads',
  'missingWrites',
  'extraReads',
  'extraWrites',
]);
const PROVENANCE = new Set(['complete', 'incomplete', 'unsupported']);
const NEXT_BY_STAGE = Object.freeze({
  'artifact-freshness': Object.freeze({
    code: 'SNAPBACK_VERIFY_REGENERATE_ARTIFACTS',
    command: 'snapback generate',
    instruction: 'Regenerate the backend selected by the current working directory, or pass its directory explicitly.',
    reason: 'generated artifacts are absent, invalid, or do not match current source bytes',
  }),
  'runtime-readiness': Object.freeze({
    code: 'SNAPBACK_VERIFY_QUALIFY_RUNTIME',
    command: 'snapback runtime-qualify --persist',
    instruction: 'Qualify the exact local packaged runtime and persist its digest-bound readiness receipt.',
    reason: 'the selected runtime has no valid digest-bound readiness receipt',
  }),
  'admission-and-conformance': Object.freeze({
    code: 'SNAPBACK_VERIFY_FIX_ADMISSION_OR_COVERAGE',
    command: null,
    instruction: 'Fix schema/function admission failures and rerun every registered coverage path.',
    reason: 'generated identities disagree or D1 coverage evidence is missing/under-declared',
  }),
  'capability-resolution': Object.freeze({
    code: 'SNAPBACK_VERIFY_SELECT_CAPABLE_TARGET',
    command: null,
    instruction: 'Select a target profile that supplies every required capability, then regenerate.',
    reason: 'the generated target profile does not satisfy the application and profile requirements',
  }),
  'acceptance-profiles': Object.freeze({
    code: 'SNAPBACK_VERIFY_FIX_ACCEPTANCE',
    command: null,
    instruction: 'Repair the failing registered acceptance profile and rerun snapback verify.',
    reason: 'one or more registered acceptance profiles failed',
  }),
});

function foreignCauseDetails(error, details = undefined) {
  const causeCode = typeof error?.code === 'string' && !error.code.startsWith('SNAPBACK_')
    ? error.code
    : null;
  return {
    ...(details ?? {}),
    ...(causeCode === null ? {} : { causeCode }),
  };
}

function verifyError(code, message, details = undefined) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = {
    code,
    severity: 'error',
    subsystem: 'verify',
    message,
    ...(details === undefined ? {} : { details }),
  };
  return error;
}

function assert(condition, message, details = undefined) {
  if (!condition) throw verifyError('SNAPBACK_VERIFY_CONFIG_INVALID', message, details);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableJson(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function diagnostic(code, message, details = undefined, severity = 'error') {
  return Object.freeze({
    code,
    severity,
    subsystem: 'verify',
    message,
    ...(details === undefined ? {} : { details }),
  });
}

function normalizedStringArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  const output = value.map((entry, index) => {
    assert(typeof entry === 'string' && entry.length > 0, `${label}[${index}] must be a non-empty string`);
    return entry;
  });
  assert(new Set(output).size === output.length, `${label} must not contain duplicates`);
  return Object.freeze([...output].sort());
}

function normalizeContext(value = {}) {
  assert(plainObject(value), 'context must be an object');
  const normalizeIdentity = (entry, label, fallbackKind) => {
    const selected = entry ?? { kind: fallbackKind, identity: null };
    assert(plainObject(selected), `context.${label} must be an object`);
    assert(typeof selected.kind === 'string' && selected.kind.length > 0, `context.${label}.kind must be a non-empty string`);
    assert(selected.identity === null || (typeof selected.identity === 'string' && selected.identity.length > 0), `context.${label}.identity must be null or a non-empty string`);
    return Object.freeze({ kind: selected.kind, identity: selected.identity });
  };
  const authority = value.authority ?? {
    kind: 'not-exercised', identity: null, principalClass: 'not-exercised',
  };
  assert(plainObject(authority), 'context.authority must be an object');
  assert(typeof authority.kind === 'string' && authority.kind.length > 0, 'context.authority.kind must be a non-empty string');
  assert(authority.identity === null || (typeof authority.identity === 'string' && authority.identity.length > 0), 'context.authority.identity must be null or a non-empty string');
  assert(typeof authority.principalClass === 'string' && authority.principalClass.length > 0, 'context.authority.principalClass must be a non-empty string');
  return Object.freeze({
    target: normalizeIdentity(value.target, 'target', 'local-generated-artifact'),
    data: normalizeIdentity(value.data, 'data', 'not-exercised'),
    authority: Object.freeze({
      kind: authority.kind,
      identity: authority.identity,
      principalClass: authority.principalClass,
    }),
    seed: normalizeIdentity(value.seed, 'seed', 'not-exercised'),
  });
}

function normalizePath(path, profileId, index) {
  assert(plainObject(path), `profiles[${profileId}].paths[${index}] must be an object`);
  assert(typeof path.id === 'string' && path.id.length > 0, `profiles[${profileId}].paths[${index}].id must be a non-empty string`);
  assert(PATH_KINDS.has(path.kind), `profiles[${profileId}].paths[${index}].kind must be a closed D1 path kind`);
  assert(typeof path.targetProfileId === 'string' && path.targetProfileId.length > 0, `profiles[${profileId}].paths[${index}].targetProfileId must be a non-empty string`);
  assert(path.functionId === null || path.functionId === undefined || (typeof path.functionId === 'string' && path.functionId.length > 0), `profiles[${profileId}].paths[${index}].functionId must be null or a non-empty string`);
  return Object.freeze({
    id: path.id,
    kind: path.kind,
    targetProfileId: path.targetProfileId,
    functionId: path.functionId ?? null,
  });
}

function normalizeProfile(profile, index, configDirectory) {
  assert(plainObject(profile), `profiles[${index}] must be an object`);
  assert(typeof profile.id === 'string' && profile.id.length > 0, `profiles[${index}].id must be a non-empty string`);
  assert(typeof profile.run === 'function', `profiles[${profile.id}].run must be a function`);
  const paths = (profile.paths ?? []).map((path, pathIndex) => normalizePath(path, profile.id, pathIndex));
  assert(new Set(paths.map(({ id }) => id)).size === paths.length, `profiles[${profile.id}].paths must have unique ids`);
  if (profile.timeoutMs !== undefined) {
    assert(Number.isSafeInteger(profile.timeoutMs) && profile.timeoutMs > 0, `profiles[${profile.id}].timeoutMs must be a positive integer`);
  }
  let testFiles;
  try {
    testFiles = (profile.testFiles ?? []).map((path) => realpathSync(resolve(configDirectory, path))).sort();
  } catch (error) {
    throw verifyError(
      'SNAPBACK_VERIFY_CONFIG_INVALID',
      `profiles[${profile.id}].testFiles contains an unavailable path`,
      foreignCauseDetails(error, { profileId: profile.id }),
    );
  }
  return Object.freeze({
    id: profile.id,
    title: typeof profile.title === 'string' && profile.title.length > 0 ? profile.title : profile.id,
    testFiles: Object.freeze(testFiles),
    requiredCapabilities: normalizedStringArray(profile.requiredCapabilities ?? [], `profiles[${profile.id}].requiredCapabilities`),
    paths: Object.freeze(paths),
    timeoutMs: profile.timeoutMs ?? null,
    run: profile.run,
  });
}

export function defineVerifyConfig(config) {
  assert(plainObject(config), 'verify config must be an object');
  assert(config.schemaVersion === VERIFY_CONFIG_SCHEMA_VERSION, `schemaVersion must be ${VERIFY_CONFIG_SCHEMA_VERSION}`);
  return config;
}

const STARTER_ACCEPTANCE_SCHEMA_VERSION = 'snapback.starter-acceptance.v1';
const STARTER_ACCEPTANCE_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function resolveStarterAcceptanceFile(value) {
  if (value instanceof URL) return realpathSync(fileURLToPath(value));
  assert(typeof value === 'string' && value.length > 0, 'starter acceptanceFile must be a path or file URL');
  return realpathSync(resolve(value));
}

function unsupportedConformance(paths) {
  return paths.map(({ id }) => Object.freeze({
    pathId: id,
    status: 'observed',
    report: Object.freeze({
      missingReads: Object.freeze([]),
      missingWrites: Object.freeze([]),
      extraReads: Object.freeze([]),
      extraWrites: Object.freeze([]),
      readProvenance: 'unsupported',
      writeProvenance: 'unsupported',
    }),
  }));
}

async function runStarterAcceptanceProfile({ acceptanceFile, identityContext, paths, timeoutMs }) {
  const child = spawn(process.execPath, [acceptanceFile], {
    cwd: dirname(acceptanceFile),
    env: { ...process.env, SNAPBACK_VERIFY_PROFILE: 'starter-acceptance' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let overflow = false;
  let timedOut = false;
  let killTimeout = null;
  const append = (current, chunk) => {
    const next = `${current}${chunk.toString('utf8')}`;
    if (Buffer.byteLength(next) > STARTER_ACCEPTANCE_MAX_OUTPUT_BYTES) {
      overflow = true;
      child.kill('SIGTERM');
      return next.slice(-STARTER_ACCEPTANCE_MAX_OUTPUT_BYTES);
    }
    return next;
  };
  child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
  child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    killTimeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
  }, timeoutMs);
  const exit = await new Promise((resolveExit) => {
    child.once('error', (error) => resolveExit({ code: null, signal: null, error }));
    child.once('close', (code, signal) => resolveExit({ code, signal, error: null }));
  });
  clearTimeout(timeout);
  if (killTimeout !== null) clearTimeout(killTimeout);

  let receipt = null;
  for (const line of stdout.trim().split('\n').reverse()) {
    try {
      const candidate = JSON.parse(line);
      if (candidate?.schemaVersion === STARTER_ACCEPTANCE_SCHEMA_VERSION) {
        receipt = candidate;
        break;
      }
    } catch {
      // The starter receipt is the final JSON line; preceding human output is
      // not evidence and remains available only in the bounded diagnostic.
    }
  }
  const receiptComplete = receipt?.status === 'passed'
    && Number.isInteger(receipt?.expectedCheckCount)
    && receipt.expectedCheckCount > 0
    && receipt.executedCheckCount === receipt.expectedCheckCount
    && receipt.checks?.length === receipt.expectedCheckCount
    && receipt.checks.every(({ status }) => status === 'passed')
    && typeof receipt.identity?.artifact?.appId === 'string'
    && receipt.identity?.loaded?.appId === receipt.identity.artifact.appId
    && receipt.identity?.loaded?.bundleHash === receipt.identity.artifact.bundleHash
    && receipt.lifecycle?.owned === true
    && receipt.lifecycle?.applicationReadyObserved === true
    && receipt.lifecycle?.waitLevel === 'application'
    && receipt.lifecycle?.firstQueryRetries === 0
    && typeof receipt.operations?.queryFunctionId === 'string'
    && typeof receipt.operations?.mutationFunctionId === 'string'
    && receipt.cleanup?.attempted === true
    && receipt.cleanup?.clientResourcesReleased === true
    && receipt.cleanup?.devExited === true
    && receipt.cleanup?.temporaryStateRemoved === true
    && receipt.cleanup?.ok === true
    && receipt.diagnostic === null;
  const ok = !overflow && !timedOut && exit.error === null && exit.code === 0 && receiptComplete;
  const causeCode = exit.error?.code ?? receipt?.diagnostic?.code ?? null;
  const diagnosticCode = overflow
    ? 'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_OUTPUT_LIMIT'
    : timedOut
      ? 'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_TIMEOUT'
      : 'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_FAILED';
  const diagnosticMessage = overflow
    ? 'starter acceptance exceeded the bounded output limit'
    : timedOut
      ? `starter acceptance exceeded its ${timeoutMs}ms timeout`
      : receipt?.diagnostic?.message
        ?? exit.error?.message
        ?? `starter acceptance exited ${exit.code ?? exit.signal ?? 'without a status'} or returned an incomplete receipt`;
  const diagnostics = ok ? [] : [diagnostic(
    diagnosticCode,
    diagnosticMessage,
    {
      acceptanceFile,
      exitCode: exit.code,
      signal: exit.signal,
      receiptStatus: receipt?.status ?? null,
      expectedCheckCount: receipt?.expectedCheckCount ?? null,
      executedCheckCount: receipt?.executedCheckCount ?? null,
      ...(typeof causeCode === 'string' ? { causeCode } : {}),
      stderr: stderr.slice(-16_384),
    },
  )];
  return Object.freeze({
    ok,
    context: identityContext,
    conformance: Object.freeze(unsupportedConformance(paths)),
    diagnostics: Object.freeze(diagnostics),
  });
}

// @ref LLP 0196#program — scaffold proof commands register the existing live
// starter acceptance under LLP 0146 D2; this adapter runs that receipt instead
// of creating a second verifier or duplicating its product assertions.
export function defineStarterVerifyProfile({
  id,
  title = id,
  acceptanceFile,
  additionalTestFiles = [],
  requiredCapabilities = [],
  paths = [],
  timeoutMs = 180_000,
}) {
  assert(typeof id === 'string' && id.length > 0, 'starter profile id must be a non-empty string');
  assert(typeof title === 'string' && title.length > 0, 'starter profile title must be a non-empty string');
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0, 'starter profile timeoutMs must be a positive integer');
  const resolvedAcceptanceFile = resolveStarterAcceptanceFile(acceptanceFile);
  const resolvedAdditionalTestFiles = additionalTestFiles.map((file) => (
    resolveStarterAcceptanceFile(file)
  ));
  const normalizedPaths = Object.freeze(paths.map((path, index) => normalizePath(path, id, index)));
  return Object.freeze({
    id,
    title,
    testFiles: Object.freeze([resolvedAcceptanceFile, ...resolvedAdditionalTestFiles]),
    requiredCapabilities: Object.freeze([...requiredCapabilities]),
    paths: normalizedPaths,
    run(context) {
      return runStarterAcceptanceProfile({
        acceptanceFile: resolvedAcceptanceFile,
        identityContext: context.identityContext,
        paths: normalizedPaths,
        timeoutMs,
      });
    },
  });
}

function redactSecret(value, secret) {
  const text = String(value ?? '');
  return typeof secret === 'string' && secret.length > 0
    ? text.replaceAll(secret, '[redacted]')
    : text;
}

function normalizedRemoteOrigin(value) {
  const parsed = new URL(value);
  assert(
    parsed.protocol === 'https:' || parsed.protocol === 'http:',
    'Cloudflare proof URL must use http or https',
  );
  return parsed.href.replace(/\/$/u, '');
}

async function runCloudflareAcceptanceProfile({
  acceptanceFile,
  proofUrl,
  adminToken,
  artifact,
  identityContext,
  paths,
  timeoutMs,
  expectedCheckCount,
}) {
  const effectiveProofUrl = proofUrl ?? process.env.SNAPBACK_PROOF_URL ?? '';
  const effectiveAdminToken = adminToken ?? process.env.SNAPBACK_ADMIN_TOKEN ?? '';
  if (effectiveProofUrl.length === 0 || effectiveAdminToken.length === 0) {
    return Object.freeze({
      ok: false,
      context: identityContext,
      conformance: Object.freeze(unsupportedConformance(paths)),
      diagnostics: Object.freeze([diagnostic(
        'SNAPBACK_VERIFY_CLOUDFLARE_CREDENTIALS_MISSING',
        'Cloudflare acceptance requires SNAPBACK_PROOF_URL and SNAPBACK_ADMIN_TOKEN',
        { missingProofUrl: effectiveProofUrl.length === 0, missingAdminToken: effectiveAdminToken.length === 0 },
      )]),
    });
  }

  let origin;
  try {
    origin = normalizedRemoteOrigin(effectiveProofUrl);
  } catch (error) {
    return Object.freeze({
      ok: false,
      context: identityContext,
      conformance: Object.freeze(unsupportedConformance(paths)),
      diagnostics: Object.freeze([diagnostic(
        'SNAPBACK_VERIFY_CLOUDFLARE_PROOF_URL_INVALID',
        'Cloudflare acceptance proof URL is invalid',
        foreignCauseDetails(error),
      )]),
    });
  }

  const child = spawn(process.execPath, [acceptanceFile], {
    cwd: dirname(acceptanceFile),
    env: {
      ...process.env,
      SNAPBACK_PROOF_URL: origin,
      SNAPBACK_ADMIN_TOKEN: effectiveAdminToken,
      SNAPBACK_VERIFY_PROFILE: 'cloudflare-acceptance',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let overflow = false;
  let timedOut = false;
  let killTimeout = null;
  const append = (current, chunk) => {
    const next = `${current}${chunk.toString('utf8')}`;
    if (Buffer.byteLength(next) > STARTER_ACCEPTANCE_MAX_OUTPUT_BYTES) {
      overflow = true;
      child.kill('SIGTERM');
      return next.slice(-STARTER_ACCEPTANCE_MAX_OUTPUT_BYTES);
    }
    return next;
  };
  child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
  child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    killTimeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
  }, timeoutMs);
  const exit = await new Promise((resolveExit) => {
    child.once('error', (error) => resolveExit({ code: null, signal: null, error }));
    child.once('close', (code, signal) => resolveExit({ code, signal, error: null }));
  });
  clearTimeout(timeout);
  if (killTimeout !== null) clearTimeout(killTimeout);

  let receipt = null;
  for (const line of stdout.trim().split('\n').reverse()) {
    try {
      const candidate = JSON.parse(line);
      if (candidate?.schemaVersion === CLOUDFLARE_ACCEPTANCE_SCHEMA_VERSION) {
        receipt = candidate;
        break;
      }
    } catch {
      // Only the final single-line machine receipt is evidence. Human output
      // from the remote runner is intentionally ignored.
    }
  }
  const expectedArtifact = artifact?.identity ?? {};
  const checks = Array.isArray(receipt?.checks) ? receipt.checks : [];
  let receiptOrigin = null;
  try {
    receiptOrigin = normalizedRemoteOrigin(receipt?.target?.origin ?? '');
  } catch {
    // An absent or malformed observed origin makes the receipt incomplete.
  }
  const receiptComplete = ['passed', 'passed-with-nonclaims'].includes(receipt?.status)
    && receipt?.expectedCheckCount === expectedCheckCount
    && receipt?.executedCheckCount === expectedCheckCount
    && checks.length === expectedCheckCount
    && checks.every((check) => check?.status === 'passed' || check?.status === 'skipped')
    && checks.some((check) => check?.status === 'passed')
    && receiptOrigin === origin
    && typeof receipt?.target?.platformBuildId === 'string'
    && receipt.target.platformBuildId.length > 0
    && receipt?.artifact?.appId === expectedArtifact.appId
    && receipt?.artifact?.schemaHash === expectedArtifact.schemaHash
    && receipt?.artifact?.bundleHash === expectedArtifact.bundleHash
    && /^sha256:[0-9a-f]{64}$/u.test(receipt?.dataIdentity ?? '')
    && /^sha256:[0-9a-f]{64}$/u.test(receipt?.seedIdentity ?? '')
    && receipt?.diagnostic === null;
  const ok = !overflow && !timedOut && exit.error === null && exit.code === 0 && receiptComplete;
  const diagnosticCode = overflow
    ? 'SNAPBACK_VERIFY_CLOUDFLARE_ACCEPTANCE_OUTPUT_LIMIT'
    : timedOut
      ? 'SNAPBACK_VERIFY_CLOUDFLARE_ACCEPTANCE_TIMEOUT'
      : 'SNAPBACK_VERIFY_CLOUDFLARE_ACCEPTANCE_FAILED';
  const diagnostics = ok
    ? checks.some(({ status }) => status === 'skipped')
      ? [diagnostic(
          'SNAPBACK_VERIFY_CLOUDFLARE_ACCEPTANCE_NONCLAIM',
          'Cloudflare acceptance passed with one or more explicit external-provider nonclaims',
          { skippedChecks: checks.filter(({ status }) => status === 'skipped').map(({ label }) => label) },
          'warning',
        )]
      : []
    : [diagnostic(
        diagnosticCode,
        overflow
          ? 'Cloudflare acceptance exceeded the bounded output limit'
          : timedOut
            ? `Cloudflare acceptance exceeded its ${timeoutMs}ms timeout`
            : `Cloudflare acceptance exited ${exit.code ?? exit.signal ?? 'without a status'} or returned an incomplete receipt`,
        {
          acceptanceFile,
          origin,
          exitCode: exit.code,
          signal: exit.signal,
          receiptStatus: receipt?.status ?? null,
          expectedCheckCount,
          executedCheckCount: receipt?.executedCheckCount ?? null,
          ...(typeof exit.error?.code === 'string' ? { causeCode: exit.error.code } : {}),
          stderr: redactSecret(stderr.slice(-16_384), effectiveAdminToken),
        },
      )];
  const context = ok
    ? normalizeContext({
        ...identityContext,
        target: {
          kind: 'cloudflare-deployment',
          identity: `${origin}#${receipt.target.platformBuildId}`,
        },
        data: { kind: 'cloudflare-live-observation', identity: receipt.dataIdentity },
        seed: { kind: 'authored-seed-bytes', identity: receipt.seedIdentity },
      })
    : identityContext;
  return Object.freeze({
    ok,
    context,
    conformance: Object.freeze(unsupportedConformance(paths)),
    diagnostics: Object.freeze(diagnostics),
  });
}

// @ref LLP 0146#d2-snapback-verify--the-done-oracle — the non-local runtime
// skip is not evidence; Cloudflare readiness comes from an explicit remote
// profile whose receipt binds the admitted app hashes and observed target.
export function defineCloudflareVerifyProfile({
  id,
  title = id,
  acceptanceFile,
  additionalTestFiles = [],
  requiredCapabilities = [],
  paths = [],
  proofUrl = null,
  adminToken = null,
  expectedCheckCount = 22,
  timeoutMs = DEFAULT_VERIFY_PROFILE_TIMEOUT_MS,
}) {
  assert(typeof id === 'string' && id.length > 0, 'Cloudflare profile id must be a non-empty string');
  assert(typeof title === 'string' && title.length > 0, 'Cloudflare profile title must be a non-empty string');
  assert(Number.isInteger(expectedCheckCount) && expectedCheckCount > 0, 'Cloudflare expectedCheckCount must be a positive integer');
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0, 'Cloudflare profile timeoutMs must be a positive integer');
  assert(proofUrl === null || (typeof proofUrl === 'string' && proofUrl.length > 0), 'Cloudflare proofUrl must be null or a non-empty string');
  assert(adminToken === null || (typeof adminToken === 'string' && adminToken.length > 0), 'Cloudflare adminToken must be null or a non-empty string');
  const resolvedAcceptanceFile = resolveStarterAcceptanceFile(acceptanceFile);
  const resolvedAdditionalTestFiles = additionalTestFiles.map((file) => resolveStarterAcceptanceFile(file));
  const normalizedPaths = Object.freeze(paths.map((path, index) => normalizePath(path, id, index)));
  assert(
    normalizedPaths.every(({ targetProfileId }) => targetProfileId === 'cloudflare-do-sqlite-v8'),
    'Cloudflare profile paths must target cloudflare-do-sqlite-v8',
  );
  return Object.freeze({
    id,
    title,
    testFiles: Object.freeze([resolvedAcceptanceFile, ...resolvedAdditionalTestFiles]),
    requiredCapabilities: Object.freeze([...requiredCapabilities]),
    paths: normalizedPaths,
    timeoutMs,
    run(context) {
      return runCloudflareAcceptanceProfile({
        acceptanceFile: resolvedAcceptanceFile,
        proofUrl,
        adminToken,
        artifact: context.artifact,
        identityContext: context.identityContext,
        paths: normalizedPaths,
        timeoutMs,
        expectedCheckCount,
      });
    },
  });
}

export async function loadVerifyConfig(path, { backendDirectory = null } = {}) {
  let configPath;
  try {
    configPath = realpathSync(resolve(path));
  } catch (error) {
    throw verifyError(
      'SNAPBACK_VERIFY_CONFIG_UNAVAILABLE',
      `verify config ${resolve(path)} is unavailable`,
      foreignCauseDetails(error, { path: resolve(path) }),
    );
  }
  const imported = await import(`${pathToFileURL(configPath).href}?verify=${Date.now()}`);
  const value = imported.default;
  assert(plainObject(value), 'verify config default export must be an object');
  assert(value.schemaVersion === VERIFY_CONFIG_SCHEMA_VERSION, `schemaVersion must be ${VERIFY_CONFIG_SCHEMA_VERSION}`);
  const configDirectory = dirname(configPath);
  const profiles = (value.profiles ?? []).map((profile, index) => normalizeProfile(profile, index, configDirectory));
  assert(new Set(profiles.map(({ id }) => id)).size === profiles.length, 'profile ids must be unique');
  return Object.freeze({
    schemaVersion: VERIFY_CONFIG_SCHEMA_VERSION,
    configPath,
    // An explicit CLI positional is shell-facing and therefore cwd-relative;
    // paths authored inside the config remain config-file-relative.
    backendDirectory: backendDirectory === null
      ? resolve(configDirectory, value.backendDirectory ?? 'snapback')
      : resolve(process.cwd(), backendDirectory),
    generatedDirectory: value.generatedDirectory === undefined
      ? null
      : resolve(configDirectory, value.generatedDirectory),
    context: normalizeContext(value.context),
    profiles: Object.freeze(profiles),
  });
}

export function discoverVerifyConfig(directory = process.cwd()) {
  const candidate = resolve(directory, VERIFY_CONFIG_CONVENTION);
  return existsSync(candidate) ? candidate : null;
}

export function defaultVerifyConfig({ backendDirectory = 'snapback' } = {}) {
  return Object.freeze({
    schemaVersion: VERIFY_CONFIG_SCHEMA_VERSION,
    configPath: null,
    backendDirectory: resolve(backendDirectory),
    generatedDirectory: null,
    context: normalizeContext(),
    profiles: Object.freeze([]),
  });
}

function readJson(path, code) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    const error = verifyError(code, `could not read generated artifact ${path}`, { path });
    error.cause = cause;
    throw error;
  }
}

function copyBackendSource(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    filter(path) {
      if (path === source) return true;
      const name = relative(source, path).split(sep)[0];
      return !['generated', '.snapback', 'node_modules'].includes(name);
    },
  });
}

export async function probeArtifactFreshness(config) {
  const backendRoot = realpathSync(config.backendDirectory);
  const generatedRoot = resolve(config.generatedDirectory ?? join(backendRoot, 'generated'));
  const verified = verifyGeneratedGraph(generatedRoot);
  const artifactIndex = readJson(join(generatedRoot, 'artifacts.json'), 'SNAPBACK_VERIFY_ARTIFACT_INVALID');
  const capability = readJson(resolveGeneratedArtifact(generatedRoot, 'capability.manifest.json'), 'SNAPBACK_VERIFY_ARTIFACT_INVALID');
  const targetProfile = capability.targetProfileId ?? 'local-dev-sqlite-ibex';
  const scratch = mkdtempSync(join(dirname(backendRoot), '.snapback-verify-'));
  let regenerated;
  try {
    copyBackendSource(backendRoot, scratch);
    regenerated = await generate(scratch, { targetProfile });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (!regenerated?.ok) {
    return {
      ok: false,
      diagnostics: regenerated?.diagnostics ?? [diagnostic(
        'SNAPBACK_VERIFY_ARTIFACT_REGEN_FAILED',
        'source could not be regenerated for freshness comparison',
      )],
    };
  }
  const keys = ['appId', 'schemaVersion', 'schemaHash', 'bundleHash', 'inputsHash'];
  const expected = Object.fromEntries(keys.map((key) => [key, artifactIndex[key] ?? null]));
  const observed = Object.fromEntries(keys.map((key) => [key, regenerated.artifactIndex?.[key] ?? null]));
  const mismatches = keys.filter((key) => expected[key] !== observed[key]);
  if (mismatches.length > 0) {
    return {
      ok: false,
      diagnostics: [diagnostic(
        'SNAPBACK_VERIFY_ARTIFACT_STALE',
        'generated artifact identity does not match a fresh source regeneration',
        { mismatches, expected, observed },
      )],
    };
  }
  return {
    ok: true,
    identity: expected,
    seedIdentity: (() => {
      const seedPath = join(backendRoot, 'seed.json');
      try {
        return {
          kind: 'authored-seed-bytes',
          identity: `sha256:${createHash('sha256').update(readFileSync(seedPath)).digest('hex')}`,
        };
      } catch (error) {
        if (error?.code === 'ENOENT') return { kind: 'no-authored-seed', identity: null };
        throw error;
      }
    })(),
    generatedRoot,
    verifiedGraph: {
      inputsHash: verified.manifest.inputsHash,
      files: verified.manifest.files?.length ?? 0,
    },
    manifests: {
      artifactIndex,
      schema: readJson(resolveGeneratedArtifact(generatedRoot, 'schema.manifest.json'), 'SNAPBACK_VERIFY_ARTIFACT_INVALID'),
      functions: readJson(resolveGeneratedArtifact(generatedRoot, 'functions.manifest.json'), 'SNAPBACK_VERIFY_ARTIFACT_INVALID'),
      capability,
    },
    diagnostics: [],
  };
}

export function probeAdmission(artifact) {
  if (!artifact?.ok) return { ok: false, blocked: true, diagnostics: [] };
  const { artifactIndex, schema, functions, capability } = artifact.manifests;
  const identity = artifact.identity;
  const mismatches = [];
  for (const [manifestName, manifest] of Object.entries({ schema, functions })) {
    for (const key of ['appId', 'schemaVersion', 'inputsHash']) {
      if (manifest[key] !== identity[key]) mismatches.push({ manifest: manifestName, key, expected: identity[key], observed: manifest[key] ?? null });
    }
  }
  if (schema.schemaHash !== identity.schemaHash) mismatches.push({ manifest: 'schema', key: 'schemaHash', expected: identity.schemaHash, observed: schema.schemaHash ?? null });
  if (functions.bundleHash !== identity.bundleHash) mismatches.push({ manifest: 'functions', key: 'bundleHash', expected: identity.bundleHash, observed: functions.bundleHash ?? null });
  if (artifactIndex.artifactKind !== 'artifactIndex' || schema.artifactKind !== 'schemaManifest' || functions.artifactKind !== 'functionManifest' || capability.artifactKind !== 'capabilityManifest') {
    mismatches.push({ manifest: 'artifact-set', key: 'artifactKind', expected: 'closed known kinds', observed: 'invalid' });
  }
  return mismatches.length === 0
    ? { ok: true, mode: 'generated-artifact-local-admission', diagnostics: [] }
    : {
      ok: false,
      mode: 'generated-artifact-local-admission',
      diagnostics: [diagnostic('SNAPBACK_VERIFY_ADMISSION_IDENTITY_MISMATCH', 'schema/function artifact admission identities disagree', { mismatches })],
    };
}

export function probeCapabilities(artifact, profiles) {
  if (!artifact?.ok) return { ok: false, blocked: true, diagnostics: [], required: [], supported: [], missing: [] };
  const required = new Set(artifact.manifests.schema.requiredCapabilities ?? []);
  for (const fn of artifact.manifests.functions.functions ?? []) {
    for (const capability of fn.requiredCapabilities ?? []) required.add(capability);
  }
  for (const profile of profiles) {
    for (const capability of profile.requiredCapabilities) required.add(capability);
  }
  const supported = new Set(artifact.manifests.capability.supportedCapabilities ?? []);
  const missing = [...required].filter((capability) => !supported.has(capability)).sort();
  return {
    ok: missing.length === 0,
    targetProfileId: artifact.manifests.capability.targetProfileId ?? null,
    required: [...required].sort(),
    supported: [...supported].sort(),
    missing,
    diagnostics: missing.length === 0 ? [] : [diagnostic(
      'SNAPBACK_VERIFY_CAPABILITY_GAP',
      'the selected target profile is missing required capabilities',
      { missing },
    )],
  };
}

function digestFiles(configPath, paths) {
  const files = [...new Set([...(configPath === null ? [] : [configPath]), ...paths])].sort();
  const baseDirectory = configPath === null ? process.cwd() : dirname(configPath);
  const hash = createHash('sha256');
  hash.update('snapback:verify-test-bytes:v1\n', 'utf8');
  let bytes = 0;
  const records = files.map((path) => {
    const content = readFileSync(path);
    const portablePath = relative(baseDirectory, path).split(sep).join('/');
    const fileDigest = createHash('sha256').update(content).digest('hex');
    bytes += content.byteLength;
    hash.update(`${Buffer.byteLength(portablePath)}:${portablePath}${content.byteLength}:`, 'utf8');
    hash.update(content);
    return Object.freeze({ path: portablePath, bytes: content.byteLength, sha256: `sha256:${fileDigest}` });
  });
  return Object.freeze({
    algorithm: 'sha256-path-length-content.v1',
    sha256: `sha256:${hash.digest('hex')}`,
    bytes,
    files: Object.freeze(records),
  });
}

function normalizeReport(report, label) {
  assert(plainObject(report), `${label}.report must be an object`);
  for (const key of REPORT_KEYS) assert(Array.isArray(report[key]), `${label}.report.${key} must be an array`);
  assert(PROVENANCE.has(report.readProvenance), `${label}.report.readProvenance must be complete, incomplete, or unsupported`);
  assert(PROVENANCE.has(report.writeProvenance), `${label}.report.writeProvenance must be complete, incomplete, or unsupported`);
  return Object.freeze({
    missingReads: normalizedStringArray(report.missingReads, `${label}.report.missingReads`),
    missingWrites: normalizedStringArray(report.missingWrites, `${label}.report.missingWrites`),
    extraReads: normalizedStringArray(report.extraReads, `${label}.report.extraReads`),
    extraWrites: normalizedStringArray(report.extraWrites, `${label}.report.extraWrites`),
    readProvenance: report.readProvenance,
    writeProvenance: report.writeProvenance,
  });
}

function intersection(sets) {
  if (sets.length === 0) return [];
  return [...sets.slice(1).reduce(
    (common, entries) => new Set([...common].filter((entry) => entries.has(entry))),
    new Set(sets[0]),
  )].sort();
}

export function aggregateConformance(profiles, results) {
  const registeredPathCount = profiles.reduce((count, profile) => count + profile.paths.length, 0);
  if (registeredPathCount === 0) {
    return Object.freeze({
      status: 'not-claimed',
      disposition: 'no-registered-acceptance-paths',
      scope: 'explicitly-registered-paths-only',
      limitationReason: 'repository acceptance suites have no universal D1 path-evidence registry in v0',
      complete: false,
      expectedPaths: 0,
      observedPaths: 0,
      pathEvidence: Object.freeze([]),
      underDeclarations: Object.freeze([]),
      overDeclarations: Object.freeze([]),
      diagnostics: Object.freeze([]),
    });
  }
  const resultByProfile = new Map(results.map((result) => [result.profileId, result]));
  const evidence = [];
  const diagnostics = [];
  for (const profile of profiles) {
    const returned = resultByProfile.get(profile.id)?.conformance ?? [];
    const byPath = new Map();
    for (const [index, item] of returned.entries()) {
      assert(plainObject(item), `profile ${profile.id} conformance[${index}] must be an object`);
      assert(typeof item.pathId === 'string' && item.pathId.length > 0, `profile ${profile.id} conformance[${index}].pathId must be a non-empty string`);
      assert(!byPath.has(item.pathId), `profile ${profile.id} returned duplicate conformance for ${item.pathId}`);
      byPath.set(item.pathId, item);
    }
    for (const path of profile.paths) {
      const item = byPath.get(path.id);
      if (!item || item.status !== 'observed') {
        const status = item?.status === 'unsupported' ? 'unsupported' : 'incomplete';
        evidence.push(Object.freeze({ profileId: profile.id, ...path, status, report: null }));
        diagnostics.push(diagnostic(
          status === 'unsupported' ? 'SNAPBACK_VERIFY_COVERAGE_PATH_UNSUPPORTED' : 'SNAPBACK_VERIFY_COVERAGE_PATH_INCOMPLETE',
          `registered acceptance path ${profile.id}/${path.id} has no complete D1 conformance observation`,
          { profileId: profile.id, pathId: path.id, kind: path.kind, targetProfileId: path.targetProfileId },
        ));
        continue;
      }
      const report = normalizeReport(item.report, `profile ${profile.id} path ${path.id}`);
      const status = report.readProvenance === 'unsupported' && report.writeProvenance === 'unsupported'
        ? 'unsupported'
        : report.readProvenance === 'complete' && report.writeProvenance === 'complete'
          ? 'authoritative'
          : 'incomplete';
      evidence.push(Object.freeze({ profileId: profile.id, ...path, status, report }));
      if (status !== 'authoritative') {
        diagnostics.push(diagnostic(
          status === 'unsupported'
            ? 'SNAPBACK_VERIFY_COVERAGE_EVIDENCE_UNSUPPORTED'
            : 'SNAPBACK_VERIFY_COVERAGE_EVIDENCE_INCOMPLETE',
          `registered path ${profile.id}/${path.id} was observed without complete read/write provenance`,
          {
            profileId: profile.id,
            pathId: path.id,
            readProvenance: report.readProvenance,
            writeProvenance: report.writeProvenance,
          },
          'warning',
        ));
      }
      const authoritativeMissingReads = report.readProvenance === 'complete' ? report.missingReads : [];
      const authoritativeMissingWrites = report.writeProvenance === 'complete' ? report.missingWrites : [];
      if (authoritativeMissingReads.length > 0 || authoritativeMissingWrites.length > 0) {
        diagnostics.push(diagnostic(
          'SNAPBACK_VERIFY_UNDER_DECLARATION',
          `registered path ${profile.id}/${path.id} observed undeclared reads or writes`,
          { profileId: profile.id, pathId: path.id, missingReads: authoritativeMissingReads, missingWrites: authoritativeMissingWrites },
        ));
      }
    }
    const extras = [...byPath.keys()].filter((pathId) => !profile.paths.some(({ id }) => id === pathId)).sort();
    assert(extras.length === 0, `profile ${profile.id} returned conformance for unregistered paths: ${extras.join(', ')}`);
  }
  evidence.sort((left, right) => `${left.targetProfileId}\0${left.kind}\0${left.profileId}\0${left.id}`.localeCompare(`${right.targetProfileId}\0${right.kind}\0${right.profileId}\0${right.id}`));
  const observed = evidence.filter(({ report }) => report !== null);
  const authoritative = evidence.filter(({ status }) => status === 'authoritative');
  const underDeclarations = observed.flatMap((entry) => {
    const missingReads = entry.report.readProvenance === 'complete' ? entry.report.missingReads : [];
    const missingWrites = entry.report.writeProvenance === 'complete' ? entry.report.missingWrites : [];
    return missingReads.length === 0 && missingWrites.length === 0
      ? []
      : [{ profileId: entry.profileId, pathId: entry.id, functionId: entry.functionId, missingReads, missingWrites }];
  });
  const byFunction = new Map();
  for (const entry of observed) {
    if (entry.functionId === null) continue;
    const current = byFunction.get(entry.functionId) ?? [];
    current.push(entry);
    byFunction.set(entry.functionId, current);
  }
  const overDeclarations = [...byFunction.entries()].flatMap(([functionId, entries]) => {
    const readEntries = entries.filter(({ report }) => report.readProvenance === 'complete');
    const writeEntries = entries.filter(({ report }) => report.writeProvenance === 'complete');
    const extraReads = intersection(readEntries.map(({ report }) => new Set(report.extraReads)));
    const extraWrites = intersection(writeEntries.map(({ report }) => new Set(report.extraWrites)));
    return extraReads.length === 0 && extraWrites.length === 0 ? [] : [{
      functionId,
      completeObservedPaths: { reads: readEntries.length, writes: writeEntries.length },
      extraReads,
      extraWrites,
      severity: 'warning',
    }];
  }).sort((left, right) => left.functionId.localeCompare(right.functionId));
  const missingEvidence = evidence.filter(({ report }) => report === null);
  const partialPaths = evidence.filter(({ status }) => status === 'incomplete' || status === 'unsupported');
  const complete = authoritative.length === evidence.length;
  const ok = missingEvidence.length === 0 && underDeclarations.length === 0;
  return Object.freeze({
    status: ok ? (complete ? 'passed' : 'partial') : 'failed',
    disposition: 'registered-path-aggregate-v0',
    scope: 'explicitly-registered-paths-only',
    limitationReason: 'repository acceptance suites have no universal D1 path-evidence registry in v0',
    complete,
    expectedPaths: evidence.length,
    observedPaths: observed.length,
    authoritativePaths: authoritative.length,
    partialPaths: partialPaths.length,
    pathEvidence: Object.freeze(evidence),
    underDeclarations: Object.freeze(underDeclarations),
    overDeclarations: Object.freeze(overDeclarations),
    diagnostics: Object.freeze(diagnostics),
  });
}

function runWithTimeout(work, timeoutMs, profileId) {
  let timer;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(verifyError(
        'SNAPBACK_VERIFY_PROFILE_TIMEOUT',
        `acceptance profile ${profileId} exceeded its ${timeoutMs}ms timeout`,
        { profileId, timeoutMs },
      )), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function runProfiles(config, context, options) {
  const output = [];
  for (const profile of config.profiles) {
    // Capture the bytes before execution. A runner that rewrites its own test
    // file cannot make the retained receipt describe post-run bytes instead
    // of the program that was selected to execute.
    const testBytes = digestFiles(config.configPath, profile.testFiles);
    const startedAtMs = Date.now();
    let returned;
    try {
      const timeoutMs = options.profileTimeoutMs ?? profile.timeoutMs ?? DEFAULT_VERIFY_PROFILE_TIMEOUT_MS;
      returned = await runWithTimeout(
        () => profile.run(Object.freeze({
          artifact: context.artifact,
          backendDirectory: config.backendDirectory,
          generatedDirectory: context.artifact?.generatedRoot ?? config.generatedDirectory,
          identityContext: context.identityContext,
          profileId: profile.id,
        })),
        timeoutMs,
        profile.id,
      );
      assert(plainObject(returned), `profile ${profile.id} must return an object`);
      assert(typeof returned.ok === 'boolean', `profile ${profile.id} must return boolean ok`);
    } catch (error) {
      returned = {
        ok: false,
        diagnostics: [error?.diagnostic ?? diagnostic(
          'SNAPBACK_VERIFY_PROFILE_THREW',
          error?.message ?? String(error),
          foreignCauseDetails(error, { profileId: profile.id }),
        )],
        conformance: [],
      };
    }
    const finishedAtMs = Date.now();
    let identityContext;
    try {
      identityContext = normalizeContext(returned.context ?? context.identityContext);
    } catch (error) {
      identityContext = context.identityContext;
      returned = {
        ...returned,
        ok: false,
        diagnostics: [
          ...(returned.diagnostics ?? []),
          error?.diagnostic ?? diagnostic(
            'SNAPBACK_VERIFY_PROFILE_IDENTITY_INVALID',
            error?.message ?? String(error),
            foreignCauseDetails(error, { profileId: profile.id }),
          ),
        ],
      };
    }
    const identityGaps = [
      identityContext.target.identity === null ? 'target.identity' : null,
      identityContext.data.identity === null ? 'data.identity' : null,
      identityContext.authority.identity === null ? 'authority.identity' : null,
      identityContext.seed.kind === 'not-exercised' ? 'seed.kind' : null,
    ].filter(Boolean);
    if (identityGaps.length > 0) {
      returned = {
        ...returned,
        ok: false,
        diagnostics: [
          ...(returned.diagnostics ?? []),
          diagnostic(
            'SNAPBACK_VERIFY_PROFILE_IDENTITY_INCOMPLETE',
            `acceptance profile ${profile.id} did not bind every required execution identity`,
            { profileId: profile.id, identityGaps },
          ),
        ],
      };
    }
    output.push(Object.freeze({
      profileId: profile.id,
      title: profile.title,
      status: returned.ok ? 'passed' : 'failed',
      startedAtMs,
      finishedAtMs,
      durationMs: finishedAtMs - startedAtMs,
      testBytes,
      context: identityContext,
      conformance: Array.isArray(returned.conformance) ? returned.conformance : [],
      diagnostics: Object.freeze(returned.diagnostics ?? []),
    }));
  }
  return Object.freeze(output);
}

function stage(id, result, { blocked = false } = {}) {
  const ok = result?.ok === true;
  return Object.freeze({
    id,
    status: blocked || result?.blocked ? 'blocked' : ok ? 'passed' : 'failed',
    diagnostics: Object.freeze(result?.diagnostics ?? []),
    evidence: result?.evidence ?? null,
  });
}

async function safeProbe(probe, ...args) {
  try {
    return await probe(...args);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [error?.diagnostic ?? diagnostic(
        'SNAPBACK_VERIFY_PROBE_FAILED',
        error?.message ?? String(error),
        foreignCauseDetails(error),
      )],
    };
  }
}

function targetUsesLocalPackagedRuntime(artifact) {
  const targetProfileId = artifact?.manifests?.capability?.targetProfileId ?? null;
  return targetProfileId === null
    || targetProfileId.startsWith('local-')
    || targetProfileId.startsWith('local.');
}

export async function runVerify(config, options = {}) {
  const startedAtMs = options.now?.() ?? Date.now();
  const profileSetTestBytes = digestFiles(
    config.configPath,
    config.profiles.flatMap(({ testFiles }) => testFiles),
  );
  const artifact = await safeProbe(options.artifactProbe ?? probeArtifactFreshness, config);
  const runtime = artifact.ok
    ? targetUsesLocalPackagedRuntime(artifact)
      ? await safeProbe(
        options.runtimeProbe ?? (() => ({ ok: false, diagnostics: [diagnostic('SNAPBACK_VERIFY_RUNTIME_PROBE_MISSING', 'no runtime readiness verifier was supplied')]})),
        artifact,
        config,
      )
      : {
          ok: true,
          skipped: true,
          diagnostics: [],
          evidence: {
            disposition: 'not-applicable-non-local-target',
            targetProfileId: artifact.manifests.capability.targetProfileId,
            claim: false,
            nonclaim: 'the local packaged runtime readiness probe does not apply to this non-local target',
          },
        }
    : { ok: false, blocked: true, diagnostics: [] };
  const admission = artifact.ok && runtime.ok
    ? await safeProbe(options.admissionProbe ?? probeAdmission, artifact, config)
    : { ok: false, blocked: true, diagnostics: [] };
  const capabilities = artifact.ok && admission.ok
    ? await safeProbe(options.capabilityProbe ?? probeCapabilities, artifact, config.profiles, config)
    : { ok: false, blocked: true, diagnostics: [], required: [], supported: [], missing: [] };
  // Profile execution is the observation source for D1 coverage, whose
  // judgement precedes capability and acceptance verdicts in the receipt.
  // Capability resolution still gates the final acceptance stage; a missing
  // capability never turns a profile outcome into a passing acceptance claim.
  const canRunProfiles = artifact.ok && runtime.ok && admission.ok;
  const identityContext = normalizeContext({
    ...config.context,
    target: config.context.target.identity === null && artifact.identity?.inputsHash
      ? { ...config.context.target, identity: artifact.identity.inputsHash }
      : config.context.target,
    seed: config.context.seed.identity === null && artifact.seedIdentity
      ? artifact.seedIdentity
      : config.context.seed,
  });
  const profileResults = canRunProfiles
    ? await runProfiles(config, { artifact, identityContext }, options)
    : Object.freeze([]);
  const registeredPathCount = config.profiles.reduce((count, profile) => count + profile.paths.length, 0);
  let conformance;
  if (canRunProfiles) {
    try {
      conformance = aggregateConformance(config.profiles, profileResults);
    } catch (error) {
      conformance = Object.freeze({
        status: 'failed', disposition: 'invalid-profile-conformance', complete: false,
        scope: 'explicitly-registered-paths-only',
        limitationReason: 'one or more acceptance profiles returned malformed conformance evidence',
        expectedPaths: registeredPathCount,
        observedPaths: 0, authoritativePaths: 0, partialPaths: 0,
        pathEvidence: [], underDeclarations: [], overDeclarations: [],
        diagnostics: [diagnostic(
          'SNAPBACK_VERIFY_CONFORMANCE_INVALID',
          error?.message ?? String(error),
          {
            causeCode: error?.code ?? null,
            causeDiagnostic: error?.diagnostic ?? null,
          },
        )],
      });
    }
  } else if (registeredPathCount === 0) {
    // @ref LLP 0245#rollout-4-implementation-note--2026-08-15 — an upstream
    // verify failure cannot turn an empty registered path set into coverage.
    // Preserve the same zero-path nonclaim shape the aggregate producer emits.
    conformance = aggregateConformance(config.profiles, profileResults);
  } else {
    conformance = Object.freeze({
      status: 'blocked', disposition: 'upstream-stage-failed', complete: false,
      scope: 'explicitly-registered-paths-only',
      limitationReason: 'repository acceptance suites have no universal D1 path-evidence registry in v0',
      expectedPaths: registeredPathCount, observedPaths: 0,
      pathEvidence: [], underDeclarations: [], overDeclarations: [], diagnostics: [],
    });
  }
  const admissionAndConformance = {
    ok: admission.ok && ['passed', 'partial', 'not-claimed'].includes(conformance.status),
    blocked: admission.blocked,
    diagnostics: [...(admission.diagnostics ?? []), ...(conformance.diagnostics ?? [])],
    evidence: {
      admissionMode: admission.mode ?? null,
      conformance,
    },
  };
  const acceptance = {
    ok: canRunProfiles && capabilities.ok && profileResults.every(({ status }) => status === 'passed'),
    blocked: !canRunProfiles || !capabilities.ok,
    diagnostics: profileResults.flatMap(({ diagnostics }) => diagnostics),
    evidence: { profiles: profileResults },
  };
  const stages = Object.freeze([
    stage('artifact-freshness', {
      ...artifact,
      evidence: artifact.ok ? {
        identity: artifact.identity,
        generatedRoot: artifact.generatedRoot,
        verifiedGraph: artifact.verifiedGraph ?? null,
      } : null,
    }),
    stage('runtime-readiness', {
      ...runtime,
      evidence: runtime.ok ? (runtime.evidence ?? runtime.receipt ?? null) : null,
    }),
    stage('admission-and-conformance', admissionAndConformance),
    stage('capability-resolution', {
      ...capabilities,
      evidence: capabilities.blocked ? null : {
        targetProfileId: capabilities.targetProfileId ?? null,
        required: capabilities.required,
        supported: capabilities.supported,
        missing: capabilities.missing,
      },
    }),
    stage('acceptance-profiles', acceptance),
  ]);
  const next = Object.freeze(stages.filter(({ status }) => status === 'failed').map(({ id }) => NEXT_BY_STAGE[id]));
  const finishedAtMs = options.now?.() ?? Date.now();
  const allStagesPassed = stages.every(({ status }) => status === 'passed');
  const acceptanceRegistered = config.profiles.length > 0;
  const receipt = {
    artifactKind: 'snapbackVerifyReceipt',
    schemaVersion: VERIFY_RECEIPT_SCHEMA_VERSION,
    ok: allStagesPassed,
    status: allStagesPassed
      ? acceptanceRegistered ? 'passed' : 'passed-without-acceptance'
      : 'failed',
    startedAtMs,
    finishedAtMs,
    durationMs: finishedAtMs - startedAtMs,
    profileSet: {
      ids: config.profiles.map(({ id }) => id).sort(),
      identity: `sha256:${createHash('sha256').update(stableJson(config.profiles.map((profile) => ({
        id: profile.id,
        requiredCapabilities: profile.requiredCapabilities,
        paths: profile.paths,
      })))).digest('hex')}`,
      testBytes: profileSetTestBytes,
    },
    context: identityContext,
    stages,
    acceptanceProfiles: profileResults,
    next,
    ...(next.length === 1 ? { recommendedNext: next[0] } : {}),
    nonclaims: Object.freeze([
      'a passing receipt proves readiness under the registered contract, not product completion',
      'no registered acceptance paths means D1 aggregate coverage is not claimed',
      'generated-artifact-local-admission does not claim a live target admitted the same bytes',
      ...(!targetUsesLocalPackagedRuntime(artifact)
        ? ['the local packaged runtime readiness probe was skipped and makes no claim about the non-local target runtime']
        : []),
      'this receipt does not perform semantic review or satisfy LLP 0115 CV-14 review custody',
    ]),
  };
  return Object.freeze(receipt);
}

export function validateVerifyReceipt(receipt) {
  if (!plainObject(receipt) || receipt.artifactKind !== 'snapbackVerifyReceipt' || receipt.schemaVersion !== VERIFY_RECEIPT_SCHEMA_VERSION) {
    throw verifyError('SNAPBACK_VERIFY_RECEIPT_INVALID', 'receipt kind or schema version is invalid');
  }
  if (!Array.isArray(receipt.stages) || receipt.stages.length !== VERIFY_STAGE_IDS.length
    || receipt.stages.some((entry, index) => entry.id !== VERIFY_STAGE_IDS[index])) {
    throw verifyError('SNAPBACK_VERIFY_RECEIPT_INVALID', 'receipt does not contain the five ordered verify stages');
  }
  if (!Array.isArray(receipt.next) || (receipt.recommendedNext !== undefined && (receipt.next.length !== 1 || stableJson(receipt.recommendedNext) !== stableJson(receipt.next[0])))) {
    throw verifyError('SNAPBACK_VERIFY_RECEIPT_INVALID', 'recommendedNext is present without one mechanically unique next action');
  }
  return receipt;
}

export function writeVerifyReceipt(path, receipt) {
  validateVerifyReceipt(receipt);
  const output = resolve(path);
  const temporary = `${output}.tmp-${process.pid}`;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, output);
  return output;
}

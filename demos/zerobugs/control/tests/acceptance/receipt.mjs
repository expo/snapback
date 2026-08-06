import {createHash, randomUUID} from 'node:crypto';
import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  unlink,
} from 'node:fs/promises';
import {arch, cpus, hostname, platform, tmpdir} from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

// @ref LLP 0183#d1--comparator-manifest-and-current-surface-control — every
// provider attempt is retained as immutable, identity-bound evidence.

export const RECEIPT_SCHEMA_VERSION = 'zerobugs-gate-receipt.v1';
export const CONTROL_ROOT = resolve(import.meta.dirname, '../..');
export const DEFAULT_EVIDENCE_DIR = resolve(CONTROL_ROOT, '../evidence');

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ARM = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;
const GATE = /^zb[0-7]$/u;
const ATTEMPT = /^v[1-9][0-9]*$/u;
const CHECK_STATUSES = new Set(['PASS', 'GAP', 'FAIL', 'MISSING']);
const OUTCOMES = new Set(['PASS', 'GAP', 'FAIL']);

// The composition contract names the first group. The remainder are common
// Snapback/provider carriers that must never be copied into an evidence file.
export const KNOWN_SECRET_NAMES = Object.freeze([
  'ZERBUGS_UNSUBSCRIBE_HMAC_SECRET',
  'ZERBUGS_UPLOAD_HMAC_SECRET',
  'ZERBUGS_CAPTURE_ADAPTER_AUTH',
  'ZERBUGS_LOOPS_TRANSACTIONAL_ID',
  'loopsApiKey',
  'discordWebhookToken',
  'captureAdapterAuth',
  'SNAPBACK_ADMIN_TOKEN',
  'SNAPBACK_APP_SESSION_BEARER',
  'SNAPBACK_SESSION_BEARER',
  'SNAPBACK_IMPERSONATION_CAPABILITY',
  'SNAPBACK_DEPLOY_TOKEN',
  'LOOPS_EMAIL_API_KEY',
  'DISCORD_WEBHOOK_TOKEN',
  'FLY_API_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
]);

const OBVIOUS_SECRET_PATTERNS = Object.freeze([
  {
    label: 'unredacted bearer',
    pattern: /\bBearer\s+(?!<redacted>|\[redacted\]|REDACTED\b)[A-Za-z0-9._~+/=-]{8,}/iu,
  },
  {
    label: 'JWT-shaped credential',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  },
  {
    label: 'provider or Snapback token',
    pattern: /\b(?:sk-(?:proj-)?|ghp_|github_pat_|xox[baprs]-|sbic_|sbs_|sbadmin_)[A-Za-z0-9._~-]{8,}\b/iu,
  },
  {
    label: 'AWS access key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/u,
  },
  {
    label: 'Discord webhook credential',
    pattern: /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9._~-]+/iu,
  },
  {
    label: 'private key material',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  },
]);

const SENSITIVE_FIELD = /(?:^|[_-])(?:secret|password|passwd|bearer|token|credential|authorization|cookie|api[_-]?key|admin[_-]?token)s?$/iu;
const REDACTED_VALUE = /^(?:<redacted>|\[redacted\]|redacted|none|not-used|not-applicable)$/iu;

export function receiptError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = Object.freeze({code, message, details: Object.freeze({...details})});
  return error;
}

export function sha256Bytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export async function sha256File(path) {
  return sha256Bytes(await readFile(path));
}

export function machineIdentity() {
  return Object.freeze({
    platform: platform(),
    arch: arch(),
    cpuCount: cpus().length,
    hostnameSha256: sha256Bytes(hostname()),
  });
}

export function receiptPathFor({arm, gate, attempt}, evidenceDir = DEFAULT_EVIDENCE_DIR) {
  validateName('arm', arm, ARM);
  validateName('gate', gate, GATE);
  validateName('attempt', attempt, ATTEMPT);
  return join(resolve(evidenceDir), `${arm}.${gate}.${attempt}.json`);
}

/**
 * Validate a complete receipt without touching the filesystem. ZB0 uses this
 * directly for its zero-check refusal witness.
 */
export function validateReceipt(receipt) {
  requireRecord(receipt, 'receipt');
  validateName('arm', receipt.arm, ARM);
  validateName('gate', receipt.gate, GATE);
  validateName('attempt', receipt.attempt, ATTEMPT);
  validateChecks(receipt);

  const required = [
    'schemaVersion',
    'startedAt',
    'completedAt',
    'outcome',
    'execution',
    'manifest',
    'generatedIdentities',
    'componentReleaseIdentities',
    'fixtureIdentity',
    'actorIdentity',
    'browserIdentity',
    'machineIdentity',
    'network',
    'targetIdentity',
    'rawArtifacts',
    'capabilityFacts',
    'refusalFacts',
    'assistance',
    'workarounds',
    'sourceAccounting',
    'custodyAccounting',
    'cleanup',
    'diagnostics',
  ];
  for (const key of required) {
    if (!(key in receipt)) {
      throw receiptError('ZBUGS_RECEIPT_INVALID', `receipt.${key} is required`, {field: key});
    }
  }

  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', 'receipt schema version is not supported');
  }
  validateTimestamp(receipt.startedAt, 'startedAt');
  validateTimestamp(receipt.completedAt, 'completedAt');
  if (Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', 'receipt completion precedes its start');
  }
  if (!OUTCOMES.has(receipt.outcome)) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', 'receipt outcome must be PASS, GAP, or FAIL');
  }
  const execution = requireRecord(receipt.execution, 'execution');
  if (execution.status !== 'PASS' && execution.status !== 'FAIL') {
    throw receiptError('ZBUGS_RECEIPT_INVALID', 'execution.status must be PASS or FAIL');
  }

  const manifest = requireRecord(receipt.manifest, 'manifest');
  requireNonemptyString(manifest.id, 'manifest.id');
  requireDigest(manifest.sha256, 'manifest.sha256');
  requireNonemptyString(manifest.path, 'manifest.path');

  validateIdentityArray(receipt.generatedIdentities, 'generatedIdentities');
  validateIdentityArray(receipt.componentReleaseIdentities, 'componentReleaseIdentities');
  requireRecord(receipt.fixtureIdentity, 'fixtureIdentity');
  requireRecord(receipt.actorIdentity, 'actorIdentity');
  const browser = requireRecord(receipt.browserIdentity, 'browserIdentity');
  requireNonemptyString(browser.mode, 'browserIdentity.mode');
  const machine = requireRecord(receipt.machineIdentity, 'machineIdentity');
  requireNonemptyString(machine.platform, 'machineIdentity.platform');
  requireNonemptyString(machine.arch, 'machineIdentity.arch');
  if (!Number.isInteger(machine.cpuCount) || machine.cpuCount <= 0) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', 'machineIdentity.cpuCount must be positive');
  }
  requireDigest(machine.hostnameSha256, 'machineIdentity.hostnameSha256');
  if ('hostname' in machine) {
    throw receiptError('ZBUGS_RECEIPT_SECRET_MATERIAL', 'raw machine hostname is forbidden');
  }
  requireNonemptyString(receipt.network, 'network');
  requireRecord(receipt.targetIdentity, 'targetIdentity');

  validateArtifactArray(receipt.rawArtifacts);
  for (const key of ['capabilityFacts', 'refusalFacts', 'assistance', 'workarounds']) {
    if (!Array.isArray(receipt[key])) {
      throw receiptError('ZBUGS_RECEIPT_INVALID', `receipt.${key} must be an array`);
    }
  }
  requireRecord(receipt.sourceAccounting, 'sourceAccounting');
  requireRecord(receipt.custodyAccounting, 'custodyAccounting');
  validateCleanup(receipt.cleanup);
  validateDiagnostics(receipt.diagnostics);

  validateJsonValue(receipt, '$', new Set());
  scanForSecrets(receipt);

  const counts = receipt.checks.counts;
  const expectedOutcome = counts.fail > 0
    || counts.missing > 0
    || receipt.cleanup.status === 'FAIL'
    || execution.status === 'FAIL'
    ? 'FAIL'
    : counts.gap > 0 ? 'GAP' : 'PASS';
  if (receipt.outcome !== expectedOutcome) {
    throw receiptError(
      'ZBUGS_RECEIPT_INVALID',
      `receipt outcome ${receipt.outcome} disagrees with ${expectedOutcome} accounting`,
    );
  }
  return receipt;
}

/**
 * Publish one immutable receipt. A complete temporary file is hard-linked to
 * the final name so an existing attempt can never be replaced, even across a
 * racing writer. The final receipt is made read-only after publication.
 */
export async function writeReceipt(receipt, {evidenceDir = DEFAULT_EVIDENCE_DIR} = {}) {
  validateReceipt(receipt);
  const finalPath = receiptPathFor(receipt, evidenceDir);
  const directory = dirname(finalPath);
  const bytes = `${canonicalStringify(receipt)}\n`;
  await mkdir(directory, {recursive: true, mode: 0o755});

  const temporary = join(directory, `.${basename(finalPath)}.tmp-${process.pid}-${randomUUID()}`);
  let handle = null;
  let published = false;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await link(temporary, finalPath);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw receiptError(
          'ZBUGS_RECEIPT_EXISTS',
          'immutable attempt path already exists; increment the attempt suffix',
          {path: finalPath},
        );
      }
      throw error;
    }
    published = true;
    await chmod(finalPath, 0o444);
  } catch (error) {
    if (published) await unlink(finalPath).catch(() => {});
    throw error;
  } finally {
    if (handle !== null) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }

  return Object.freeze({
    path: finalPath,
    sha256: sha256Bytes(bytes),
    receipt,
  });
}

export function redactDiagnostic(value) {
  const envValues = knownEnvironmentSecretValues();
  const visit = (candidate, depth) => {
    if (depth > 12) return '<redacted-depth-limit>';
    if (candidate === null || typeof candidate === 'boolean' || typeof candidate === 'number') {
      return candidate;
    }
    if (typeof candidate === 'string') return redactString(candidate, envValues);
    if (Array.isArray(candidate)) return candidate.slice(0, 128).map(entry => visit(entry, depth + 1));
    if (candidate && typeof candidate === 'object') {
      const output = {};
      for (const [key, entry] of Object.entries(candidate).slice(0, 128)) {
        output[key] = SENSITIVE_FIELD.test(key) ? '<redacted>' : visit(entry, depth + 1);
      }
      return output;
    }
    return redactString(String(candidate), envValues);
  };
  return visit(value, 0);
}

function validateChecks(receipt) {
  const checks = requireRecord(receipt.checks, 'checks');
  const expected = checks.expected;
  const executed = checks.executed;
  if (!Number.isInteger(expected) || expected <= 0 || !Number.isInteger(executed) || executed <= 0) {
    throw receiptError(
      'ZBUGS_RECEIPT_ZERO_CHECKS',
      'a receipt requires positive expected and executed check counts',
      {expected: Number.isInteger(expected) ? expected : null, executed: Number.isInteger(executed) ? executed : null},
    );
  }
  if (!Array.isArray(checks.rows)) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', 'checks.rows must be an array');
  }
  if (checks.rows.length !== expected) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', 'checks.rows must account for every expected check');
  }
  const ids = new Set();
  const actual = {pass: 0, gap: 0, fail: 0, missing: 0};
  for (const [index, candidate] of checks.rows.entries()) {
    const row = requireRecord(candidate, `checks.rows[${index}]`);
    requireNonemptyString(row.id, `checks.rows[${index}].id`);
    if (ids.has(row.id)) throw receiptError('ZBUGS_RECEIPT_INVALID', `duplicate check id ${row.id}`);
    ids.add(row.id);
    if (!CHECK_STATUSES.has(row.status)) {
      throw receiptError('ZBUGS_RECEIPT_INVALID', `check ${row.id} has an invalid status`);
    }
    actual[row.status.toLowerCase()] += 1;
  }
  if (executed !== expected - actual.missing) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', 'executed count disagrees with missing rows');
  }
  const counts = requireRecord(checks.counts, 'checks.counts');
  for (const key of Object.keys(actual)) {
    if (counts[key] !== actual[key]) {
      throw receiptError('ZBUGS_RECEIPT_INVALID', `checks.counts.${key} is inconsistent`);
    }
  }
  if (!Array.isArray(checks.missing)) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', 'checks.missing must be an array');
  }
  const missingIds = checks.rows.filter(row => row.status === 'MISSING').map(row => row.id);
  if (JSON.stringify(checks.missing) !== JSON.stringify(missingIds)) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', 'checks.missing must name the missing rows in order');
  }
}

function validateIdentityArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', `${label} must contain at least one identity`);
  }
  for (const [index, candidate] of value.entries()) {
    const identity = requireRecord(candidate, `${label}[${index}]`);
    requireNonemptyString(identity.id, `${label}[${index}].id`);
    if ('sha256' in identity) requireDigest(identity.sha256, `${label}[${index}].sha256`);
  }
}

function validateArtifactArray(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', 'rawArtifacts must contain at least one artifact');
  }
  const paths = new Set();
  for (const [index, candidate] of value.entries()) {
    const artifact = requireRecord(candidate, `rawArtifacts[${index}]`);
    requireNonemptyString(artifact.path, `rawArtifacts[${index}].path`);
    requireDigest(artifact.sha256, `rawArtifacts[${index}].sha256`);
    if (isAbsolute(artifact.path)) {
      throw receiptError('ZBUGS_RECEIPT_INVALID', 'raw artifact paths must be repository-relative');
    }
    if (paths.has(artifact.path)) {
      throw receiptError('ZBUGS_RECEIPT_INVALID', `duplicate raw artifact ${artifact.path}`);
    }
    paths.add(artifact.path);
  }
}

function validateCleanup(value) {
  const cleanup = requireRecord(value, 'cleanup');
  if (cleanup.status !== 'PASS' && cleanup.status !== 'FAIL') {
    throw receiptError('ZBUGS_RECEIPT_INVALID', 'cleanup.status must be PASS or FAIL');
  }
  if (!Array.isArray(cleanup.targets)) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', 'cleanup.targets must be an array');
  }
  visitCleanupTargets(cleanup, 'cleanup');
}

function visitCleanupTargets(value, path) {
  if (typeof value === 'string') {
    if (isAbsolute(value) && !isSafeAbsoluteCleanupTarget(value)) {
      throw receiptError(
        'ZBUGS_RECEIPT_UNSAFE_CLEANUP_TARGET',
        'absolute cleanup target is outside an owned scratch namespace',
        {field: path},
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitCleanupTargets(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      visitCleanupTargets(entry, `${path}.${key}`);
    }
  }
}

function isSafeAbsoluteCleanupTarget(value) {
  const candidate = resolve(value);
  const roots = [
    resolve(tmpdir()),
    resolve('/tmp'),
    resolve('/private/tmp'),
    resolve('/var/folders'),
    resolve('/private/var/folders'),
    resolve(CONTROL_ROOT, '.snapback'),
  ];
  return roots.some(root => {
    const rest = relative(root, candidate);
    return rest !== '' && rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest);
  });
}

function validateDiagnostics(value) {
  if (!Array.isArray(value)) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', 'diagnostics must be an array');
  }
  for (const [index, candidate] of value.entries()) {
    const diagnostic = requireRecord(candidate, `diagnostics[${index}]`);
    if (diagnostic.redacted !== true) {
      throw receiptError('ZBUGS_RECEIPT_INVALID', 'every retained diagnostic must attest redaction');
    }
  }
}

function scanForSecrets(receipt) {
  const serialized = JSON.stringify(receipt);
  const lower = serialized.toLowerCase();
  for (const name of KNOWN_SECRET_NAMES) {
    if (lower.includes(name.toLowerCase())) {
      throw receiptError(
        'ZBUGS_RECEIPT_SECRET_MATERIAL',
        'receipt contains a known secret or credential field name',
        {class: 'known-secret-name'},
      );
    }
  }
  for (const {label, pattern} of OBVIOUS_SECRET_PATTERNS) {
    if (pattern.test(serialized)) {
      throw receiptError(
        'ZBUGS_RECEIPT_SECRET_MATERIAL',
        `receipt contains ${label}`,
        {class: label},
      );
    }
  }
  for (const value of knownEnvironmentSecretValues()) {
    if (serialized.includes(value)) {
      throw receiptError(
        'ZBUGS_RECEIPT_SECRET_MATERIAL',
        'receipt contains the value of a known secret environment variable',
        {class: 'known-environment-value'},
      );
    }
  }
  visitSensitiveFields(receipt, '$');
}

function visitSensitiveFields(value, path) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitSensitiveFields(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_FIELD.test(key) && !safeSensitiveFieldValue(entry)) {
      throw receiptError(
        'ZBUGS_RECEIPT_SECRET_MATERIAL',
        'receipt contains a populated credential-shaped field',
        {field: `${path}.${key}`},
      );
    }
    visitSensitiveFields(entry, `${path}.${key}`);
  }
}

function safeSensitiveFieldValue(value) {
  return value === null
    || value === false
    || (typeof value === 'string' && (REDACTED_VALUE.test(value) || SHA256.test(value)));
}

function knownEnvironmentSecretValues() {
  const values = [];
  for (const name of KNOWN_SECRET_NAMES) {
    const value = process.env[name];
    if (typeof value === 'string' && value.length >= 4) values.push(value);
  }
  return values;
}

function redactString(value, environmentValues) {
  let output = value;
  for (const name of KNOWN_SECRET_NAMES) {
    output = output.replaceAll(name, '<redacted-secret-name>');
  }
  for (const secret of environmentValues) output = output.replaceAll(secret, '<redacted>');
  for (const {pattern} of OBVIOUS_SECRET_PATTERNS) {
    output = output.replace(new RegExp(pattern.source, pattern.flags), '<redacted>');
  }
  return output.length <= 4_096 ? output : `${output.slice(0, 4_096)}…`;
}

function validateJsonValue(value, path, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw receiptError('ZBUGS_RECEIPT_INVALID', `${path} is not finite`);
    return;
  }
  if (typeof value !== 'object') {
    throw receiptError('ZBUGS_RECEIPT_INVALID', `${path} is not JSON-compatible`);
  }
  if (ancestors.has(value)) throw receiptError('ZBUGS_RECEIPT_INVALID', `${path} is circular`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonValue(entry, `${path}[${index}]`, ancestors));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw receiptError('ZBUGS_RECEIPT_INVALID', `${path} is not a plain JSON object`);
    }
    for (const [key, entry] of Object.entries(value)) {
      validateJsonValue(entry, `${path}.${key}`, ancestors);
    }
    if (Object.values(value).some(entry => entry === undefined)) {
      throw receiptError('ZBUGS_RECEIPT_INVALID', `${path} contains undefined`);
    }
  }
  ancestors.delete(value);
}

function canonicalStringify(value) {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, sortJson(value[key])]),
  );
}

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', `${label} must be an object`);
  }
  return value;
}

function requireNonemptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw receiptError('ZBUGS_RECEIPT_INVALID', `${label} must be a nonempty string`);
  }
}

function requireDigest(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', `${label} must be a sha256 digest`);
  }
}

function validateName(label, value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', `${label} has an invalid immutable-receipt name`);
  }
}

function validateTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw receiptError('ZBUGS_RECEIPT_INVALID', `${label} must be an ISO timestamp`);
  }
}

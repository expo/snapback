import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

// @ref LLP 0134#2-the-promotion-evidence-bar — maturity evidence is retained
// as closed canonical JSON, with digest-bound locators and cell-complete soak
// populations rather than prose assertions.
// @ref LLP 0134#4-the-promotion-act — candidate-parent and staged-tree binding
// make the audited tree, not elapsed time or branch intent, the promotion fact.

export const MATURITY_RECORD_SUFFIXES = Object.freeze([
  '.promotion.json',
  '.demotion.json',
  '.grandfather.json',
  '.soak-observation.json',
  '.soak-extract.json',
  '.defect-search.json',
]);

export const GRANDFATHERED_DIRECT_IDS = Object.freeze([
  'inline_handler_v1',
  'registered_bundle_boot_v1',
  'result_contract_v1',
  'versioned_seed_install_v1',
  'versioned_seed_reset_v1',
]);

const COUPLED_CAPABILITY_SETS = Object.freeze([
  Object.freeze(['bounded_children_v1', 'write_activity_v1']),
  Object.freeze(['versioned_seed_install_v1', 'versioned_seed_reset_v1']),
]);
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export class MaturityValidationError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'MaturityValidationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MaturityValidationError(code, message);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(repoRoot, args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: options.encoding === null ? null : 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', options.quiet ? 'ignore' : 'pipe'],
  });
}

function exactKeys(value, required, optional, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('MATURITY_SCHEMA_INVALID', `${label} must be an object`);
  }
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(value);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail('MATURITY_SCHEMA_INVALID', `${label} is missing ${key}`);
    }
  }
  for (const key of actual) {
    if (!allowed.has(key)) {
      fail('MATURITY_SCHEMA_INVALID', `${label} has unknown member ${key}`);
    }
  }
}

function nonEmptyString(value, label, pattern = null) {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    fail('MATURITY_SCHEMA_INVALID', `${label} is invalid`);
  }
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('MATURITY_SCHEMA_INVALID', `${label} must be a nonnegative safe integer`);
  }
}

function closedEnum(value, choices, label) {
  if (!choices.includes(value)) {
    fail('MATURITY_SCHEMA_INVALID', `${label} must be one of ${choices.join(', ')}`);
  }
}

function sortedUniqueStrings(values, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    fail('MATURITY_SCHEMA_INVALID', `${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  }
  for (const [index, value] of values.entries()) nonEmptyString(value, `${label}[${index}]`, ID);
  const sorted = [...values].sort();
  if (new Set(values).size !== values.length || canonicalJson(sorted) !== canonicalJson(values)) {
    fail('MATURITY_SCHEMA_INVALID', `${label} must be bytewise sorted and unique`);
  }
  return values;
}

function capabilityIds(values, label = 'capabilityIds') {
  sortedUniqueStrings(values, label);
  for (const coupled of COUPLED_CAPABILITY_SETS) {
    if (coupled.some((id) => values.includes(id)) && canonicalJson(coupled) !== canonicalJson(values)) {
      fail('MATURITY_ATOMIC_SET_INVALID', `${label} must preserve coupled set ${coupled.join(' + ')}`);
    }
  }
  return values;
}

function safeRepoPath(path, label) {
  nonEmptyString(path, label);
  if (isAbsolute(path) || path.includes('\\') || path.split('/').includes('..') || path.startsWith('./')) {
    fail('MATURITY_LOCATOR_INVALID', `${label} must be a normalized repo-relative path`);
  }
  return path;
}

function recordSuffix(path) {
  return MATURITY_RECORD_SUFFIXES.find((suffix) => path.endsWith(suffix)) ?? null;
}

function listFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
      else fail('MATURITY_RECORD_PATH_INVALID', `${path} is not a regular file`);
    }
  }
  return files.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function readCanonicalRecord(path) {
  const bytes = readFileSync(path);
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    fail('MATURITY_JSON_INVALID', `${path}: ${error.message}`);
  }
  const expected = Buffer.from(`${canonicalJson(value)}\n`);
  if (!bytes.equals(expected)) {
    fail('MATURITY_CANONICAL_JSON_REQUIRED', `${path} must be sorted, minified canonical JSON plus one newline`);
  }
  return { bytes, value };
}

function commitIntroducing(repoRoot, repoPath) {
  try {
    const output = git(repoRoot, ['log', '--diff-filter=A', '--format=%H', '--', repoPath], { quiet: true });
    return output.trim().split('\n').filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
}

function commitUtcDate(repoRoot, commit) {
  const committerTimestamp = git(repoRoot, ['show', '-s', '--format=%cI', commit]).trim();
  return new Date(committerTimestamp).toISOString().slice(0, 10);
}

function bytesAt(repoRoot, sourceSha, repoPath) {
  try {
    return git(repoRoot, ['show', `${sourceSha}:${repoPath}`], { encoding: null, quiet: true });
  } catch {
    fail('MATURITY_LOCATOR_UNRESOLVED', `${sourceSha}:${repoPath} does not resolve`);
  }
}

function validateLocator(locator, label, context, { staged = false } = {}) {
  exactKeys(locator, ['path', 'sha256', 'schemaVersion', 'producer', 'sourceSha'], [], label);
  safeRepoPath(locator.path, `${label}.path`);
  nonEmptyString(locator.sha256, `${label}.sha256`, SHA256);
  nonEmptyString(locator.schemaVersion, `${label}.schemaVersion`, ID);
  nonEmptyString(locator.producer, `${label}.producer`, ID);
  nonEmptyString(locator.sourceSha, `${label}.sourceSha`, GIT_SHA);
  let bytes;
  if (staged) {
    if (locator.sourceSha !== context.candidateSourceSha || !context.recordCommit) {
      fail('MATURITY_STAGED_LOCATOR_INVALID', `${label} must bind the candidate parent and transition commit`);
    }
    bytes = bytesAt(context.repoRoot, context.recordCommit, locator.path);
  } else {
    bytes = bytesAt(context.repoRoot, locator.sourceSha, locator.path);
  }
  if (sha256(bytes) !== locator.sha256) {
    fail('MATURITY_LOCATOR_DIGEST_MISMATCH', `${label} digest does not match ${locator.path}`);
  }
  return locator;
}

function validateLocatorList(values, label, context, options = {}) {
  if (!Array.isArray(values) || values.length === 0) {
    fail('MATURITY_SCHEMA_INVALID', `${label} must be a non-empty array`);
  }
  return values.map((value, index) => validateLocator(value, `${label}[${index}]`, context, options));
}

function validateCarrierDigest(value, label, context) {
  exactKeys(value, ['path', 'sha256'], [], label);
  safeRepoPath(value.path, `${label}.path`);
  nonEmptyString(value.sha256, `${label}.sha256`, SHA256);
  const bytes = bytesAt(context.repoRoot, context.headSha, value.path);
  if (sha256(bytes) !== value.sha256) {
    fail('MATURITY_CARRIER_DIGEST_MISMATCH', `${label} does not match ${context.headSha}:${value.path}`);
  }
}

function parseUtcTimestamp(value, label) {
  nonEmptyString(value, label, UTC_TIMESTAMP);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail('MATURITY_SCHEMA_INVALID', `${label} is not a real UTC timestamp`);
  return parsed;
}

function utcDays(start, end) {
  const days = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() < end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function validatePopulation(value, label) {
  exactKeys(value, ['localProfileIds', 'hostedDeployments'], [], label);
  sortedUniqueStrings(value.localProfileIds, `${label}.localProfileIds`);
  if (!Array.isArray(value.hostedDeployments)) {
    fail('MATURITY_SCHEMA_INVALID', `${label}.hostedDeployments must be an array`);
  }
  const seen = new Set();
  for (const [index, hosted] of value.hostedDeployments.entries()) {
    exactKeys(hosted, ['targetProfileId', 'deploymentIdentity'], [], `${label}.hostedDeployments[${index}]`);
    nonEmptyString(hosted.targetProfileId, `${label}.hostedDeployments[${index}].targetProfileId`, ID);
    nonEmptyString(hosted.deploymentIdentity, `${label}.hostedDeployments[${index}].deploymentIdentity`, ID);
    const key = `${hosted.targetProfileId}\0${hosted.deploymentIdentity}`;
    if (seen.has(key)) fail('MATURITY_SCHEMA_INVALID', `${label}.hostedDeployments contains a duplicate`);
    seen.add(key);
  }
  const sorted = [...value.hostedDeployments].sort((left, right) =>
    Buffer.compare(Buffer.from(`${left.targetProfileId}\0${left.deploymentIdentity}`), Buffer.from(`${right.targetProfileId}\0${right.deploymentIdentity}`)));
  if (canonicalJson(sorted) !== canonicalJson(value.hostedDeployments)) {
    fail('MATURITY_SCHEMA_INVALID', `${label}.hostedDeployments must be bytewise sorted`);
  }
  return value;
}

function validateWindow(value, label) {
  exactKeys(value, ['start', 'end', 'targetPopulation'], [], label);
  const start = parseUtcTimestamp(value.start, `${label}.start`);
  const end = parseUtcTimestamp(value.end, `${label}.end`);
  if (end <= start) fail('MATURITY_SCHEMA_INVALID', `${label}.end must follow start`);
  validatePopulation(value.targetPopulation, `${label}.targetPopulation`);
  return { start, end, value };
}

function validateObservation(record, context) {
  exactKeys(record, [
    'schemaVersion', 'capabilityIds', 'targetProfileId', 'dateUtc', 'headSha',
    'suiteProducer', 'carrierDigests', 'outcome',
  ], [], 'MaturitySoakObservationV1');
  if (record.schemaVersion !== 1) fail('MATURITY_SCHEMA_INVALID', 'observation schemaVersion must be 1');
  capabilityIds(record.capabilityIds);
  nonEmptyString(record.targetProfileId, 'targetProfileId', ID);
  nonEmptyString(record.dateUtc, 'dateUtc', DATE);
  nonEmptyString(record.headSha, 'headSha', GIT_SHA);
  nonEmptyString(record.suiteProducer, 'suiteProducer', ID);
  closedEnum(record.outcome, ['green', 'red'], 'outcome');
  if (!Array.isArray(record.carrierDigests) || record.carrierDigests.length === 0) {
    fail('MATURITY_SCHEMA_INVALID', 'carrierDigests must be non-empty');
  }
  const carrierContext = { ...context, headSha: record.headSha };
  record.carrierDigests.forEach((entry, index) =>
    validateCarrierDigest(entry, `carrierDigests[${index}]`, carrierContext));
  if (!context.recordCommit) {
    fail('MATURITY_OBSERVATION_UNCOMMITTED', `${context.repoPath} has no introducing commit`);
  }
  if (commitUtcDate(context.repoRoot, context.recordCommit) !== record.dateUtc) {
    fail('MATURITY_OBSERVATION_DATE_MISMATCH', `${context.repoPath} was not introduced on ${record.dateUtc} UTC`);
  }
  return record;
}

function validateExtract(record) {
  exactKeys(record, [
    'schemaVersion', 'capabilityIds', 'claimFamily', 'deploymentIdentity', 'window',
    'familyEpochs', 'renewalRecordDigests', 'withdrawalCount', 'expiryCount',
  ], [], 'MaturitySoakJournalExtractV1');
  if (record.schemaVersion !== 1) fail('MATURITY_SCHEMA_INVALID', 'extract schemaVersion must be 1');
  capabilityIds(record.capabilityIds);
  nonEmptyString(record.claimFamily, 'claimFamily', ID);
  nonEmptyString(record.deploymentIdentity, 'deploymentIdentity', ID);
  const { start, end } = validateWindow(record.window, 'window');
  if (!Array.isArray(record.familyEpochs) || record.familyEpochs.length === 0) {
    fail('MATURITY_SCHEMA_INVALID', 'familyEpochs must be non-empty');
  }
  let priorEpoch = -1;
  let cursor = start;
  for (const [index, epoch] of record.familyEpochs.entries()) {
    exactKeys(epoch, ['epoch', 'firstRenewalUtc', 'lastRenewalUtc'], [], `familyEpochs[${index}]`);
    nonnegativeInteger(epoch.epoch, `familyEpochs[${index}].epoch`);
    const first = parseUtcTimestamp(epoch.firstRenewalUtc, `familyEpochs[${index}].firstRenewalUtc`);
    const last = parseUtcTimestamp(epoch.lastRenewalUtc, `familyEpochs[${index}].lastRenewalUtc`);
    if (epoch.epoch <= priorEpoch || first !== cursor || last <= first || last > end) {
      fail('MATURITY_SOAK_EXTRACT_GAP', 'familyEpochs must ascend and cover the window without gaps');
    }
    priorEpoch = epoch.epoch;
    cursor = last;
  }
  if (cursor !== end) fail('MATURITY_SOAK_EXTRACT_GAP', 'familyEpochs do not reach window.end');
  if (!Array.isArray(record.renewalRecordDigests) || record.renewalRecordDigests.length === 0) {
    fail('MATURITY_SCHEMA_INVALID', 'renewalRecordDigests must be non-empty');
  }
  record.renewalRecordDigests.forEach((digest, index) =>
    nonEmptyString(digest, `renewalRecordDigests[${index}]`, SHA256));
  nonnegativeInteger(record.withdrawalCount, 'withdrawalCount');
  nonnegativeInteger(record.expiryCount, 'expiryCount');
  if (record.withdrawalCount !== 0 || record.expiryCount !== 0) {
    fail('MATURITY_SOAK_EXTRACT_FAILED', 'successful soak extracts require zero withdrawals and expiries');
  }
  return record;
}

function validateDefectSearch(record) {
  exactKeys(record, [
    'schemaVersion', 'capabilityIds', 'governingLlp', 'searchDateUtc', 'scopes', 'findings',
  ], [], 'MaturityDefectSearchV1');
  if (record.schemaVersion !== 1) fail('MATURITY_SCHEMA_INVALID', 'defect search schemaVersion must be 1');
  capabilityIds(record.capabilityIds);
  safeRepoPath(record.governingLlp, 'governingLlp');
  parseUtcTimestamp(record.searchDateUtc, 'searchDateUtc');
  const scopeChoices = ['issues.v1', 'linear-exact-snapback.v1', 'llp-defect-ledger.v1'];
  if (!Array.isArray(record.scopes) || new Set(record.scopes).size !== record.scopes.length) {
    fail('MATURITY_SCHEMA_INVALID', 'scopes must be a unique array');
  }
  record.scopes.forEach((scope, index) => closedEnum(scope, scopeChoices, `scopes[${index}]`));
  for (const required of scopeChoices.slice(0, 2)) {
    if (!record.scopes.includes(required)) fail('MATURITY_SCHEMA_INVALID', `scopes is missing ${required}`);
  }
  if (!Array.isArray(record.findings)) fail('MATURITY_SCHEMA_INVALID', 'findings must be an array');
  for (const [index, finding] of record.findings.entries()) {
    exactKeys(finding, ['scope', 'ref', 'materiality', 'disposition'], [], `findings[${index}]`);
    closedEnum(finding.scope, scopeChoices, `findings[${index}].scope`);
    if (!record.scopes.includes(finding.scope)) fail('MATURITY_SCHEMA_INVALID', 'finding scope was not searched');
    nonEmptyString(finding.ref, `findings[${index}].ref`);
    closedEnum(finding.materiality, ['material', 'minor'], `findings[${index}].materiality`);
    closedEnum(finding.disposition, ['open-in-window', 'not-open-in-window'], `findings[${index}].disposition`);
    if (finding.materiality === 'material' && finding.disposition === 'open-in-window') {
      fail('MATURITY_MATERIAL_DEFECT_OPEN', `${finding.ref} was MATERIAL and open in the soak window`);
    }
  }
  return record;
}

function validateSoakEvidence(soak, promotion, context, recordsByPath) {
  exactKeys(soak, ['window', 'observationRefs', 'defectSearchRef'], ['journalExtractRefs'], 'soakEvidence');
  const { start, end, value: window } = validateWindow(soak.window, 'soakEvidence.window');
  if (end - start < 14 * 24 * 60 * 60 * 1000) {
    fail('MATURITY_SOAK_TOO_SHORT', 'default promotion requires at least 14 consecutive days');
  }
  if (parseUtcTimestamp(promotion.promotionDate, 'promotionDate') !== end) {
    fail('MATURITY_SOAK_WINDOW_INVALID', 'soak window.end must equal promotionDate');
  }
  const observationLocators = validateLocatorList(soak.observationRefs, 'soakEvidence.observationRefs', context);
  const observations = observationLocators.map((locator) => {
    if (locator.schemaVersion !== 'soak-observation.v1') fail('MATURITY_SCHEMA_INVALID', 'observation locator schemaVersion mismatch');
    return recordsByPath.get(locator.path)?.value
      ?? JSON.parse(bytesAt(context.repoRoot, locator.sourceSha, locator.path));
  });
  const credited = new Set();
  for (const observation of observations) {
    if (canonicalJson(observation.capabilityIds) !== canonicalJson(promotion.capabilityIds)
      || !window.targetPopulation.localProfileIds.includes(observation.targetProfileId)
      || observation.outcome !== 'green') {
      fail('MATURITY_SOAK_CROSS_RECORD_MISMATCH', 'observation does not bind the promotion population and capability set');
    }
    const day = Date.parse(`${observation.dateUtc}T00:00:00Z`);
    if (day < start || day >= end) fail('MATURITY_SOAK_CROSS_RECORD_MISMATCH', 'observation lies outside the soak window');
    credited.add(`${observation.targetProfileId}\0${observation.dateUtc}`);
  }
  for (const profile of window.targetPopulation.localProfileIds) {
    for (const day of utcDays(start, end)) {
      if (!credited.has(`${profile}\0${day}`)) {
        fail('MATURITY_SOAK_COVERAGE_GAP', `missing green observation for ${profile} on ${day}`);
      }
    }
  }

  const hosted = window.targetPopulation.hostedDeployments;
  const extractLocators = soak.journalExtractRefs ?? [];
  if (!Array.isArray(extractLocators) || extractLocators.length !== hosted.length) {
    fail('MATURITY_SOAK_COVERAGE_GAP', 'hosted population requires exactly one journal extract per deployment identity');
  }
  const extracted = new Set();
  for (const [index, locatorValue] of extractLocators.entries()) {
    const locator = validateLocator(locatorValue, `soakEvidence.journalExtractRefs[${index}]`, context);
    if (locator.schemaVersion !== 'soak-extract.v1') fail('MATURITY_SCHEMA_INVALID', 'extract locator schemaVersion mismatch');
    const extract = recordsByPath.get(locator.path)?.value
      ?? JSON.parse(bytesAt(context.repoRoot, locator.sourceSha, locator.path));
    if (canonicalJson(extract.capabilityIds) !== canonicalJson(promotion.capabilityIds)
      || canonicalJson(extract.window) !== canonicalJson(window)) {
      fail('MATURITY_SOAK_CROSS_RECORD_MISMATCH', 'journal extract does not bind the promotion window and capability set');
    }
    const member = hosted.find((entry) => entry.deploymentIdentity === extract.deploymentIdentity);
    if (!member || extracted.has(extract.deploymentIdentity)) {
      fail('MATURITY_SOAK_COVERAGE_GAP', 'journal extract identity is absent or duplicated');
    }
    extracted.add(extract.deploymentIdentity);
  }

  const defectLocator = validateLocator(soak.defectSearchRef, 'soakEvidence.defectSearchRef', context);
  if (defectLocator.schemaVersion !== 'defect-search.v1') fail('MATURITY_SCHEMA_INVALID', 'defect locator schemaVersion mismatch');
  const search = recordsByPath.get(defectLocator.path)?.value
    ?? JSON.parse(bytesAt(context.repoRoot, defectLocator.sourceSha, defectLocator.path));
  if (canonicalJson(search.capabilityIds) !== canonicalJson(promotion.capabilityIds)
    || search.governingLlp !== promotion.governingLlp
    || parseUtcTimestamp(search.searchDateUtc, 'searchDateUtc') < end) {
    fail('MATURITY_SOAK_CROSS_RECORD_MISMATCH', 'defect search does not cover the promotion window and contract');
  }
  const governingText = bytesAt(context.repoRoot, promotion.candidateSourceSha, promotion.governingLlp)
    .toString('utf8');
  const carriesDefectLedger = /^##+\s+.*defect ledger/im.test(governingText);
  if (search.scopes.includes('llp-defect-ledger.v1') !== carriesDefectLedger) {
    fail('MATURITY_DEFECT_SCOPE_MISMATCH', 'llp-defect-ledger.v1 must appear exactly when the governing LLP carries a defect ledger');
  }
}

function validatePromotion(record, context, recordsByPath) {
  exactKeys(record, [
    'schemaVersion', 'route', 'capabilityIds', 'fromMaturity', 'toMaturity',
    'governingLlp', 'governingStatusAtPromotion', 'candidateSourceSha',
    'candidateParentSha', 'reviewJournalRefs', 'corpusRunRefs', 'claimAuditRefs',
    'stagedTreeManifestSha256', 'consumerArmRefs', 'supportEvidenceRefs',
    'authorAdjudication', 'promotionDate',
  ], ['soakEvidence'], 'MaturityPromotionReceiptV1');
  if (record.schemaVersion !== 1) fail('MATURITY_SCHEMA_INVALID', 'promotion schemaVersion must be 1');
  closedEnum(record.route, ['default.v1', 'grandfathered-direct.v1'], 'route');
  capabilityIds(record.capabilityIds);
  if (record.fromMaturity !== 'experimental' || record.toMaturity !== 'stable') {
    fail('MATURITY_SCHEMA_INVALID', 'promotion direction must be experimental -> stable');
  }
  safeRepoPath(record.governingLlp, 'governingLlp');
  nonEmptyString(record.governingStatusAtPromotion, 'governingStatusAtPromotion', ID);
  nonEmptyString(record.candidateSourceSha, 'candidateSourceSha', GIT_SHA);
  nonEmptyString(record.candidateParentSha, 'candidateParentSha', GIT_SHA);
  if (record.candidateSourceSha !== record.candidateParentSha) {
    fail('MATURITY_CANDIDATE_PIN_MISMATCH', 'candidateSourceSha must equal candidateParentSha');
  }
  const locatorContext = { ...context, candidateSourceSha: record.candidateSourceSha };
  validateLocatorList(record.reviewJournalRefs, 'reviewJournalRefs', locatorContext);
  validateLocatorList(record.corpusRunRefs, 'corpusRunRefs', locatorContext);
  if (!Array.isArray(record.claimAuditRefs) || record.claimAuditRefs.length !== 2) {
    fail('MATURITY_SCHEMA_INVALID', 'claimAuditRefs must contain candidate and promotion-tree audits');
  }
  validateLocator(record.claimAuditRefs[0], 'claimAuditRefs[0]', locatorContext);
  validateLocator(record.claimAuditRefs[1], 'claimAuditRefs[1]', locatorContext, { staged: true });
  nonEmptyString(record.stagedTreeManifestSha256, 'stagedTreeManifestSha256', SHA256);
  validateLocatorList(record.consumerArmRefs, 'consumerArmRefs', locatorContext);
  validateLocatorList(record.supportEvidenceRefs, 'supportEvidenceRefs', locatorContext);
  exactKeys(record.authorAdjudication, ['date', 'adjudicator', 'record', 'provenanceRef'], [], 'authorAdjudication');
  parseUtcTimestamp(record.authorAdjudication.date, 'authorAdjudication.date');
  nonEmptyString(record.authorAdjudication.adjudicator, 'authorAdjudication.adjudicator');
  nonEmptyString(record.authorAdjudication.record, 'authorAdjudication.record');
  validateLocator(record.authorAdjudication.provenanceRef, 'authorAdjudication.provenanceRef', locatorContext);
  parseUtcTimestamp(record.promotionDate, 'promotionDate');
  if (record.route === 'default.v1') {
    if (!record.soakEvidence) fail('MATURITY_SCHEMA_INVALID', 'default route requires soakEvidence');
    validateSoakEvidence(record.soakEvidence, record, locatorContext, recordsByPath);
  } else {
    if (record.soakEvidence !== undefined) fail('MATURITY_SCHEMA_INVALID', 'grandfathered route must omit soakEvidence');
    if (!record.capabilityIds.every((id) => GRANDFATHERED_DIRECT_IDS.includes(id))) {
      fail('MATURITY_GRANDFATHER_ROUTE_REFUSED', 'capability is outside the closed grandfather set');
    }
    for (const locator of record.supportEvidenceRefs) {
      if (locator.schemaVersion !== 'grandfather.v1') {
        fail('MATURITY_SCHEMA_INVALID', 'grandfather route support evidence must name grandfather.v1');
      }
    }
  }
  return record;
}

function validateDemotion(record, context) {
  exactKeys(record, [
    'schemaVersion', 'capabilityIds', 'fromMaturity', 'toMaturity', 'triggerKind',
    'triggerEvidenceRefs', 'candidateSourceSha', 'candidateParentSha',
    'voidedReceiptRef', 'authority', 'notifiedAuthorDate', 'demotionDate',
  ], [], 'MaturityDemotionRecordV1');
  if (record.schemaVersion !== 1) fail('MATURITY_SCHEMA_INVALID', 'demotion schemaVersion must be 1');
  capabilityIds(record.capabilityIds);
  if (record.fromMaturity !== 'stable' || record.toMaturity !== 'experimental') {
    fail('MATURITY_SCHEMA_INVALID', 'demotion direction must be stable -> experimental');
  }
  closedEnum(record.triggerKind, [
    'gate-regression.v1', 'receipt-invalid.v1', 'contract-divergence.v1',
  ], 'triggerKind');
  nonEmptyString(record.candidateSourceSha, 'candidateSourceSha', GIT_SHA);
  nonEmptyString(record.candidateParentSha, 'candidateParentSha', GIT_SHA);
  if (record.candidateSourceSha !== record.candidateParentSha) {
    fail('MATURITY_CANDIDATE_PIN_MISMATCH', 'candidateSourceSha must equal candidateParentSha');
  }
  const locatorContext = { ...context, candidateSourceSha: record.candidateSourceSha };
  validateLocatorList(record.triggerEvidenceRefs, 'triggerEvidenceRefs', locatorContext);
  const voided = validateLocator(record.voidedReceiptRef, 'voidedReceiptRef', locatorContext);
  if (voided.schemaVersion !== 'maturity-promotion.v1') {
    fail('MATURITY_SCHEMA_INVALID', 'voidedReceiptRef must name maturity-promotion.v1');
  }
  closedEnum(record.authority, ['author.v1', 'fast-path.v1'], 'authority');
  parseUtcTimestamp(record.notifiedAuthorDate, 'notifiedAuthorDate');
  parseUtcTimestamp(record.demotionDate, 'demotionDate');
  if (record.notifiedAuthorDate.slice(0, 10) !== record.demotionDate.slice(0, 10)) {
    fail('MATURITY_DEMOTION_NOTIFICATION_LATE', 'author notification must be recorded on the demotion UTC day');
  }
  if (record.authority === 'fast-path.v1'
    && !['gate-regression.v1', 'receipt-invalid.v1'].includes(record.triggerKind)) {
    fail('MATURITY_DEMOTION_AUTHORITY_INVALID', 'fast path is limited to objective gate or receipt triggers');
  }
  return record;
}

function validateGrandfather(record, context) {
  exactKeys(record, [
    'schemaVersion', 'capabilityIds', 'cutoffDate', 'preCutoffCommitRefs',
    'acceptanceSuiteRefs', 'demoUseRefs', 'positivePredicateRefs',
    'governingContractBaseline',
  ], [], 'MaturityGrandfatherEvidenceV1');
  if (record.schemaVersion !== 1 || record.cutoffDate !== '2026-07-30') {
    fail('MATURITY_SCHEMA_INVALID', 'grandfather record must use schema 1 and the 2026-07-30 cutoff');
  }
  capabilityIds(record.capabilityIds);
  if (record.capabilityIds.length !== 1) {
    fail('MATURITY_SCHEMA_INVALID', 'grandfather evidence is per member');
  }
  if (!record.capabilityIds.every((id) => GRANDFATHERED_DIRECT_IDS.includes(id))) {
    fail('MATURITY_GRANDFATHER_ROUTE_REFUSED', 'grandfather evidence names an ineligible id');
  }
  validateLocatorList(record.preCutoffCommitRefs, 'preCutoffCommitRefs', context);
  validateLocatorList(record.acceptanceSuiteRefs, 'acceptanceSuiteRefs', context);
  validateLocatorList(record.demoUseRefs, 'demoUseRefs', context);
  validateLocatorList(record.positivePredicateRefs, 'positivePredicateRefs', context);
  const baseline = validateLocator(record.governingContractBaseline, 'governingContractBaseline', context);
  if (baseline.schemaVersion !== 'llp-blob.v1' || baseline.producer !== 'git') {
    fail('MATURITY_SCHEMA_INVALID', 'governingContractBaseline must be an llp-blob.v1 git locator');
  }
  const cutoff = Date.parse('2026-07-31T00:00:00Z');
  for (const locator of record.preCutoffCommitRefs) {
    const committed = Date.parse(git(context.repoRoot, ['show', '-s', '--format=%cI', locator.sourceSha]).trim());
    if (committed >= cutoff) fail('MATURITY_GRANDFATHER_CUTOFF_INVALID', 'pre-cutoff evidence was committed after 2026-07-30');
  }
  return record;
}

export function validateMaturityRecordTree({
  repoRoot = resolve(import.meta.dirname, '..'),
  recordRoot = join(repoRoot, 'tests/acceptance/maturity'),
} = {}) {
  if (!existsSync(recordRoot) || !lstatSync(recordRoot).isDirectory()) {
    fail('MATURITY_RECORD_ROOT_MISSING', `${recordRoot} must exist`);
  }
  const records = [];
  const recordsByPath = new Map();
  for (const path of listFiles(recordRoot)) {
    const suffix = recordSuffix(path);
    if (!suffix) fail('MATURITY_RECORD_SUFFIX_UNKNOWN', `${path} does not name a closed maturity schema`);
    const repoPath = relative(repoRoot, path).split(sep).join('/');
    const { bytes, value } = readCanonicalRecord(path);
    const recordCommit = commitIntroducing(repoRoot, repoPath);
    const entry = { path, repoPath, suffix, bytes, value, recordCommit };
    records.push(entry);
    recordsByPath.set(repoPath, entry);
  }
  for (const entry of records) {
    const context = { repoRoot, repoPath: entry.repoPath, recordCommit: entry.recordCommit };
    switch (entry.suffix) {
      case '.promotion.json': validatePromotion(entry.value, context, recordsByPath); break;
      case '.demotion.json': validateDemotion(entry.value, context); break;
      case '.grandfather.json': validateGrandfather(entry.value, context); break;
      case '.soak-observation.json': validateObservation(entry.value, context); break;
      case '.soak-extract.json': validateExtract(entry.value); break;
      case '.defect-search.json': validateDefectSearch(entry.value); break;
      default: fail('MATURITY_RECORD_SUFFIX_UNKNOWN', entry.repoPath);
    }
  }
  const transitionKeys = new Set();
  for (const entry of records.filter((candidate) =>
    candidate.suffix === '.promotion.json' || candidate.suffix === '.demotion.json')) {
    const key = `${entry.value.candidateSourceSha}\0${canonicalJson(entry.value.capabilityIds)}`;
    if (transitionKeys.has(key)) fail('MATURITY_TRANSITION_CONFLICT', `duplicate transition for ${entry.value.capabilityIds.join(', ')}`);
    transitionKeys.add(key);
  }
  return { recordRoot, records };
}

function treeManifest(repoRoot, commit, excludedPath) {
  const listing = git(repoRoot, ['ls-tree', '-r', '-z', '--full-tree', commit], { encoding: null });
  const entries = [];
  for (const raw of listing.toString('utf8').split('\0').filter(Boolean)) {
    const [header, path] = raw.split('\t');
    const [, type] = header.split(' ');
    if (type !== 'blob' || path === excludedPath) continue;
    entries.push([path, sha256(bytesAt(repoRoot, commit, path))]);
  }
  entries.sort((left, right) => Buffer.compare(Buffer.from(left[0]), Buffer.from(right[0])));
  return entries;
}

export function stagedTreeManifestSha256({ repoRoot, commit, excludedPath }) {
  return sha256(Buffer.from(canonicalJson(treeManifest(repoRoot, commit, excludedPath))));
}

function projectionAt(repoRoot, commit) {
  const path = 'tests/acceptance/capability-maturity.experimental.json';
  try {
    const value = JSON.parse(bytesAt(repoRoot, commit, path));
    return sortedUniqueStrings(value, `${commit}:${path}`, { allowEmpty: true });
  } catch (error) {
    if (error instanceof MaturityValidationError && error.code === 'MATURITY_LOCATOR_UNRESOLVED') return null;
    throw error;
  }
}

function changedPaths(repoRoot, parent, commit) {
  return git(repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', parent, commit])
    .trim().split('\n').filter(Boolean);
}

export function validateTransitionRange({ repoRoot, range, validation = null }) {
  const checked = validation ?? validateMaturityRecordTree({ repoRoot });
  const commits = git(repoRoot, ['rev-list', '--reverse', range]).trim().split('\n').filter(Boolean);
  const transitions = [];
  for (const commit of commits) {
    const parents = git(repoRoot, ['show', '-s', '--format=%P', commit]).trim().split(/\s+/).filter(Boolean);
    if (parents.length !== 1) continue;
    const [parent] = parents;
    const before = projectionAt(repoRoot, parent);
    const after = projectionAt(repoRoot, commit);
    if (before === null || after === null || canonicalJson(before) === canonicalJson(after)) continue;
    const removed = before.filter((id) => !after.includes(id));
    const added = after.filter((id) => !before.includes(id));
    const direction = removed.length > 0 && added.length === 0 ? 'promotion'
      : added.length > 0 && removed.length === 0 ? 'demotion' : null;
    if (!direction) fail('MATURITY_TRANSITION_MIXED', `${commit} mixes promotion and demotion`);
    const ids = direction === 'promotion' ? removed : added;
    capabilityIds(ids, `${commit}.changedCapabilityIds`);
    const paths = changedPaths(repoRoot, parent, commit);
    const suffix = direction === 'promotion' ? '.promotion.json' : '.demotion.json';
    const recordEntries = checked.records.filter((entry) =>
      entry.recordCommit === commit && entry.suffix === suffix);
    if (recordEntries.length !== 1) fail('MATURITY_TRANSITION_RECORD_MISSING', `${commit} needs exactly one ${suffix} record`);
    const recordEntry = recordEntries[0];
    const record = recordEntry.value;
    if (record.candidateSourceSha !== parent || record.candidateParentSha !== parent
      || canonicalJson(record.capabilityIds) !== canonicalJson(ids)) {
      fail('MATURITY_TRANSITION_PARENT_MISMATCH', `${commit} record does not bind its sole parent and changed ids`);
    }
    for (const required of ['src/manifest.rs', 'packages/snapback-codegen/index.mjs']) {
      if (!paths.includes(required)) fail('MATURITY_TRANSITION_NONATOMIC', `${commit} did not change ${required}`);
    }
    if (!paths.some((path) => path.startsWith('tests/') && path !== recordEntry.repoPath)) {
      fail('MATURITY_TRANSITION_TEST_MISSING', `${commit} did not update a maturity/admission test`);
    }
    const governingLlp = direction === 'promotion'
      ? record.governingLlp
      : JSON.parse(bytesAt(
        repoRoot,
        record.voidedReceiptRef.sourceSha,
        record.voidedReceiptRef.path,
      )).governingLlp;
    if (!paths.includes(governingLlp)) {
      fail('MATURITY_TRANSITION_LLP_MISSING', `${commit} did not update ${governingLlp}`);
    }
    if (!paths.includes('guide/capabilities.md')
      || !paths.some((path) => /^llp\/\d{4}-.+\.plan\.md$/.test(path))) {
      fail('MATURITY_TRANSITION_BOARD_MISSING', `${commit} did not update guide and program-board rows`);
    }
    if (direction === 'promotion') {
      // @ref LLP 0134#4-the-promotion-act — the source-owned registry citation
      // names the exact receipt path without duplicating its digest; A2/A5 bind
      // the receipt bytes, parent, and complete self-excluding landed tree.
      const registryCitation = `@ref LLP 0134#4-the-promotion-act — promoted ${record.promotionDate.slice(0, 10)} via ${recordEntry.repoPath}`;
      const manifestSource = bytesAt(repoRoot, commit, 'src/manifest.rs').toString('utf8');
      if (!manifestSource.includes(registryCitation)) {
        fail(
          'MATURITY_PROMOTION_COMMENT_MISSING',
          `${commit} registry must cite ${recordEntry.repoPath} and LLP 0134 §4`,
        );
      }
      const observed = stagedTreeManifestSha256({
        repoRoot,
        commit,
        excludedPath: recordEntry.repoPath,
      });
      if (observed !== record.stagedTreeManifestSha256) {
        fail('MATURITY_STAGED_TREE_MISMATCH', `${commit} landed a tree other than the audited staged tree`);
      }
    }
    transitions.push({ commit, parent, direction, capabilityIds: ids, recordPath: recordEntry.repoPath });
  }
  if (transitions.length > 1) {
    fail('MATURITY_TRANSITION_STACKED', `${range} contains ${transitions.length} maturity transitions`);
  }
  return transitions;
}

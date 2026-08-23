import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

import { recordDigest } from './canonical-json.mjs';
import { BenchmarkPublicationError, fail } from './failure.mjs';
import { validateJsonSchema } from './json-schema.mjs';
import { validateSocialMessengerRunRecord } from '../social-messenger/record-validator.mjs';

// @ref LLP 0197#the-standard — rule 4: historical prose never becomes machine evidence by inference.
export const HISTORICAL_MISSING_FIELDS = Object.freeze([
  'machine-record-json',
  'explicit-null-metrics',
  'record-digest',
  'claim-evidence-overlay',
]);

export const SUPPORTED_REQUIRED_CLAIM_FIELDS = Object.freeze([
  'recordDigest',
  'publication',
]);

const PUBLICATION_FIELDS = new Set([
  'comparisonSet',
  'repetition',
  'attemptId',
  'position',
  'resultStatus',
  'proofEvidence',
  'sanitizedTrace',
]);

function gitFiles(root, patterns) {
  const result = spawnSync('git', ['ls-files', '-z', '--', ...patterns], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    fail('GIT_INVENTORY_FAILED', result.stderr.trim() || 'git ls-files failed');
  }
  return result.stdout.split('\0').filter(Boolean).sort();
}

function parseJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail('INVALID_JSON', `${label} is not valid JSON: ${error.message}`);
  }
}

function validateMetricNullDiscipline(record, file) {
  if (!Object.hasOwn(record, 'toolUses')) {
    fail('IMPLICIT_MISSING_METRIC', `${file}: toolUses must be present and may be null`);
  }
  const tokenValues = [record.tokens?.input, record.tokens?.output];
  if (tokenValues.some((value) => value === undefined)) {
    fail('IMPLICIT_MISSING_METRIC', `${file}: tokens.input and tokens.output must be explicit numbers or null`);
  }
  const bothNull = tokenValues.every((value) => value === null);
  const bothNumbers = tokenValues.every((value) => Number.isInteger(value));
  if (!bothNull && !bothNumbers) {
    fail('PARTIAL_TOKEN_METRIC', `${file}: tokens.input and tokens.output must both be measured or both be null`);
  }
  if (bothNull && record.tokens.source !== null) {
    fail('TOKEN_SOURCE_WITHOUT_METRIC', `${file}: tokens.source must be null when token counts are null`);
  }
  if (bothNumbers && (typeof record.tokens.source !== 'string' || record.tokens.source.length === 0)) {
    fail('TOKEN_METRIC_WITHOUT_SOURCE', `${file}: measured token counts require tokens.source`);
  }
}

function validateRubric(record, file) {
  if (!record.rubric) return;
  const weights = {
    functionalCompleteness: 0.2,
    realtimeTyping: 0.1,
    offlineBehavior: 0.2,
    imagesAssets: 0.1,
    dataModelTypeSafety: 0.1,
    dxDocsSetup: 0.15,
    testabilityDiagnostics: 0.05,
    operationsMaturity: 0.1,
  };
  const recomputed = Object.entries(weights)
    .reduce((total, [field, weight]) => total + record.rubric[field] * weight, 0);
  if (Math.abs(recomputed - record.rubric.weightedOverall) > 1e-9) {
    fail(
      'RUBRIC_AGGREGATION_MISMATCH',
      `${file}: rubric.weightedOverall=${record.rubric.weightedOverall} but the fixed weights recompute to ${recomputed}`,
    );
  }
}

function validatePublicationOverlay(record, file) {
  if (record.publication === undefined) return;
  if (!record.publication || typeof record.publication !== 'object' || Array.isArray(record.publication)) {
    fail('INVALID_CLAIM_EVIDENCE', `${file}: publication must be an object`);
  }
  const unknown = Object.keys(record.publication).filter((key) => !PUBLICATION_FIELDS.has(key));
  if (unknown.length > 0) {
    fail('UNKNOWN_REQUIRED_CLAIM_FIELD', `${file}: unknown publication field(s): ${unknown.join(', ')}`);
  }
  const required = [
    'comparisonSet',
    'repetition',
    'attemptId',
    'position',
    'resultStatus',
    'proofEvidence',
    'sanitizedTrace',
  ];
  for (const field of required) {
    if (!Object.hasOwn(record.publication, field)) {
      fail('MISSING_CLAIM_EVIDENCE', `${file}: publication.${field} is required for a claim`);
    }
  }
  for (const field of ['comparisonSet', 'attemptId', 'sanitizedTrace']) {
    if (typeof record.publication[field] !== 'string' || record.publication[field].length === 0) {
      fail('INVALID_CLAIM_EVIDENCE', `${file}: publication.${field} must be a non-empty string`);
    }
  }
  if (!Number.isInteger(record.publication.repetition) || record.publication.repetition < 1) {
    fail('INVALID_CLAIM_EVIDENCE', `${file}: publication.repetition must be a positive integer`);
  }
  if (!Number.isInteger(record.publication.position) || record.publication.position < 1) {
    fail('INVALID_CLAIM_EVIDENCE', `${file}: publication.position must be a positive integer`);
  }
  if (!['success', 'capability-failure'].includes(record.publication.resultStatus)) {
    fail('INVALID_CLAIM_EVIDENCE', `${file}: publication.resultStatus must be success or capability-failure`);
  }
  if (!Array.isArray(record.publication.proofEvidence) || record.publication.proofEvidence.length === 0) {
    fail('MISSING_CLAIM_EVIDENCE', `${file}: publication.proofEvidence must retain at least one pointer`);
  }
  if (record.publication.proofEvidence.some((pointer) => typeof pointer !== 'string' || pointer.length === 0)) {
    fail('INVALID_CLAIM_EVIDENCE', `${file}: publication.proofEvidence pointers must be non-empty strings`);
  }
  if (record.publication.resultStatus === 'success' && record.firstGreenProofAt === null) {
    fail('SUCCESS_WITHOUT_GREEN_PROOF', `${file}: a successful attempt requires firstGreenProofAt`);
  }
  const wallPhases = Object.values(record.wallClock.phases);
  if (wallPhases.every((value) => value !== null)
      && Math.abs(wallPhases.reduce((total, value) => total + value, 0)
        - record.wallClock.totalSeconds) > 0.001) {
    fail(
      'PHASE_AGGREGATION_MISMATCH',
      `${file}: measured wall-clock phases do not sum to wallClock.totalSeconds`,
    );
  }
  const tokenPhases = Object.values(record.tokens.phases);
  if (record.tokens.input !== null && tokenPhases.every((value) => value !== null)) {
    const tokenPhaseTotal = tokenPhases.reduce((total, value) => total + value, 0);
    const tokenTotal = record.tokens.input + record.tokens.output;
    if (tokenPhaseTotal !== tokenTotal) {
      fail(
        'PHASE_AGGREGATION_MISMATCH',
        `${file}: token phases sum to ${tokenPhaseTotal}, not ${tokenTotal}`,
      );
    }
  } else if (record.tokens.input === null && tokenPhases.some((value) => value !== null)) {
    fail(
      'PHASE_AGGREGATION_MISMATCH',
      `${file}: token phases must be null when total token accounting is unmeasured`,
    );
  }
}

function insideRoot(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
}

export function validateMachineRecord({ root, schema, file, record }) {
  let errors;
  if (record.brief === 'social-messenger') {
    const extensionSchema = parseJson(
      resolve(root, 'benchmarks/schema/social-messenger/run-record-extension.schema.json'),
      'social-messenger run-record extension schema',
    );
    const composedSchema = parseJson(
      resolve(root, 'benchmarks/schema/social-messenger/run-record.schema.json'),
      'social-messenger composed run-record schema',
    );
    errors = validateSocialMessengerRunRecord(composedSchema, record, {
      schemas: [schema, extensionSchema],
      tolerateAdditiveFields: true,
      artifactRoot: dirname(resolve(root, file)),
    });
  } else {
    errors = validateJsonSchema(schema, record, { tolerateAdditiveFields: true });
  }
  if (errors.length > 0) {
    fail('SCHEMA_CONFORMANCE', `${file}:\n  ${errors.join('\n  ')}`);
  }
  validateMetricNullDiscipline(record, file);
  if (record.lane === 'snapback' && record.laneVariant === undefined) {
    fail('LANE_VARIANT_MISSING', `${file}: Snapback records require laneVariant`);
  }
  if (record.lane !== 'snapback' && record.laneVariant !== undefined) {
    fail('LANE_VARIANT_INVALID', `${file}: competitor records must omit laneVariant`);
  }
  validateRubric(record, file);
  validatePublicationOverlay(record, file);
  if (record.recordDigest !== undefined && record.recordDigest !== recordDigest(record)) {
    fail(
      'RECORD_DIGEST_MISMATCH',
      `${file}: recordDigest ${record.recordDigest} does not match ${recordDigest(record)}`,
    );
  }
  const startedAt = Date.parse(record.timestamps.startedAt);
  const finishedAt = Date.parse(record.timestamps.finishedAt);
  if (finishedAt < startedAt) {
    fail('INVALID_TIMESTAMPS', `${file}: timestamps.finishedAt precedes timestamps.startedAt`);
  }
  const elapsedSeconds = (finishedAt - startedAt) / 1000;
  if (Math.abs(elapsedSeconds - record.wallClock.totalSeconds) > 0.001) {
    fail(
      'WALL_CLOCK_MISMATCH',
      `${file}: timestamp interval is ${elapsedSeconds}s but wallClock.totalSeconds is ${record.wallClock.totalSeconds}`,
    );
  }
  if (record.firstGreenProofAt !== null) {
    const firstGreen = Date.parse(record.firstGreenProofAt);
    if (firstGreen < startedAt || firstGreen > finishedAt) {
      fail('INVALID_FIRST_GREEN_PROOF', `${file}: firstGreenProofAt lies outside the lane interval`);
    }
  }
  return record;
}

export function loadRecordsFromPaths({ root, paths, requireCommitted = true }) {
  const schemaPath = resolve(root, 'benchmarks/schema/run-record.schema.json');
  const schema = parseJson(schemaPath, 'current run-record schema');
  const committed = requireCommitted
    ? new Set(gitFiles(root, [':(glob)benchmarks/records/*.json']))
    : null;
  return [...paths].sort().map((file) => {
    if (typeof file !== 'string' || file.startsWith('/') || file.split('/').includes('..')) {
      fail('UNSAFE_RECORD_PATH', `record path must be repository-relative: ${file}`);
    }
    const absolute = resolve(root, file);
    if (!insideRoot(root, absolute)) fail('UNSAFE_RECORD_PATH', `record escapes repository: ${file}`);
    if (requireCommitted && !committed.has(file)) {
      fail('UNCOMMITTED_RECORD', `${file} is not a committed machine record`);
    }
    const record = parseJson(absolute, file);
    validateMachineRecord({ root, schema, file, record });
    return { file, record };
  });
}

export function loadCommittedRecordInventory({ root }) {
  const machineFiles = gitFiles(root, [':(glob)benchmarks/records/*.json']);
  const historical = gitFiles(root, [':(glob)benchmarks/records/*.md'])
    .filter((file) => file !== 'benchmarks/records/schema.md')
    .map((file) => ({ file, missingFields: [...HISTORICAL_MISSING_FIELDS] }));
  const records = [];
  for (const file of machineFiles) {
    try {
      records.push(...loadRecordsFromPaths({ root, paths: [file], requireCommitted: true }));
    } catch (error) {
      if (!(error instanceof BenchmarkPublicationError)
          || !['SCHEMA_CONFORMANCE', 'IMPLICIT_MISSING_METRIC', 'PARTIAL_TOKEN_METRIC',
            'TOKEN_SOURCE_WITHOUT_METRIC', 'TOKEN_METRIC_WITHOUT_SOURCE',
            'PHASE_AGGREGATION_MISMATCH', 'WALL_CLOCK_MISMATCH',
            'INVALID_FIRST_GREEN_PROOF', 'INVALID_TIMESTAMPS',
            'RUBRIC_AGGREGATION_MISMATCH', 'LANE_VARIANT_MISSING',
            'LANE_VARIANT_INVALID'].includes(error.reason)) {
        throw error;
      }
      const missing = [...error.message.matchAll(/\$\/([^:\n]+): required field is missing/g)]
        .map((match) => match[1].replaceAll('~1', '/').replaceAll('~0', '~'));
      historical.push({
        file,
        missingFields: missing.length > 0 ? missing : [`validation:${error.reason}`],
      });
    }
  }
  historical.sort((left, right) => left.file.localeCompare(right.file));
  return {
    records,
    historical,
  };
}

export function assertSupportedRequiredClaimFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    fail('MISSING_REQUIRED_CLAIM_FIELDS', 'manifest.requiredClaimFields must be a non-empty array');
  }
  const unknown = fields.filter((field) => !SUPPORTED_REQUIRED_CLAIM_FIELDS.includes(field));
  if (unknown.length > 0) {
    fail('UNKNOWN_REQUIRED_CLAIM_FIELD', `publisher does not understand required claim field(s): ${unknown.join(', ')}`);
  }
  for (const required of SUPPORTED_REQUIRED_CLAIM_FIELDS) {
    if (!fields.includes(required)) {
      fail('MISSING_REQUIRED_CLAIM_FIELD', `manifest must require ${required}`);
    }
  }
}

import { createHash } from 'node:crypto';

export const SEED_ARTIFACT_FORMAT_V1 = 'snapback.seed.v1';
export const VERSIONED_SEED_MAX_EFFECTS_V1 = 1_024;
const SEED_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const fail = (code, message, details = {}) => {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
};

function canonicalJson(value, seen = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value) && Number.isInteger(value)) {
      fail('SNAPBACK_SEED_DECLARATION_INVALID', 'seed contains a non-canonical JSON number');
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object') {
    fail('SNAPBACK_SEED_DECLARATION_INVALID', 'seed contains a non-JSON value');
  }
  if (seen.has(value)) fail('SNAPBACK_SEED_DECLARATION_INVALID', 'seed contains a cycle');
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, seen)).join(',')}]`;
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      fail('SNAPBACK_SEED_DECLARATION_INVALID', 'seed contains a prototype-bearing object');
    }
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

function closedKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('SNAPBACK_SEED_DECLARATION_INVALID', `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    fail('SNAPBACK_SEED_DECLARATION_INVALID', `${label} has unknown or missing members`, {
      actual,
      expected: wanted,
    });
  }
}

function validateTables(tables) {
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) {
    fail('SNAPBACK_SEED_DECLARATION_INVALID', 'seed tables must be a name-keyed object');
  }
  let rowCount = 0;
  for (const [table, rows] of Object.entries(tables)) {
    if (!table || !Array.isArray(rows)) {
      fail('SNAPBACK_SEED_DECLARATION_INVALID', 'each seed table must contain an array', { table });
    }
    rowCount += rows.length;
    if (rowCount > VERSIONED_SEED_MAX_EFFECTS_V1) {
      fail(
        'SNAPBACK_SEED_EFFECT_LIMIT',
        `versioned seed exceeds the ${VERSIONED_SEED_MAX_EFFECTS_V1}-effect ceiling`,
        { rowCount, limit: VERSIONED_SEED_MAX_EFFECTS_V1 },
      );
    }
    for (const [index, row] of rows.entries()) {
      if (!row || typeof row !== 'object' || Array.isArray(row)
          || (Object.getPrototypeOf(row) !== Object.prototype
            && Object.getPrototypeOf(row) !== null)) {
        fail('SNAPBACK_SEED_DECLARATION_INVALID', 'seed row must be a plain object', {
          table,
          index,
        });
      }
      canonicalJson(row);
    }
  }
  return rowCount;
}

export function seedArtifactDigest(body) {
  const hash = createHash('sha256');
  hash.update('snapback:seed-artifact:v1\n', 'utf8');
  hash.update(canonicalJson(body), 'utf8');
  return `sha256:${hash.digest('hex')}`;
}

export function buildSeedArtifactV1(source, appId) {
  closedKeys(source, ['seedVersion', 'tables'], 'versioned seed declaration');
  if (typeof source.seedVersion !== 'string' || !SEED_VERSION.test(source.seedVersion)) {
    fail('SNAPBACK_SEED_DECLARATION_INVALID', 'seedVersion is not a portable identity token');
  }
  if (typeof appId !== 'string' || appId.length === 0) {
    fail('SNAPBACK_SEED_DECLARATION_INVALID', 'versioned seed requires a nonempty appId');
  }
  const seedRowCount = validateTables(source.tables);
  const body = {
    formatVersion: SEED_ARTIFACT_FORMAT_V1,
    appId,
    seedVersion: source.seedVersion,
    tables: source.tables,
  };
  return {
    artifact: {
      ...body,
      seedDigest: seedArtifactDigest(body),
    },
    seedRowCount,
  };
}

export function parseSeedSourceV1(bytes, appId) {
  let source;
  try {
    source = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes));
  } catch {
    fail('SNAPBACK_SEED_DECLARATION_INVALID', 'seed.json is not valid JSON');
  }
  if (source && Object.prototype.hasOwnProperty.call(source, 'seedVersion')) {
    return { versioned: true, ...buildSeedArtifactV1(source, appId) };
  }
  closedKeys(source, ['tables'], 'legacy seed declaration');
  validateTables(source.tables);
  return { versioned: false, seed: source };
}

export function canonicalSeedArtifactJson(artifact) {
  return `${canonicalJson(artifact)}\n`;
}

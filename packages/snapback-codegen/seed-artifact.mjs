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

const DATA_URI_BYTES = /^data:[^,;]+(?:;[^,;=]+=[^,;]*)*;base64,/iu;
const BASE64_BYTES_MIN_CHARS = 256;

function structuredMediaBytesEncoding(value) {
  if (DATA_URI_BYTES.test(value)) return 'data-uri';
  if (value.length < BASE64_BYTES_MIN_CHARS || value.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) return null;
  const characterClasses = [/[A-Z]/u, /[a-z]/u, /[0-9]/u, /[+/=]/u]
    .filter((pattern) => pattern.test(value)).length;
  if (characterClasses < 3) return null;
  try {
    const bytes = Buffer.from(value, 'base64');
    return bytes.toString('base64') === value ? 'base64' : null;
  } catch {
    return null;
  }
}

// @ref LLP 0109#17-dated-amendment-seed-asset-fixtures-2026-07-31 — fixture
// bytes belong in committed files plus the typed $assetFixture carrier. A
// string-shaped byte payload must refuse before seed replay can settle any
// earlier row or discover the structured-value ceiling at runtime.
function refuseStructuredMediaBytes(value, { table, index, path }) {
  if (typeof value === 'string') {
    const encoding = structuredMediaBytesEncoding(value);
    if (encoding === null) return;
    const fieldPath = [table, String(index), ...path].join('.');
    fail(
      'SNAPBACK_SEED_DECLARATION_INVALID',
      `seed ${fieldPath} looks like ${encoding === 'data-uri' ? 'a base64 data URI' : 'base64-encoded bytes'}; media bytes are assets, not structured row strings`,
      {
        table,
        index,
        fieldPath,
        encoding,
        repair: {
          fixture: 'Put the bytes in a committed file declared by seed-assets.json, then place { "$assetFixture": "<fixture-id>" } in the seed row.',
          schema: 'Declare the destination as v.assetRef(...) or finalized-only v.media(...), not v.string()/v.json().',
        },
      },
    );
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const [childIndex, child] of value.entries()) {
      refuseStructuredMediaBytes(child, { table, index, path: [...path, String(childIndex)] });
    }
    return;
  }
  for (const [field, child] of Object.entries(value)) {
    refuseStructuredMediaBytes(child, { table, index, path: [...path, field] });
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
      refuseStructuredMediaBytes(row, { table, index, path: [] });
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

// --- LLP 0109 §17: seed asset fixtures ------------------------------------

export const SEED_ASSET_FIXTURES_FORMAT_V1 = 'snapback.seed-asset-fixtures.v1';
const SEED_ASSET_FIXTURES_MAX_V1 = 256;

export function seedAssetFixturesDigest(body) {
  const hash = createHash('sha256');
  hash.update('snapback:seed-asset-fixtures:v1\n', 'utf8');
  hash.update(canonicalJson(body), 'utf8');
  return `sha256:${hash.digest('hex')}`;
}

/// `source` is the authored seed-assets.json; `sourceDigests` maps each
/// fixture's declared file path to the sha256 hex of its committed bytes
/// (the caller reads files under its own capability discipline — this
/// module never touches the filesystem).
export function buildSeedAssetFixturesV1(source, appId, sourceDigests) {
  closedKeys(source, ['fixtures'], 'seed asset fixtures declaration');
  if (!Array.isArray(source.fixtures) || source.fixtures.length === 0) {
    fail('SNAPBACK_SEED_ASSET_FIXTURES_INVALID', 'fixtures must be a nonempty array');
  }
  if (source.fixtures.length > SEED_ASSET_FIXTURES_MAX_V1) {
    fail('SNAPBACK_SEED_ASSET_FIXTURES_INVALID', `fixtures exceed the ${SEED_ASSET_FIXTURES_MAX_V1} bound`);
  }
  if (typeof appId !== 'string' || appId.length === 0) {
    fail('SNAPBACK_SEED_ASSET_FIXTURES_INVALID', 'seed asset fixtures require a nonempty appId');
  }
  const seen = new Set();
  const fixtures = source.fixtures.map((fixture) => {
    closedKeys(fixture, ['id', 'upload', 'file', 'mediaType'], 'seed asset fixture');
    if (typeof fixture.id !== 'string' || !SEED_VERSION.test(fixture.id)) {
      fail('SNAPBACK_SEED_ASSET_FIXTURES_INVALID', 'fixture id is not a portable identity token');
    }
    if (seen.has(fixture.id)) {
      fail('SNAPBACK_SEED_ASSET_FIXTURES_INVALID', `fixture ids must be unique: ${fixture.id}`);
    }
    seen.add(fixture.id);
    if (typeof fixture.upload !== 'string' || fixture.upload.length === 0) {
      fail('SNAPBACK_SEED_ASSET_FIXTURES_INVALID', `fixture ${fixture.id} upload intent is empty`);
    }
    if (typeof fixture.mediaType !== 'string' || fixture.mediaType.length === 0) {
      fail('SNAPBACK_SEED_ASSET_FIXTURES_INVALID', `fixture ${fixture.id} mediaType is empty`);
    }
    if (
      typeof fixture.file !== 'string'
      || fixture.file.length === 0
      || fixture.file.length > 512
      || fixture.file.startsWith('/')
      || fixture.file.includes('\\')
      || fixture.file.includes('..')
      || fixture.file.split('/').some((segment) => segment.length === 0)
    ) {
      fail('SNAPBACK_SEED_ASSET_FIXTURES_INVALID', `fixture ${fixture.id} file must be a relative path with no traversal`);
    }
    const digest = sourceDigests.get(fixture.file);
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
      fail('SNAPBACK_SEED_ASSET_FIXTURES_INVALID', `fixture ${fixture.id} has no readable source digest for ${fixture.file}`);
    }
    return {
      id: fixture.id,
      upload: fixture.upload,
      file: fixture.file,
      mediaType: fixture.mediaType,
      sourceDigest: `sha256:${digest}`,
    };
  });
  const body = {
    formatVersion: SEED_ASSET_FIXTURES_FORMAT_V1,
    appId,
    fixtures,
  };
  return {
    formatVersion: SEED_ASSET_FIXTURES_FORMAT_V1,
    appId,
    fixturesDigest: seedAssetFixturesDigest(body),
    fixtures,
  };
}

export function canonicalSeedAssetFixturesJson(artifact) {
  return `${canonicalJson(artifact)}\n`;
}

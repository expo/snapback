import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { FROZEN_LEGACY_AUTHORING_PROFILE_ROWS } from './guide-authoring-profiles-baseline.mjs';
import {
  LEGACY_AUTHORING_PROFILE_ROWS,
  resolveAuthoringProfileScopes,
  validateLegacyAuthoringProfileRows,
} from './guide-authoring-profiles.mjs';

function sha256(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

function repoFile(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function pageInfoForRows(rows, rawOverrides = new Map()) {
  return new Map(rows.map(([path]) => [
    path,
    { raw: rawOverrides.get(path) ?? repoFile(path), frontmatter: {} },
  ]));
}

test('current legacy inventory is an exact subset of the frozen survey', () => {
  const errors = [];
  validateLegacyAuthoringProfileRows(LEGACY_AUTHORING_PROFILE_ROWS, errors);

  assert.equal(FROZEN_LEGACY_AUTHORING_PROFILE_ROWS.length, 99);
  assert.equal(LEGACY_AUTHORING_PROFILE_ROWS.length, 94);
  assert.deepEqual(errors, []);
});

test('rejects added rows even when they only fill the old count headroom', () => {
  const candidateRows = [
    ...LEGACY_AUTHORING_PROFILE_ROWS,
    ['guide/new-exemption-a.md', 'neutral', 'a'.repeat(64)],
    ['guide/new-exemption-b.md', 'explicit', 'b'.repeat(64)],
    ['guide/new-exemption-c.md', 'familiar', 'c'.repeat(64)],
    ['guide/new-exemption-d.md', 'explicit+familiar', 'd'.repeat(64)],
    ['guide/new-exemption-e.md', 'neutral', 'e'.repeat(64)],
  ];
  const errors = [];
  validateLegacyAuthoringProfileRows(candidateRows, errors);

  assert.equal(candidateRows.length, FROZEN_LEGACY_AUTHORING_PROFILE_ROWS.length);
  assert.equal(errors.length, 5);
  assert.match(errors[0], /new-exemption-a\.md: .*row was added .*Repair: declare 'authoring-profiles'.*remove the added row/u);
  assert.match(errors[1], /new-exemption-b.md: .*row was added .*Repair: declare 'authoring-profiles'.*remove the added row/u);
});

test('rejects editing a legacy page and rehashing its inventory row', () => {
  const [path, label] = LEGACY_AUTHORING_PROFILE_ROWS[0];
  const editedRaw = `${repoFile(path)}\nMaterial edit that must migrate the page.\n`;
  const rehashedRows = LEGACY_AUTHORING_PROFILE_ROWS.map((row, index) => (
    index === 0 ? [path, label, sha256(editedRaw)] : row
  ));
  const pageInfo = pageInfoForRows(rehashedRows, new Map([[path, editedRaw]]));
  const errors = [];
  resolveAuthoringProfileScopes(pageInfo, errors, { legacyRows: rehashedRows });

  assert(errors.some((error) => /inventory digest changed/u.test(error)));
  assert(errors.some((error) => /edit-and-rehash exemptions are forbidden/u.test(error)));
  assert(errors.some((error) => /declare 'authoring-profiles'.*remove its inventory row; never refresh the digest in place/u.test(error)));
  assert(errors.some((error) => /content changed from legacy authoring-profile baseline/u.test(error)));
});

test('rejects changing the surveyed scope of an inventory row', () => {
  const [path, , digest] = LEGACY_AUTHORING_PROFILE_ROWS[0];
  const changedScopeRows = LEGACY_AUTHORING_PROFILE_ROWS.map((row, index) => (
    index === 0 ? [path, 'explicit', digest] : row
  ));
  const pageInfo = pageInfoForRows(changedScopeRows);
  const errors = [];
  resolveAuthoringProfileScopes(pageInfo, errors, { legacyRows: changedScopeRows });

  assert.equal(errors.length, 1);
  assert.match(
    errors[0],
    /inventory scope changed from 'neutral' to 'explicit'.*Repair: declare 'authoring-profiles'.*remove its inventory row/u,
  );
});

test('rejects restoring an exact row after its page migrated', () => {
  const restored = FROZEN_LEGACY_AUTHORING_PROFILE_ROWS.find(
    ([path]) => path === 'guide/backend/schema-evolution.md',
  );
  const errors = [];
  validateLegacyAuthoringProfileRows([...LEGACY_AUTHORING_PROFILE_ROWS, restored], errors);

  assert.equal(errors.length, 1);
  assert.match(
    errors[0],
    /schema-evolution\.md: .*row was restored after migration; .*may only shrink.*Repair: keep .*'authoring-profiles'.*remove the restored row/u,
  );
});

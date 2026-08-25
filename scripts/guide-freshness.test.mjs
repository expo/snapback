import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  authoritiesDigest,
  authoritiesDigestAtRevision,
  buildManifest,
  checkFreshness,
  isRecordedBenchmarkEventsTranscript,
  parseFrontmatter,
} from './guide-lib.mjs';
import {
  migrateGuideReviewDigests,
  refreshGuideReviewDigests,
} from './migrate-guide-review-digests.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'snapback-guide-freshness-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Guide Freshness Test']);
  git(root, ['config', 'user.email', 'guide-freshness@example.invalid']);
  mkdirSync(join(root, 'guide'));
  writeFileSync(join(root, 'authority.txt'), 'reviewed bytes\n');
  git(root, ['add', 'authority.txt']);
  git(root, ['commit', '--quiet', '-m', 'authority baseline']);
  return { root, reviewedCommit: git(root, ['rev-parse', 'HEAD']) };
}

function pageSource(reviewField) {
  return `---
title: Fixture
id: fixture.page
order: 1
audience: agent-first
capabilities: []
authorities: [authority.txt]
examples: []
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-12
${reviewField}
---

# Fixture
`;
}

test('authority digest ignores unrelated commits and changes on authority bytes', (t) => {
  const { root, reviewedCommit } = fixture(t);
  const reviewedDigest = authoritiesDigestAtRevision(root, ['authority.txt'], reviewedCommit);
  assert.equal(authoritiesDigest(root, ['authority.txt']), reviewedDigest);

  writeFileSync(join(root, 'unrelated.txt'), 'gate-disjoint\n');
  git(root, ['add', 'unrelated.txt']);
  git(root, ['commit', '--quiet', '-m', 'unrelated']);
  assert.equal(authoritiesDigest(root, ['authority.txt']), reviewedDigest);

  writeFileSync(join(root, 'authority.txt'), 'changed authority bytes\n');
  assert.notEqual(authoritiesDigest(root, ['authority.txt']), reviewedDigest);
  const warnings = [];
  checkFreshness(root, new Map([[
    'guide/fixture.md',
    { frontmatter: {
      authorities: ['authority.txt'],
      'reviewed-authorities-digest': reviewedDigest,
    } },
  ]]), warnings, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /authorities changed since review/u);
});

test('directory authority digest uses locale-independent raw path ordering', (t) => {
  const { root } = fixture(t);
  mkdirSync(join(root, 'authority-dir'));
  writeFileSync(join(root, 'authority-dir/Z.txt'), 'upper\n');
  writeFileSync(join(root, 'authority-dir/a.txt'), 'lower\n');

  assert.deepEqual(
    ['authority-dir/Z.txt', 'authority-dir/a.txt'].sort((left, right) => (
      left.localeCompare(right, 'cs-CZ')
    )),
    ['authority-dir/a.txt', 'authority-dir/Z.txt'],
    'fixture names must distinguish Czech collation from raw path ordering',
  );
  assert.equal(
    authoritiesDigest(root, ['authority-dir']),
    'sha256:61ff25b4394acc5cc6be753e3178162b27c43d0c48850f026289ecec15bc8aa7',
  );
});

test('non-ENOENT freshness computation failures remain warnings', (t) => {
  const { root } = fixture(t);
  mkdirSync(join(root, 'authority-dir'));
  writeFileSync(join(root, 'authority-dir/tracked.txt'), 'reviewed bytes\n');
  git(root, ['add', 'authority-dir/tracked.txt']);
  git(root, ['commit', '--quiet', '-m', 'directory authority']);
  const reviewedDigest = authoritiesDigest(root, ['authority-dir']);
  rmSync(join(root, '.git'), { recursive: true, force: true });

  const warnings = [];
  const infos = [];
  checkFreshness(root, new Map([[
    'guide/fixture.md',
    { frontmatter: {
      authorities: ['authority-dir'],
      'reviewed-authorities-digest': reviewedDigest,
    } },
  ]]), warnings, infos);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /could not compute authority freshness/u);
  assert.deepEqual(infos, []);
});

test('manifest regeneration is byte-identical after a gate-disjoint commit', (t) => {
  const { root, reviewedCommit } = fixture(t);
  const reviewedDigest = authoritiesDigestAtRevision(root, ['authority.txt'], reviewedCommit);
  const raw = pageSource(`reviewed-authorities-digest: ${reviewedDigest}`);
  const errors = [];
  const frontmatter = parseFrontmatter(raw, 'guide/fixture.md', errors).frontmatter;
  assert.deepEqual(errors, []);
  frontmatter.id = 'meta.capabilities';
  mkdirSync(join(root, 'guide/reference'), { recursive: true });
  writeFileSync(join(root, 'guide/published-closure.json'), JSON.stringify({
    schemaVersion: 'snapback-published-closure.v1',
    scope: '@expo/snapback-*',
    newestPublished: '0.0.0',
  }));
  for (const path of ['registry.json', 'diagnostics-registry.json']) {
    writeFileSync(join(root, 'guide/reference', path), JSON.stringify({
      schemaVersion: `fixture-${path}`,
      buildIdentity: { sourceDigest: `sha256:${'a'.repeat(64)}` },
      modules: [],
      symbols: [],
      counts: {},
    }));
  }
  const pageInfo = new Map([['guide/fixture.md', { frontmatter, raw }]]);
  const build = () => `${JSON.stringify(buildManifest(
    root,
    pageInfo,
    new Map(),
    { capabilities: new Map() },
    { routes: 0, hostOps: 0 },
  ), null, 2)}\n`;
  const before = build();
  writeFileSync(join(root, 'gate-disjoint.txt'), 'unrelated commit\n');
  git(root, ['add', 'gate-disjoint.txt']);
  git(root, ['commit', '--quiet', '-m', 'gate-disjoint']);
  const after = build();
  assert.equal(after, before);
  assert.equal(JSON.parse(after).buildIdentity.commit, undefined);
  assert.match(JSON.parse(after).buildIdentity.sourceDigest, /^sha256:[0-9a-f]{64}$/u);
});

test('migration preserves the historical verdict and refresh is deliberate', (t) => {
  const { root, reviewedCommit } = fixture(t);
  const pagePath = 'guide/fixture.md';
  writeFileSync(join(root, pagePath), pageSource(`reviewed-commit: ${reviewedCommit}`));
  git(root, ['add', pagePath]);
  git(root, ['commit', '--quiet', '-m', 'reviewed page']);
  writeFileSync(join(root, 'authority.txt'), 'changed after review\n');
  git(root, ['add', 'authority.txt']);
  git(root, ['commit', '--quiet', '-m', 'authority change']);

  const [{ digest }] = migrateGuideReviewDigests(root, [pagePath]);
  assert.equal(digest, authoritiesDigestAtRevision(root, ['authority.txt'], reviewedCommit));
  const migratedSource = readFileSync(join(root, pagePath), 'utf8');
  assert.doesNotMatch(migratedSource, /^reviewed-commit:/mu);
  assert.match(migratedSource, new RegExp(`^reviewed-authorities-digest: ${digest}$`, 'mu'));

  const errors = [];
  const { frontmatter } = parseFrontmatter(migratedSource, pagePath, errors);
  assert.deepEqual(errors, []);
  const warnings = [];
  checkFreshness(root, new Map([[pagePath, { frontmatter }]]), warnings, []);
  assert.equal(warnings.length, 1, 'historical authority change remains stale after migration');

  refreshGuideReviewDigests(root, [pagePath]);
  const refreshed = parseFrontmatter(readFileSync(join(root, pagePath), 'utf8'), pagePath, []).frontmatter;
  const refreshedWarnings = [];
  checkFreshness(root, new Map([[pagePath, { frontmatter: refreshed }]]), refreshedWarnings, []);
  assert.deepEqual(refreshedWarnings, []);
});

test('recorded benchmark events/*.jsonl transcripts are frozen evidence, not authored examples', () => {
  assert.equal(
    isRecordedBenchmarkEventsTranscript(
      'benchmarks/runs/2026-08-23-r2-published-0125/cells/opus-clique-explicit/events/harness.stdout.jsonl',
    ),
    true,
  );
  assert.equal(
    isRecordedBenchmarkEventsTranscript(
      'benchmarks/runs/2026-08-23-r2-published-0125/events/harness.stdout.jsonl',
    ),
    true,
  );
  assert.equal(isRecordedBenchmarkEventsTranscript('guide/backend/assets.md'), false);
  assert.equal(
    isRecordedBenchmarkEventsTranscript(
      'benchmarks/runs/2026-08-23-r2-published-0125/cells/opus-clique-explicit/events/nested/harness.stdout.jsonl',
    ),
    false,
  );
  assert.equal(
    isRecordedBenchmarkEventsTranscript(
      'demos/rematch-bakeoff/snapback/guide-cache/backend_assets.md',
    ),
    false,
  );
});

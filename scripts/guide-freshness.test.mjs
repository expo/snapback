import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  authoritiesDigest,
  authoritiesDigestAtRevision,
  buildManifest,
  checkCapabilityGapRows,
  checkFreshness,
  checkLinks,
  isRecordedBenchmarkEventsTranscript,
  markdownInlineLinks,
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

test('guide links resolve rendered heading anchors with docs-site slug identity', (t) => {
  const { root } = fixture(t);
  const sourcePath = 'guide/source.md';
  const targetPath = 'guide/target.md';
  const source = [
    '[formatted](./target.md#a-marked-heading)',
    '[duplicate](./target.md#repeat-1)',
    '[explicit](./target.md#stable-explicit)',
    '[quoted heading](./target.md#quoted-heading)',
    '[quoted explicit](./target.md#quoted-explicit)',
    '[broken](./target.md#missing-heading)',
  ].join('\n');
  const target = [
    '# A *marked* `Heading`',
    '## Repeat',
    '## Repeat',
    '<a id="stable-explicit"></a>',
    '> ## Quoted heading',
    '>',
    '> <a id="quoted-explicit"></a>',
  ].join('\n');
  writeFileSync(join(root, sourcePath), source);
  writeFileSync(join(root, targetPath), target);

  const errors = [];
  checkLinks(root, new Map([[sourcePath, source], [targetPath, target]]), errors, []);

  assert.deepEqual(errors, [
    `${sourcePath}: relative link resolves to missing anchor #missing-heading in ${targetPath}`,
  ]);
  assert.deepEqual(
    markdownInlineLinks('[Exact](repo(exact):guide/index.md "sibling corpus")'),
    [{
      image: false,
      label: 'Exact',
      target: 'repo(exact):guide/index.md',
      title: 'sibling corpus',
    }],
  );
});

test('guide links with renderer-supported titles still validate their anchors', (t) => {
  const { root } = fixture(t);
  const sourcePath = 'guide/source.md';
  const targetPath = 'guide/target.md';
  const source = '[titled](./target.md#missing-heading "context")\n';
  const target = '# Present heading\n';
  writeFileSync(join(root, sourcePath), source);
  writeFileSync(join(root, targetPath), target);

  const errors = [];
  checkLinks(root, new Map([[sourcePath, source], [targetPath, target]]), errors, []);

  assert.deepEqual(errors, [
    `${sourcePath}: relative link resolves to missing anchor #missing-heading in ${targetPath}`,
  ]);
});

test('GAP review dates warn while closed and missing issue pointers fail', (t) => {
  const { root } = fixture(t);
  mkdirSync(join(root, 'issues/closed'), { recursive: true });
  mkdirSync(join(root, 'issues/foo'));
  mkdirSync(join(root, 'issues/not-a-file.md'));
  writeFileSync(join(root, 'README.md'), '# Outside issues\n');
  writeFileSync(join(root, 'issues/open-gap.md'), '# Open gap\n');
  writeFileSync(join(root, 'issues/closed/closed-gap.md'), '# Closed gap\n');
  symlinkSync('closed/closed-gap.md', join(root, 'issues/closed-alias.md'));
  symlinkSync('../README.md', join(root, 'issues/outside-alias.md'));
  symlinkSync('open-gap.md', join(root, 'issues/open-alias.md'));
  const capabilities = new Map([
    ['expired', {
      id: 'expired',
      page: 'GAP (owner: Owner A, review: 2026-08-23; issue: issues/open-gap.md)',
    }],
    ['soon', {
      id: 'soon',
      page: 'GAP (owner: Owner B, review: 2026-09-01; issue: issues/open-gap.md)',
    }],
    ['future', {
      id: 'future',
      page: 'GAP (owner: Owner C, review: 2026-09-02; issue: issues/open-gap.md)',
    }],
    ['closed', {
      id: 'closed',
      page: 'GAP (owner: Owner D, review: 2026-09-30; issue: issues/closed/closed-gap.md)',
    }],
    ['missing', {
      id: 'missing',
      page: 'GAP (owner: Owner E, review: 2026-09-30; issue: issues/missing-gap.md)',
    }],
    ['outside-traversal', {
      id: 'outside-traversal',
      page: 'GAP (owner: Owner F, review: 2026-09-30; issue: issues/../README.md)',
    }],
    ['closed-traversal', {
      id: 'closed-traversal',
      page: 'GAP (owner: Owner G, review: 2026-09-30; issue: issues/foo/../closed/closed-gap.md)',
    }],
    ['not-a-file', {
      id: 'not-a-file',
      page: 'GAP (owner: Owner H, review: 2026-09-30; issue: issues/not-a-file.md)',
    }],
    ['closed-alias', {
      id: 'closed-alias',
      page: 'GAP (owner: Owner I, review: 2026-09-30; issue: issues/closed-alias.md)',
    }],
    ['outside-alias', {
      id: 'outside-alias',
      page: 'GAP (owner: Owner J, review: 2026-09-30; issue: issues/outside-alias.md)',
    }],
    ['open-alias', {
      id: 'open-alias',
      page: 'GAP (owner: Owner K, review: 2026-09-30; issue: issues/open-alias.md)',
    }],
  ]);
  const errors = [];
  const warnings = [];

  checkCapabilityGapRows(root, capabilities, errors, warnings, { today: '2026-08-25' });

  assert.deepEqual(errors, [
    "guide/capabilities.md: GAP row 'closed' points at closed issue issues/closed/closed-gap.md",
    "guide/capabilities.md: GAP row 'missing' points at missing issue issues/missing-gap.md",
    "guide/capabilities.md: GAP row 'outside-traversal' has unsafe issue pointer issues/../README.md: '.' and '..' path segments are forbidden",
    "guide/capabilities.md: GAP row 'closed-traversal' has unsafe issue pointer issues/foo/../closed/closed-gap.md: '.' and '..' path segments are forbidden",
    "guide/capabilities.md: GAP row 'not-a-file' issue pointer is not a regular file: issues/not-a-file.md",
    "guide/capabilities.md: GAP row 'closed-alias' points at closed issue issues/closed-alias.md",
    "guide/capabilities.md: GAP row 'outside-alias' issue pointer resolves outside canonical issues/: issues/outside-alias.md",
    "guide/capabilities.md: GAP row 'open-alias' issue pointer is not a regular file: issues/open-alias.md",
  ]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /GAP REVIEW WARNING: row 'expired' expired on 2026-08-23; owner: Owner A; pointer: issues\/open-gap\.md/u);
  assert.match(warnings[1], /GAP REVIEW WARNING: row 'soon' expires within 7 days on 2026-09-01; owner: Owner B; pointer: issues\/open-gap\.md/u);
});

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

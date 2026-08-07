import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkPublishedClosure } from './guide-lib.mjs';

const PUBLISHED_CLOSURE = {
  schemaVersion: 'snapback-published-closure.v1',
  scope: '@expo/snapback-*',
  registry: 'https://registry.npmjs.org',
  newestPublished: '0.1.8',
  publishedAt: '2026-08-01',
  newestQualified: '0.1.7',
  updateProtocol: 'test fixture',
};

async function tempRoot(t, { record = PUBLISHED_CLOSURE, raw } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'snapback-guide-published-closure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'guide'), { recursive: true });
  if (raw !== undefined) {
    await writeFile(join(root, 'guide', 'published-closure.json'), raw);
  } else if (record !== null) {
    await writeFile(
      join(root, 'guide', 'published-closure.json'),
      `${JSON.stringify(record, null, 2)}\n`,
    );
  }
  return root;
}

function check(root, { frontmatter, body = '' }) {
  const path = 'guide/test.md';
  const errors = [];
  checkPublishedClosure(
    root,
    new Map([[path, { frontmatter }]]),
    new Map([[path, body]]),
    errors,
  );
  return errors;
}

test('accepts a shipped surface available in the published closure', async (t) => {
  const root = await tempRoot(t);
  const errors = check(root, {
    frontmatter: { maturity: 'shipped', since: '0.1.7' },
  });
  assert.deepEqual(errors, []);
});

test('rejects a shipped page newer than the closure without an unreleased fence', async (t) => {
  const root = await tempRoot(t);
  const errors = check(root, {
    frontmatter: { maturity: 'shipped', since: '0.1.9' },
  });
  assert(errors.some((error) => error.includes('page claims a surface the newest published closure')));
});

test('rejects an unreleased page without its rendered banner', async (t) => {
  const root = await tempRoot(t);
  const errors = check(root, {
    frontmatter: { maturity: 'shipped', since: '0.1.9', unreleased: 'true' },
    body: '# Test page\n\n## First section\n',
  });
  assert(errors.some((error) => error.includes('unreleased page requires a rendered banner')));
});

test('rejects a stale page-level unreleased fence', async (t) => {
  const root = await tempRoot(t);
  const errors = check(root, {
    frontmatter: { maturity: 'shipped', since: '0.1.8', unreleased: 'true' },
    body: '# Test page\n\n> **Unreleased.** This banner names 0.1.8.\n\n## First section\n',
  });
  assert(errors.some((error) => error.includes('stale unreleased fence')));
  assert(!errors.some((error) => error.includes('requires a rendered banner')));
});

test('accepts an unreleased section marker with the required banner', async (t) => {
  const root = await tempRoot(t);
  const errors = check(root, {
    frontmatter: { maturity: 'shipped' },
    body:
      '# Test page\n\n## Future surface\n\n<!-- since: 0.1.9 unreleased -->\n\n' +
      '> **Unreleased.** This surface is not in 0.1.8.\n> Expected next.\n',
  });
  assert.deepEqual(errors, []);
});

test('rejects an unreleased section marker without the required banner', async (t) => {
  const root = await tempRoot(t);
  const errors = check(root, {
    frontmatter: { maturity: 'shipped' },
    body: '# Test page\n\n<!-- since: 0.1.9 unreleased -->\n\nFuture prose.\n',
  });
  assert(errors.some((error) => error.includes('unreleased section marker must be immediately followed')));
});

test('rejects malformed section marker versions', async (t) => {
  const root = await tempRoot(t);
  const errors = check(root, {
    frontmatter: { maturity: 'shipped' },
    body: '# Test page\n\n<!-- since: 0.1 unreleased -->\n',
  });
  assert(errors.some((error) => error.includes('invalid since marker')));
});

test('reports malformed and missing published-closure records as errors', async (t) => {
  await t.test('malformed JSON', async (t) => {
    const root = await tempRoot(t, { raw: '{not json' });
    const errors = check(root, { frontmatter: { maturity: 'shipped' } });
    assert(errors.some((error) => error.includes('malformed JSON')));
  });

  await t.test('missing record', async (t) => {
    const root = await tempRoot(t, { record: null });
    const errors = check(root, { frontmatter: { maturity: 'shipped' } });
    assert(errors.some((error) => error.includes('missing published-closure record')));
  });
});

test('reports wrong schema and malformed newestPublished fields', async (t) => {
  const root = await tempRoot(t, {
    record: { ...PUBLISHED_CLOSURE, schemaVersion: 'wrong', newestPublished: '0.1' },
  });
  const errors = check(root, { frontmatter: { maturity: 'shipped' } });
  assert(errors.some((error) => error.includes('schemaVersion must be')));
  assert(errors.some((error) => error.includes('newestPublished must be')));
});

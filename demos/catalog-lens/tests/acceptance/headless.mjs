import { join } from 'node:path';

import { openHeadlessApp } from '../../../_kit/headless-app.mjs';
import {
  assert,
  assertEqual,
  assertThrows,
  createSuite,
  runAcceptance,
} from '../../../_kit/harness.mjs';
import api from '../../snapback/generated/api.mjs';

const ADA = 'user_catalog_ada';
const GRACE = 'user_catalog_grace';
const suite = createSuite('catalog-lens / headless', { expectedChecks: 5 });
const app = await openHeadlessApp(import.meta.url, { appId: 'catalog-lens' });

await runAcceptance(suite, async () => {
  await suite.check('generated app provisions with relational capability', async () => {
    assertEqual(app.provisioned.functions, 'provisioned', 'functions provisioned');
    const fn = app.generated('functions.manifest.json').functions
      .find(({ name }) => name === 'booksWithPublisher');
    assert(fn.requiredCapabilities.includes('relational_query_v1'), 'relational capability missing');
  });

  await app.client.mutate(api.addPublisher, {
    userId: ADA,
    args: { slug: 'north', name: 'North Press', country: 'US' },
  });
  for (let index = 0; index < 4; index += 1) {
    await app.client.mutate(api.addBook, {
      userId: ADA,
      args: {
        isbn: `ada-${index}`,
        title: `Ada Book ${index}`,
        publisherSlug: index === 3 ? 'missing' : 'north',
      },
    });
  }
  await app.client.mutate(api.addBook, {
    userId: GRACE,
    args: { isbn: 'grace-0', title: 'Grace Book', publisherSlug: 'north' },
  });

  let first;
  await suite.check('first page joins three roots and returns an opaque cursor', async () => {
    first = await app.client.query(api.booksWithPublisher, { userId: ADA });
    assertEqual(first.rows.length, 3, 'first page size');
    assert(first.rows.every(({ publisherName }) => publisherName === 'North Press'), 'join did not resolve');
    assert(first.cursor?.startsWith('sbrc1.'), 'missing relational cursor');
  });

  await suite.check('second page is terminal and preserves left-join nulls', async () => {
    const second = await app.client.query(api.booksWithPublisher, {
      userId: ADA,
      args: { cursor: first.cursor },
    });
    assertEqual(second.rows.length, 1, 'second page size');
    assertEqual(second.rows[0].publisherName ?? null, null, 'missing publisher is null');
    assertEqual(second.cursor ?? null, null, 'short page is terminal');
  });

  await suite.check('owner authority partitions relational results', async () => {
    const grace = await app.client.query(api.booksWithPublisher, { userId: GRACE });
    assertEqual(grace.rows.map(({ isbn }) => isbn), ['grace-0'], 'cross-owner row leaked');
  });

  await suite.check('tampered cursor refuses with the stable diagnostic', async () => {
    await assertThrows(
      () => app.client.query(api.booksWithPublisher, {
        userId: ADA,
        args: { cursor: `${first.cursor.slice(0, -2)}zz` },
      }),
      'SNAPBACK_RELATIONAL_CURSOR_INVALID',
      'tampered relational cursor',
    );
  });
}, {
  cleanups: [app.close],
  reportFile: join(app.appDir, 'acceptance-report.json'),
});

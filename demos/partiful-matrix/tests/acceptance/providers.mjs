import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { __startServerForTests } from '../../../_kit/server-process.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import api from '../../snapback/generated/api.mjs';
import { createConvexAdapter } from '../../backends/gateway/convex.ts';
import { loadLocalSecrets, requireSecret } from '../../backends/gateway/secrets.mjs';
import { createSqliteAdapter } from '../../backends/gateway/sqlite.ts';
import { createSupabaseAdapter } from '../../backends/gateway/supabase.ts';

const here = import.meta.dirname;
const repoRoot = resolve(here, '..', '..', '..', '..');
const backendDir = resolve(here, '..', '..', 'snapback');
const generated = (name) => JSON.parse(readFileSync(join(backendDir, 'generated', name), 'utf8'));
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));
const secrets = loadLocalSecrets(repoRoot);
const suite = createSuite('partiful matrix / provider conformance', { expectedChecks: 13 });
const cleanups = [];

await runAcceptance(suite, async () => {
  const server = await __startServerForTests(
    { port: 0, db: ':memory:', cwd: repoRoot, provenance: { appId: 'partiful-matrix', artifactsPath: join(backendDir, 'generated', 'artifacts.json') } },
    { launchSpec: ({ args }) => ({ command: join(repoRoot, 'target', 'debug', 'snapback'), args: args.slice(args.indexOf('--') + 1), cwd: repoRoot, env: process.env }) },
  );
  cleanups.push(() => server.stop());
  const snapback = new SnapbackClient(server.baseUrl, server.clientOptions);
  await snapback.ensureApp({ schema: generated('schema.manifest.json'), functions: generated('functions.manifest.json'), seed });

  const sqliteDir = mkdtempSync(join(tmpdir(), 'partiful-matrix-sqlite-'));
  cleanups.push(() => rmSync(sqliteDir, { recursive: true, force: true }));
  const adapters = {
    sqlite: createSqliteAdapter(join(sqliteDir, 'matrix.sqlite')),
    supabase: await createSupabaseAdapter(requireSecret(secrets, 'DIRECT_URL', 'DATABASE_URL', 'SUPABASE_DB_URL')),
    convex: createConvexAdapter(requireSecret(secrets, 'CONVEX_DEPLOY_KEY', 'CONVEX_URL')),
  };
  cleanups.push(...Object.values(adapters).map((adapter) => () => adapter.close?.()));

  let canonical;
  await suite.check('Snapback loads generated artifacts and the shared fixture', async () => {
    canonical = (await snapback.query(api.listEvents, { userId: 'user_matrix_acceptance' })).rows;
    assertEqual(canonical.length, 3, 'Snapback seed count');
    assertEqual(canonical[0].title, 'Sunset Supper Club', 'Snapback first event');
  });

  for (const [name, adapter] of Object.entries(adapters)) {
    await suite.check(`${name} exposes the same ordered event fixture`, async () => {
      const rows = await adapter.query('listEvents', {});
      assertEqual(rows.map(({ _id, title, startsAt }) => ({ _id, title, startsAt })), canonical.map(({ _id, title, startsAt }) => ({ _id, title, startsAt })), `${name} canonical event projection`);
    });
  }

  await suite.check('Snapback RSVP converges through its generated mutation and live-query table', async () => {
    await snapback.mutate(api.rsvp, { args: { eventId: 'event_sunset', guestName: 'Matrix Bot', status: 'going' }, userId: 'user_matrix_acceptance' });
    const rows = (await snapback.query(api.guestList, { args: { eventId: 'event_sunset' }, userId: 'user_matrix_acceptance' })).rows;
    assert(rows.some((row) => row.userId === 'user_matrix_acceptance' && row.status === 'going'), 'Snapback RSVP missing');
  });

  await suite.check('Snapback completes create → host seat → wall post', async () => {
    const created = await snapback.mutate(api.createEvent, {
      args: { title: '[acceptance] Snapback write loop', emoji: '🧪', description: 'ephemeral acceptance row', location: 'test lab', startsAt: 1787000000000, hostName: 'Matrix Bot', accent: 'cobalt' },
      userId: 'user_matrix_acceptance',
    });
    const eventId = created.result;
    const guests = (await snapback.query(api.guestList, { args: { eventId }, userId: 'user_matrix_acceptance' })).rows;
    assert(guests.some((row) => row.status === 'host'), 'Snapback host seat missing');
    await snapback.mutate(api.postMessage, { args: { eventId, authorName: 'Matrix Bot', message: 'write loop complete', createdAt: 1787000001000 }, userId: 'user_matrix_acceptance' });
    const wall = (await snapback.query(api.eventWall, { args: { eventId }, userId: 'user_matrix_acceptance' })).rows;
    assertEqual(wall.map((row) => row.message), ['write loop complete'], 'Snapback wall post');
  });

  for (const [name, adapter] of Object.entries(adapters)) {
    await suite.check(`${name} RSVP uses the same idempotent event/person contract`, async () => {
      await adapter.mutate('rsvp', { eventId: 'event_sunset', guestName: 'Matrix Bot', status: 'going' }, 'user_matrix_acceptance');
      const rows = await adapter.query('guestList', { eventId: 'event_sunset' });
      assert(rows.some((row) => row.userId === 'user_matrix_acceptance' && row.status === 'going'), `${name} RSVP missing`);
      assertEqual(rows.filter((row) => row.userId === 'user_matrix_acceptance').length, 1, `${name} duplicate RSVP`);
    });
  }

  for (const [name, adapter] of Object.entries(adapters)) {
    await suite.check(`${name} completes create → host seat → wall post`, async () => {
      const eventId = await adapter.mutate('createEvent', { title: `[acceptance] ${name} write loop`, emoji: '🧪', description: 'temporary acceptance row', location: 'test lab', startsAt: 1787000000000, hostName: 'Matrix Bot', accent: 'cobalt' }, 'user_matrix_acceptance');
      try {
        const guests = await adapter.query('guestList', { eventId });
        assert(guests.some((row) => row.status === 'host'), `${name} host seat missing`);
        await adapter.mutate('postMessage', { eventId, authorName: 'Matrix Bot', message: 'write loop complete', createdAt: 1787000001000 }, 'user_matrix_acceptance');
        const wall = await adapter.query('eventWall', { eventId });
        assertEqual(wall.map((row) => row.message), ['write loop complete'], `${name} wall post`);
      } finally {
        assert(await adapter.cleanupAcceptanceEvent(eventId), `${name} acceptance cleanup refused`);
      }
    });
  }

  // The portable row-shape oracle intentionally compares the three gateway
  // adapters. Snapback's raw rows carry system metadata fields that are not
  // part of the language-neutral gateway contract; its projected product
  // fields are already compared above, and its generated query/mutation path
  // has dedicated checks. Including raw Snapback keys here would test storage
  // metadata equality rather than provider portability (Exact 0373 §5.1).
  await suite.check('all gateway providers agree on event, RSVP, and wall row shapes', async () => {
    const projections = await Promise.all(Object.values(adapters).map(async (adapter) => ({
      event: Object.keys((await adapter.query('eventDetails', { eventId: 'event_sunset' }))[0]).sort(),
      rsvp: Object.keys((await adapter.query('guestList', { eventId: 'event_sunset' }))[0]).sort(),
      post: Object.keys((await adapter.query('eventWall', { eventId: 'event_sunset' }))[0]).sort(),
    })));
    for (const value of projections.slice(1)) assertEqual(value, projections[0], 'portable row shape');
  });
}, { cleanups });

// Shindig demo — headless acceptance suite (the required surface).
//
// Proves the Partiful-shaped product claims: bootstrap-created events seat
// their host atomically, invites are visible app data while the roster stays
// private, RSVP'ing seats a guest through the declared self-insert transition
// and unlocks the members-only event page / guest list / wall, and the
// membership boundary (not handler convention) denies everyone else.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { importGeneratedModule, readGeneratedJson } from '../../../_kit/generated-artifacts.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { assert, assertEqual, assertThrows, createSuite, eventually, runAcceptance } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const generatedRoot = join(backendDir, 'generated');
const gen = (f) => readGeneratedJson(generatedRoot, f);
const { default: api } = await importGeneratedModule(generatedRoot, 'api.mjs');

const ADA = 'user_ada'; // host
const GRACE = 'user_grace'; // invited guest
const EVE = 'user_eve'; // never invited
const LINUS = 'user_linus'; // duplicate-invite race target

const suite = createSuite('shindig / headless', { expectedChecks: 14 });
const cleanups = [];

await runAcceptance(suite, async () => {
  const server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    provenance: {
      appId: 'shindig',
      artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
    },
  });
  cleanups.push(() => server.stop());
  const db = new SnapbackClient(server.baseUrl, server.clientOptions);

  let eventId = null;

  await suite.check('health + artifact load', async () => {
    const health = await db.health();
    assert(health.ok, 'server not ok');
    const schemaLoad = await db.loadSchema(gen('schema.manifest.json'));
    assertEqual(
      schemaLoad.diagnostics.filter((d) => d.severity === 'Error' || d.severity === 'Fatal'),
      [],
      'schema errors',
    );
    await db.loadFunctions(gen('functions.manifest.json'));
    await db.reset();
  });

  await suite.check('createEvent bootstraps the event and seats the host', async () => {
    const created = await db.mutate(api.createEvent, {
      args: {
        title: 'Rooftop Solstice',
        emoji: '🌇',
        description: 'Golden hour, snacks, synths.',
        location: 'The roof',
        startsAt: 1789500000000,
        hostName: 'Ada',
      },
      userId: ADA,
    });
    assert(typeof created.result === 'string' && created.result.length > 0, 'no event id returned');
    eventId = created.result;
    const feed = await db.query(api.myFeed, { userId: ADA });
    assertEqual(feed.rows.map((r) => [r.eventTitle, r.status]), [['Rooftop Solstice', 'host']], 'host feed card');
    return { eventId };
  });

  await suite.check('host reads the event page through the membership gate', async () => {
    const event = (await db.query(api.getEvent, { args: { eventId }, userId: ADA })).rows[0];
    assertEqual(event.title, 'Rooftop Solstice', 'event title');
    assertEqual(event.location, 'The roof', 'event location');
  });

  await suite.check('host invites a guest; the card lands in her live feed', async () => {
    const feed = await db.liveQuery(api.myFeed, { connectionId: 'grace_feed', userId: GRACE });
    assertEqual(feed.rows, [], 'grace starts with an empty feed');
    await db.mutate(api.invite, {
      args: { eventId, userId: GRACE, guestName: 'Grace' },
      userId: ADA,
    });
    // Phase 1 (LLP 0200): fan-out is scheduled off the commit turn — poll
    // until the invite card lands instead of asserting one immediate drain.
    const rows = await eventually(async () => {
      const polled = await feed.poll();
      assertEqual(polled.map((r) => [r.eventTitle, r.status]), [['Rooftop Solstice', 'invited']], 'invited card');
      return polled;
    }, 'invite card in grace_feed');
    assertEqual(rows[0].hostName, 'Ada', 'denormalized host name');
  });

  await suite.check('the unique event-person index admits one concurrent invite', async () => {
    const outcomes = await Promise.allSettled([
      db.mutate(api.invite, {
        args: { eventId, userId: LINUS, guestName: 'Linus' },
        userId: ADA,
      }),
      db.mutate(api.invite, {
        args: { eventId, userId: LINUS, guestName: 'Linus' },
        userId: ADA,
      }),
    ]);
    assertEqual(outcomes.filter(({ status }) => status === 'fulfilled').length, 1, 'one invite wins');
    const rejected = outcomes.find(({ status }) => status === 'rejected');
    assert(
      ['SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION', 'SNAPBACK_AUTH_RESERVATION_STALE'].includes(
        rejected?.reason?.diagnostic?.code,
      ),
      `concurrent loser must fail before or at the unique commit, got ${rejected?.reason?.diagnostic?.code}`,
    );
    await assertThrows(
      () => db.mutate(api.invite, {
        args: { eventId, userId: LINUS, guestName: 'Linus' },
        userId: ADA,
      }),
      'SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION',
      'a duplicate reaching the settled write boundary gets the stable unique diagnostic',
    );
    const guests = await db.query(api.guestList, { args: { eventId }, userId: ADA });
    assertEqual(
      guests.rows.filter((r) => r.userId === LINUS).length,
      1,
      'exactly one Linus invite row survives the race',
    );
  });

  await suite.check('an invited-but-unresponded guest cannot open the event page', async () => {
    const err = await assertThrows(
      () => db.query(api.getEvent, { args: { eventId }, userId: GRACE }),
      'SNAPBACK_AUTH_PERMISSION_DENIED',
      'RSVP-first gate',
    );
    assertEqual(err.diagnostic.details?.kind, 'role', 'invariant denial shape');
  });

  await suite.check('only hosts can invite', async () => {
    await assertThrows(
      () => db.mutate(api.invite, { args: { eventId, userId: EVE, guestName: 'Eve' }, userId: GRACE }),
      'SNAPBACK_AUTH_PERMISSION_DENIED',
      'non-host invite must be denied',
    );
  });

  await suite.check('an uninvited user cannot RSVP', async () => {
    await assertThrows(
      () => db.mutate(api.rsvp, { args: { eventId, status: 'going' }, userId: EVE }),
      null,
      'uninvited rsvp must fail',
    );
    const feed = await db.query(api.myFeed, { userId: EVE });
    assertEqual(feed.rows, [], 'no feed row appears from a refused rsvp');
  });

  await suite.check("RSVP'ing seats the guest and unlocks the event page", async () => {
    await db.mutate(api.rsvp, {
      args: { eventId, status: 'going', note: 'bringing limes' },
      userId: GRACE,
    });
    const event = (await db.query(api.getEvent, { args: { eventId }, userId: GRACE })).rows[0];
    assertEqual(event.title, 'Rooftop Solstice', 'event page unlocked');
    const feed = await db.query(api.myFeed, { userId: GRACE });
    assertEqual(feed.rows.map((r) => [r.status, r.note]), [['going', 'bringing limes']], 'responded card');
  });

  await suite.check('the host sees the RSVP arrive on the live guest list', async () => {
    const guests = await db.liveQuery(api.guestList, {
      connectionId: 'ada_guests',
      args: { eventId },
      userId: ADA,
    });
    assertEqual(
      guests.rows.map((r) => [r.guestName, r.status]).sort(),
      [['Ada', 'host'], ['Grace', 'going'], ['Linus', 'invited']],
      'guest list snapshot',
    );
    await db.mutate(api.rsvp, { args: { eventId, status: 'maybe' }, userId: GRACE });
    // Phase 1 (LLP 0200): poll until the scheduled fan-out delivers the change.
    await eventually(async () => {
      const rows = await guests.poll();
      assertEqual(
        rows.map((r) => [r.guestName, r.status]).sort(),
        [['Ada', 'host'], ['Grace', 'maybe'], ['Linus', 'invited']],
        'status change delivered live',
      );
    }, 'RSVP status change on ada_guests');
  });

  await suite.check('a changed RSVP does not re-seat membership', async () => {
    // grace is already a guest; a second rsvp must take the patch-only path.
    await db.mutate(api.rsvp, { args: { eventId, status: 'going' }, userId: GRACE });
    const feed = await db.query(api.myFeed, { userId: GRACE });
    assertEqual(feed.rows[0].status, 'going', 'status updated in place');
  });

  await suite.check('the host cannot RSVP to their own party', async () => {
    await assertThrows(
      () => db.mutate(api.rsvp, { args: { eventId, status: 'cant' }, userId: ADA }),
      null,
      'host rsvp must fail',
    );
  });

  await suite.check('non-members get nothing from the gated live queries', async () => {
    const guests = await db.liveQuery(api.guestList, {
      connectionId: 'eve_guests',
      args: { eventId },
      userId: EVE,
    });
    assertEqual(guests.rows, [], 'non-member guest list starts empty');
    const post = await db.mutate(api.postToWall, {
      args: { eventId, message: 'see everyone soon!', authorName: 'Ada' },
      userId: ADA,
    });
    // Phase 1 (LLP 0200): fan-out is scheduled off the commit turn, and a
    // subscription the matcher skips converges through a rows-free
    // `current_as_of` watermark at the commit's version. Wait on that
    // watermark so the no-leak assert observes a completed fan-out pass.
    const updates = [];
    await eventually(async () => {
      updates.push(...await db.drainUpdates('eve_guests'));
      assert(
        updates.some((u) => u.kind === 'current_as_of' && u.version >= post.version),
        `no current_as_of watermark at version ${post.version} yet`,
      );
    }, 'eve_guests convergence watermark');
    assertEqual(
      updates.filter((u) => u.kind !== 'current_as_of'),
      [],
      'member activity must not leak to a non-member subscription',
    );
    await assertThrows(
      () => db.mutate(api.postToWall, { args: { eventId, message: 'hi', authorName: 'Eve' }, userId: EVE }),
      'SNAPBACK_AUTH_PERMISSION_DENIED',
      'non-member wall post must be denied',
    );
  });

  await suite.check('the wall is live for members', async () => {
    const wall = await db.liveQuery(api.eventWall, {
      connectionId: 'grace_wall',
      args: { eventId },
      userId: GRACE,
    });
    assertEqual(wall.rows.map((r) => r.message), ['see everyone soon!'], 'wall snapshot');
    await db.mutate(api.postToWall, {
      args: { eventId, message: 'limes acquired 🍋', authorName: 'Grace' },
      userId: GRACE,
    });
    // Phase 1 (LLP 0200): poll until the scheduled fan-out delivers the post.
    const rows = await eventually(async () => {
      const polled = await wall.poll();
      assertEqual(polled.length, 2, 'member post not yet delivered');
      return polled;
    }, 'member post on grace_wall');
    assertEqual(
      rows.map((r) => [r.authorName, r.message]),
      [['Ada', 'see everyone soon!'], ['Grace', 'limes acquired 🍋']],
      'wall delivers member posts in order',
    );
  });
}, { cleanups });

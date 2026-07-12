// All Aboard — data-source badge freshness acceptance (ENG-23642).
//
// Pure-helper checks over the Contract surface's feedSourceBadge: LIVE only
// when the last committed refresh was a real 511 snapshot AND it is younger
// than the freshness window; a live source whose snapshot aged out is STALE
// (non-live), and every non-live source stays DEMO DATA. Guards the failure
// mode where an advancing feed marker dressed old rows up as live data.
//
// Run: node demos/all-aboard/tests/acceptance/badge-freshness.mjs
// (node >= 22.18 strips the .ts types on import)

import { assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';

const { feedSourceBadge, feedStaleDeadline } = await import('../../surfaces/contract/data.ts');

const suite = createSuite('all-aboard badge freshness');

const LIVE = '511-siri-stop-monitoring';
const NOW = 1_800_000_000_000;
const WINDOW = 390_000;

await runAcceptance(suite, async () => {
  await suite.check('a recorded/seed/fallback source is DEMO DATA, never live', async () => {
    for (const lastSource of ['seed', 'recorded', 'recorded-fallback', 'reset', '']) {
      const badge = feedSourceBadge([{ lastSource, fetchedAt: NOW, staleAfterMs: WINDOW }], NOW);
      assertEqual(badge.live, false, `${lastSource || '(empty)'} is non-live`);
      assertEqual(badge.label, 'DEMO DATA', `${lastSource || '(empty)'} label`);
    }
  });

  await suite.check('a fresh live snapshot is LIVE', async () => {
    const badge = feedSourceBadge([{ lastSource: LIVE, fetchedAt: NOW - 60_000, staleAfterMs: WINDOW }], NOW);
    assertEqual(badge.live, true, 'fresh live snapshot is live');
    assertEqual(badge.label, 'LIVE', 'fresh live snapshot label');
  });

  await suite.check('a live snapshot older than the freshness window is STALE and non-live', async () => {
    const badge = feedSourceBadge([{ lastSource: LIVE, fetchedAt: NOW - WINDOW - 1, staleAfterMs: WINDOW }], NOW);
    assertEqual(badge.live, false, 'aged-out live snapshot is non-live');
    assertEqual(badge.label, 'STALE', 'aged-out live snapshot label');
  });

  await suite.check('the boundary sits exactly at staleAfterMs', async () => {
    const atWindow = feedSourceBadge([{ lastSource: LIVE, fetchedAt: NOW - WINDOW, staleAfterMs: WINDOW }], NOW);
    assertEqual(atWindow.label, 'LIVE', 'exactly at the window is still live');
  });

  await suite.check('a live row without staleAfterMs falls back to the seeded default window', async () => {
    const fresh = feedSourceBadge([{ lastSource: LIVE, fetchedAt: NOW - 300_000 }], NOW);
    assertEqual(fresh.label, 'LIVE', '5 minutes old is inside the default 390s window');
    const stale = feedSourceBadge([{ lastSource: LIVE, fetchedAt: NOW - 400_000 }], NOW);
    assertEqual(stale.label, 'STALE', '400s old is outside the default 390s window');
  });

  await suite.check('the deadline schedules the first millisecond after the inclusive boundary', async () => {
    const rows = [{ lastSource: LIVE, fetchedAt: NOW, staleAfterMs: WINDOW }];
    const deadline = NOW + WINDOW + 1;
    assertEqual(feedStaleDeadline(rows, NOW), deadline, 'deadline is boundary + 1ms');
    assertEqual(feedSourceBadge(rows, deadline - 1, 'light').label, 'LIVE', 'exact boundary remains live');
    assertEqual(feedSourceBadge(rows, deadline, 'light').label, 'STALE', 'first later millisecond is stale');
    assertEqual(feedStaleDeadline(rows, deadline), null, 'past deadlines are not re-armed');
  });
});

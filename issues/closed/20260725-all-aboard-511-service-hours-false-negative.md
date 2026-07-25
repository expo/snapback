# all-aboard remote acceptance: false negative outside Caltrain service hours

**Opened:** 2026-07-25
**Systems:** Cloudflare arm, All Aboard demo, acceptance suites

`cloudflare/test/acceptance.remote.all-aboard.mjs` polls the real 511.org
SIRI StopMonitoring feed on the live deployment. Its check
"live 511 refresh writes real future departure rows" required
`liveDepartures` rows with a future `predictedDepartureMs` unconditionally.
Outside Caltrain service hours (nights, early weekend mornings) the real
upstream legitimately reports zero monitored visits, so an honest live
commit writes zero departure rows and the check failed even though the
preceding check ("live 511 refresh commits through applyLiveFeedSnapshot
with the real key") had already proven the real key, the real fetch, and
the commit path (its note read "mapped 0 departures from 0 511 visits").

Observed 2026-07-25 ~04:35 PT: refresh committed via
`511-siri-stop-monitoring`, 0 visits, check 17 failed — a false negative
that made the suite time-of-day dependent.

## Resolution (2026-07-25)

Test-only change (no app code, no deployment-identity change): the check
now soft-passes with the note
`skipped-no-service: 0 monitored 511 visits (outside service hours), live
path proven by the refresh commit check` when — and only when — the
refresh went through the live path AND the zero-visits window is
positively identified:

- `liveWorked` must hold (committed via `511-siri-stop-monitoring`, or
  budget-guarded per the existing logic, with `lastSource` pinned to
  `511-siri-stop-monitoring`), so fallbacks and fetch failures are never
  masked;
- the board holds zero `liveDepartures` rows; and
- for a committed refresh, the mechanical note parses as
  `mapped N departures from 0 511 visits` (`refresh.result` carries no
  structured visit count — `applyLiveFeedSnapshot` returns only
  `{ source, patterns, note }` — and the live deployment predates any such
  field, so the note is parsed and a non-matching note fails closed); for
  a budget-guarded reuse of another poll's commit (which has no note), the
  committed row must carry an empty `lastError` — the handler records an
  explicit `lastError` exactly when visits > 0 mapped to zero departures.

During service hours (visits > 0) the future-departure-rows assertion is
unchanged and fully enforced. A structured `visitCount` on the refresh
result was considered and skipped as disproportionate: it would change the
deployment identity, the live deployment would not carry it until the next
redeploy, and the suite would need the note-parse fallback anyway.

Verified against the live deployment pre-service-hours on 2026-07-25
(~04:52 PT): checks 1-19 green, with check 17 exercising exactly the
zero-visits soft-pass path ("mapped 0 departures from 0 511 visits" on
check 16, the skipped-no-service note on check 17). The run then failed
the unrelated directions check on a concurrent real OpenRouteService
outage from the worker egress — see
`issues/20260725-all-aboard-routeestimate-outage-fragility.md`, whose
crash-on-timeout-envelope defect (found because this fix let the suite
reach check 20 for the first time in this window) is fixed in the same
commit. A clearly-labeled diagnostic run from an uncommitted temp copy
with only the directions condition bypassed confirmed the trailing
checks: 21 (eviction surrogate) and 22 (demand release) both pass, 22/22.

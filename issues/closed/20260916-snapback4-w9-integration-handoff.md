# Handoff: LLP 3000.009 increments A1 and C1 — integrate, verify, measure, land

**Opened:** 2026-09-16 · **Owner:** Codex lead · **State:** resolved 2026-09-16

## 2026-09-16 resolution

All implementation work handed off here landed: A1/C1 in `9d9a5cb67`,
the fixture pack in `ac243ad73`, A2 in `f32c079f2`, and A3 in `2a791fe17`.
The [A2](../../snapback4/reports/20260916-a2.md) and
[A3](../../snapback4/reports/20260916-a3.md) reports retain qualification,
independent reviews, earlier failures and limits. C1's provisional targets
were all missed; the measurement was reported rather than tuned. The
Postgres replay-binding defect remains open for C3, as directed.

The earlier continuation update below was stale after A2/A3/fixtures landed;
its remaining-work statements are now historical. Charlie subsequently
requested the first Workroom cell and approved prerequisite publication.
A concurrent session published 0.2.26 with A2/A3; the new
[Workroom run record](../../benchmarks/runs/2026-09-16-workroom-first/README.md)
owns qualification, calibration, freeze and the first cell. Closing this
handoff does not claim that a Workroom cell or increment B has completed.

## 2026-09-16 continuation update

The A1/C1 candidate now integrates both cherry-picks on main `e16baf3483`,
with final reviewed/measured code `ba92d4f32`. The
[integration report](../../snapback4/experiments/postgres/W9-INTEGRATION-REPORT.md)
is the current verification and measurement record: the PG suite passes,
the client red is reproduced on clean main, and all C1 performance targets
are missed in an idle PG16 on/off pair. Failed serializable cells are retained.
The fixture-shutdown ticket is closed; the Postgres id-binding ticket remains
open for C3. Charlie admitted application SQL reads (RFC §14.4), without
reordering the first brief cell or authorizing publication.

Remaining after this integration landing: A2, A3 and the fixture pack, then
the brief's freeze/pilot protocol before any control cells. The original
handoff below is retained as the record of what was received; its statements
that A1/C1 are unintegrated are historical, not the current state.

Two implementation lanes for [LLP 3000.009](../../llp/3000.009-general-purpose-backend.rfc.md)
are complete, reviewed, fixed once, committed and pushed. They are not yet on
`main`. This ticket is the whole remaining state, so any session on any
machine can continue.

## What is already on `main`

- LLP 3000.009, rewritten and Accepted in direction, with the author's rulings
  (§14) and the panel disposition (§15).
- The panel's three reviews under `llp/reviews/3000.009-general-purpose-backend.{gpt,grok,muse}.md`.
- `NOT-DOING.md` Moves lines enacting increments A1–A3 and C1.
- The Postgres evaluation prototype and its harness (`snapback4/experiments/postgres/`).
- The online-only brief `benchmarks/briefs/team-workspace.md` ("Workroom").
- Journal entries for the panel, the disposition and the landing.

## What is pushed but not landed

| Branch | Commit | Contents |
| --- | --- | --- |
| `sb4/w9-a1` | `1dd4c9d35` | Increment A1: authority bound at admission, ids bound to operation and argument digest, `why <id>`, `serve --worker`, plus a fixture shutdown fix |
| `sb4/w9-c1` | `92d9cbede` | Increment C1: transaction-scoped prefetch, pipelined commit tail, one portable index-key bound, dual-store suites |

Both were cut from `7ef5d2f03`, which `main` now carries under rewritten
hashes. **Do not merge the branches** — that produces spurious `add/add`
conflicts. Cherry-pick each single commit onto current `main` instead.

## Remaining work, in order

1. **Integrate.** In a clean worktree off `origin/main`:
   `git cherry-pick -x 1dd4c9d35` then `git cherry-pick -x 92d9cbede`.
   When cherry-picking A1 onto `ce6cdcceb`, five files conflicted with wave
   7/8 work: `crates/snapback4-sim/tests/clique.rs`,
   `crates/snapback4/src/serve.rs`, `crates/snapback4/src/verbs.rs`,
   `packages/snapback4/README.md`,
   `packages/snapback4/test/worker.test.mjs`. They are genuine overlaps;
   resolve by keeping both sides' behavior.
2. **Verify the integrated tree.** `bash scripts/test.sh` from `snapback4/`,
   and `bash scripts/test-postgres.sh`.
3. **Re-measure.** `bash scripts/test-postgres.sh --bench` with
   `SNAPBACK4_EVAL_OUTPUT=...`, on an idle machine, comparing prefetch on and
   off. C1's recorded numbers were taken under load and its idle-Linux run was
   different hardware; both are unusable as a before/after. The targets are
   LLP 3000.009 §10.2's C1 row: page and inbox medians within 3× of SQLite's,
   and serialized commits of at least 5,000 per second. Report a missed target
   plainly.
4. **Land** with a journal entry recording the integration, the verification
   and the measurement.
5. **Update the corpus:** LLP 3000.009 §10.2's C1 and A1 rows gain their
   evidence; the journal records what the fix rounds changed.
6. **Tickets:** close
   `issues/20260915-snapback4-navigation-model-fixture-server-econnrefused-under-load.md`
   if the fixture fix holds on a quiet host; keep
   `issues/20260915-snapback4-postgres-replay-skips-the-id-binding.md` open for
   increment C3.
7. **Then continue the program:** increments A2 (declared results and the
   handler context) and A3 (routes and webhooks), per §10.2, and the brief's
   fixture pack before any control cell runs.

## Gotchas this session paid for

- **`expo-build-1000` (the EPYC) is running a Clique benchmark.** Do not put
  load on it: benchmark wall-clock is exactly what contention corrupts. Its
  checkout is also stale and has 44 dirty files belonging to someone else.
- **No fleet Linux host has PostgreSQL.** `450b` (`100.85.211.16`) is idle,
  has rustup with 1.97.0, node 24 and bun, and is the best host for
  `scripts/test.sh`. The Postgres suite and the benchmark need a Mac with
  PostgreSQL 16 (this session used the local one, which is also where the
  original baseline numbers come from).
- **The client-tests step is red on untouched `main`** in this environment,
  with an `ECONNREFUSED` cluster against fixture dev servers; A1's fixture fix
  addresses the three cases the ticket names. Confirm on a quiet host before
  treating any client failure as caused by these lanes.
- Running two Astra lanes plus suites on one Mac drove load above 120 and
  exhausted memory. Serialize heavy verification.
- The GitHub remote now redirects to `expo/snapback`; pushes still work.

## Reviews and evidence

- Panel: `llp/reviews/3000.009-general-purpose-backend.{gpt,grok,muse}.md`.
- Implementation reviews and dispositions:
  `llp/reviews/3000.009-implementation-round-1.claude.md`.
- Lane reports:
  `snapback4/experiments/postgres/C1-REPORT.md` (on `sb4/w9-c1`).

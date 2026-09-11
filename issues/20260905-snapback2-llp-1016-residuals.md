# LLP 1016 implementation residuals — the non-blocking items left by the last blind review rounds

**Status:** open · **Filed:** 2026-09-05 · **Systems:** `snapback2/crates/snapback2-core` (`jobs.rs`, `registry_jobs.rs`), `snapback2/crates/snapback2/src/{control.rs,control_run.rs,verbs_jobs.rs}`, `snapback2/packages/snapback2/guide/{job.md,families.source.json}`, `snapback2/metrics/jobs.jsonl` · **Related:** LLP 1016 §12, `llp/reviews/1016-administrative-plane.*` (the design panel), the implementation reviews under `~/projects/snapback-1016-impl/reviews/` (not committed)

Every landing of the LLP 1016 program (J1a, J1b, J2, J3, their fix rounds, and the closing
round) was reviewed blind by grok-4.6 and Muse Spark; every verdict was LAND or LAND WITH
FIXES with no blocking defect. Fix rounds were capped at three per lane. These are the items
the last rounds left, each small; the next lane that touches the named file takes them.

## From the closing round's reviews (`reviews/closing-muse.md`, `reviews/closing-grok.md`)

- **`reserve_new_ids` precedes the park path.** D3 now says the writer fails the owner only
  when the park itself cannot be written, but `run_chunk_at` propagates a store fault from
  `reserve_new_ids()` before any park is attempted (`registry_jobs.rs:~107`). Either scope the
  D3 sentence ("or before the chunk's store handles exist") or park on that failure too.
- **`wait` on `POST /control/job` is silently dropped** (`control.rs:~834` builds
  `Action::EnqueueJob` without it; `requested_mode` never reads it) while `wait` with a
  rehearsal is refused. Say in `guide/job.md` that `wait` is CLI-side polling only, or honour/
  refuse it on the owner like the other flags.
- **`shape_site` recovers the site by splitting the message** (`jobs.rs:~416`,
  `" is not a chunk"`); a reworded `E_JOB_SHAPE` would install a sentence as the site. Thread
  the site explicitly.
- Minor: `shape_site` visibility (`pub(crate)`); the two relabelled `metrics/jobs.jsonl` lines
  carry a synthetic `at` — prefer the original stamp plus the note; `control_run.rs` lacks an
  `@ref` tag; LLP 1016 §12's closing sentence "Two were defects" should name them.

### Added from grok's closing review

- **The owner compile-timing test does not exercise the CLI's 35 s bound**: it talks through
  `owner_wire::request_bytes`, whose socket read timeout is still 5 s, so a 6 s compile fails the
  harness and a 34 s one is never observed. Give the harness the same `read_timeout(path, body)`
  predicate the CLI uses, or time the compile through the real binary.
- Carried over, out of every brief so far: `E_JOB_GENERATION`'s catalog site is `<job-id>` while
  the refusal sites the job name; `quarry_signature` walks a `BTreeMap` (argument order is
  alphabetical, not declared); `guide.rs` lists `"offline"` twice in `RECIPES`; project `check`
  (not `--ir`) shortens certification rewrites to `{line}\n-- {message}`; zero-declaration
  `--file` is untested; the watcher holds the shared compiler lock across a refusal; four
  pre-existing `E_OP_KIND` sites in `writer*.rs` page `op/kind`/`auth`.

### From the J2 fix round's reviews (`reviews/j2-r2-muse.md`, `reviews/j2-r2-grok.md`)

- **Assert the `parked` coalescing case**: the core test covers `done` and `cancelled` but not
  `parked` (`tests/timers.rs:~840-878`); one more restore-and-fire cycle ending in `_3`.
- **Parameterize the ceiling-rejection test** over `E_FANOUT` and `E_TRACE_SUBSET` (only
  `E_STEPS` is fired; the arm is shared, `engine/timers.rs:~170-175`).
- Minor: `@ref` anchors on the two-site comment, `normalizeSchedule`, and `timers_summary`;
  §7's `E_SCHEDULE_TARGET` row should mention the duplicate-name rewrite; the receipt unit test
  gains a non-object `schedules` case (fails closed by `is_object`).
- From grok's J2 fix-round review: `/api/manifest` still lists schedule targets (`writer_ledger.rs`
  filters only `__owner.*`) although `/api/*` refuses them and `api.d.ts` omits them — filter them
  from the manifest too; `E_OPERATOR_REQUIRED`'s catalog row pages `operator/seat` while the
  schedule-target refusal pages `schedule`; `attach_schedule_receipt` accepts an empty object (add
  the `{ fired, late, rejected }` shape check); the declaration-site hash test is struct-level, not
  two compiled projects; `guide.rs` `RECIPES` still lists `offline` twice.

## Reconciliation — 2026-09-11

**Status:** Open. **Priority:** P2.

The core findings remain directly visible: `run_chunk_at` reserves ids before its
parkable execute; `requested_mode` does not read `wait`; `shape_site` splits refusal
message text; the owner-wire helper still uses a 5 s read timeout; the coalescing test
does not cover parked; the ceiling injection asserts only `E_STEPS`; manifest filtering
excludes only `__owner.*`; and `attach_schedule_receipt` accepts any object.

No broad battery was run for this aggregate hygiene ticket. Next acceptance is one
bounded lane that closes those cases with focused tests, then checks the smaller
catalog/guide/metric carryovers individually. Keep the ticket open until every bullet has
a landed fix or explicit accepted disposition.

## Implementation progress — 2026-09-11

The core residuals are repaired: `E_JOB_SHAPE` carries its site structurally;
direct `/control/job` requests refuse `wait: true` and the guide names `--wait`
as CLI polling; the owner harness observes the same 35-second ad-hoc compile
window as the production client; `parked` joins `done` and `cancelled` in the
restored-occurrence proof; all three ceiling codes traverse the rejection
envelope; schedule receipts require exactly numeric `{ fired, late, rejected }`;
and non-job schedule targets are absent from the public manifest while declared
jobs remain discoverable by the operator CLI. The five inherited `E_OP_KIND`
paths now use the catalogued `quarry` guide, and `E_JOB_GENERATION`'s catalog
site now agrees with the emitted job name.

LLP 1016 scopes pre-chunk store-handle failure honestly and names the closing
round's two defects. The stale `guide.rs` duplicate-`offline` claim is obsolete:
there is no fixed `RECIPES` array in the current guide test. The argument repair
signature remains deterministically alphabetic because the accepted IR stores
arguments in a `BTreeMap`; preserving authored order would require an IR change
with no runtime semantic benefit, so it is explicitly accepted here rather than
smuggled into this cleanup. The append-only metric relabel retains its original
sample payload and carries the historical synthetic timestamp in the note; it
is not rewritten.

Remaining before closure: pin zero-declaration `--file`, the project-check
rewrite, compiler-lock release after refusal, declaration-site hash across two
compiled projects, and the small `@ref`/catalog wording controls.

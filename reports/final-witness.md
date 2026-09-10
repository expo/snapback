# REPORT — lane `witness` (LLP 1021 §3 F3, §4 F4) — 2026-09-10

Worktree `~/projects/snapback-s2-quarry`, branch `s2/ri-witness`, base `4a17b2d224` (origin/main
with lanes traps, vis, and cost). Nothing committed, stashed, or branched; the orchestrator commits.
Five new files need `git add`: `snapback2/crates/snapback2-effects/src/{ibex_bound_tests.rs,prelude/bound.js}`,
`snapback2/crates/snapback2/src/{test_effects.rs,writer_bindings.rs}`,
`snapback2/crates/snapback2/tests/effects_cases/witness.rs`.

## What changed (files)

Effects crate — `snapback2/crates/snapback2-effects/src/`:

- `host.rs` — `EffectJob.bindings: Option<BTreeMap<String, String>>` (`Some` only in a test owner:
  the journey epoch's table, logical origin → loopback origin; `None` = production transport).
- `ibex.rs` — `EffectRuntime.bindings`; the retain check also compares bindings (a runtime built for
  one table never serves a job with another); `build_runtime(decl, bindings)` installs Ibex's raw
  fetch with `transport_origins` (production: the declared grants; bound: **only the bound loopback
  origins**, so no socket can leave the loopback whatever the effect asks) and, in bound mode, evals
  `prelude/bound.js` between `install_fetch` and the prelude that captures the raw binding.
- `prelude/bound.js` (new) — the bound-only transport in front of `__ibex2_fetch`, per request and
  per redirect hop: (1) the grant on the logical origin, refused with the engine's own
  `denied: net.fetch` so the prelude tags `E_EFFECT_GRANT` exactly as in production; (2) the
  binding — an unbound origin rejects `E_EFFECT_UNBOUND: … declare effects.provider('<origin>',
  handler) in the journey that emits <effect>`; (3) substitution of the loopback origin (path and
  query kept). Origins compare as `new URL(x).origin` — lowercase scheme/host, default port elided —
  the same equivalence Ibex's `Grant::Fetch(Origin)` uses.
- `prelude.js` — `tagRawGrantError` tags an `E_EFFECT_UNBOUND: ` raw rejection into `deniedErrors`
  (terminal, `retry: false`), code and origin on the error; application code cannot reach this path
  (only a raw rejection does). The deadline branch's prelude hunks (lines 15–27, 38, 279, 325–352,
  378, 405–414) are untouched; this edit is at `tagRawGrantError` (~line 100).
- `ibex_tests.rs` — `job()` gains `bindings: None`; `build_runtime(&decl, None)` in
  `effect_global_surface_is_exact_allowlist`. `runner.rs` — the test `push` gains `bindings: None`.
- `ibex_bound_tests.rs` (new, Hermes-gated, 6 tests).

Owner — `snapback2/crates/snapback2/src/`:

- `writer_bindings.rs` (new) — `Bindings { epoch: Option<Epoch { id, since, origins }> }` on the
  writer `State` (`effect_bindings: Option<Bindings>`, `Some` only for `--test-owner`);
  `effects_epoch(Some(id) | None)` opens (recording `since` = commit seq) or closes (revokes) the
  live epoch; `bind_effect(origin, to, epoch)` refuses a stale epoch, a non-http(s) origin, or a
  non-loopback `to`; `claim_bindings(seq)` → `None` in dev (production transport), the live epoch's
  table when `seq > since`, else `{}`; `logical_origin` / `loopback_origin` validation; 3 tests.
- `writer.rs` — the `effect_bindings` field (three test constructors get `None`), actions
  `EffectsEpoch { epoch }` and `EffectsBind { origin, to, epoch }`, `OutboxClaim` attaches
  `bindings` beside the claimed row, `spawn_writer(.., bound_effects)`.
- `control.rs` — `POST /control/effects/epoch { epoch | null }`, `POST /control/effects/bind
  { origin, to, epoch }` (dev-only through `outbox_dev`; a dev owner answers `E_INPUT` "provider
  bindings belong to a snapback2 test journey epoch; this owner serves dev" with the rewrite);
  **`settling_work` rewritten as one ordered scan over every state** (see "A bug found on the way").
- `effects.rs` — `WriterAccess::claim_next` lifts `bindings` off the claim reply into `EffectJob`.
- `verbs.rs`, `owner.rs` — `dev --test-owner` (`DevOptions.test_owner`), passed to `spawn_writer`.
- `test.rs` — the isolated owner is spawned `--test-owner`; every journey runs inside its own epoch
  (`open_epoch` before the runner, `--epoch <token>` to it, `close_epoch` after
  `supervise_journey_runner` returns, whatever it returned); `run_journeys` returns the journey
  windows; `check_effects` moved to `test_effects.rs` and runs **after** the journeys.
- `test_effects.rs` (new) — `JourneyWindow`, `open_epoch`/`close_epoch`, `check_effects`
  (witness aggregation over `GET /control/outbox` pages: one successful witness per declared effect
  inside a journey's `(since, until]` window — `sent`, and `then` committed when declared;
  `{ journey, id, seq, attempts, state, ms, then }`, `ms` from the row's `running → then_pending|sent`
  transition line; `then: { declared: false }` for an effect without one; `refused` per effect as
  negative evidence; `blocked: effects:no-witness` with `missing: [{ effect, needs }]`; without an
  engine `blocked: no engine in this build` with `detail.build`), 2 unit tests.
- `writer_effects.rs` — one regression test (`settlement_waits_for_a_running_row_to_the_budget`).

Package — `snapback2/packages/snapback2/`:

- `src/test.ts` — `effects.provider(origin, handler)`: a `node:http` loopback server in the journey
  process; each request becomes a web `Request` on the **logical** origin, the handler's `Response`
  is written back (handler throws → 500); `provider.requests` records `{ method, path, headers,
  body }` up to 200 entries and 16 KiB per body (`bodyCapped { bytes, limit }`, `dropped`, and
  `caps` report the cut); the binding is registered with `POST /control/effects/bind` using the
  runner's `--epoch`; every provider is closed in the journey's `finally`.
- `types/test.d.ts` — `ProviderRequest`, `JourneyProvider`, `JourneyEffects.provider`.
- `templates/chat/snapback/tests/chat.test.ts` — the journey `a sent message notifies the
  recipient` (RFC §2's shape: bind, send, settle, assert `sent` + `then` committed, one provider
  call carrying `meta.id` as its idempotency key).
- `guide/families.source.json` — `E_EFFECT_UNBOUND` (family `effect`, site "the effect's fetch, in
  the owner snapback2 test runs", wrong/right journey examples, page `effects`); the rewrite is in
  the message itself.
- `guide/effects.md` (4,842 bytes), `guide/testing.md` (5,426 bytes) — the §3/§4 sentences.
- `tests/effects-visibility.test.ts` — two new tests on the shared scaffold.
- `scripts/consumer-smoke.mjs` — `receiptVerdict` accepts exactly the engine-absence blocks;
  `scripts/measure.mjs` — self-test cases for it.

LLPs: `llp/1002-dev-loop.spec.md` §7 item 6 (witness rule) and the acceptance sentence;
`llp/1021-effects-in-the-loop.rfc.md` implementation-record line. Status untouched.

Tests: `snapback2/crates/snapback2/tests/effects.rs` (module hook, `then` receipt assertions on the
restart-requeue path), `tests/effects_cases/witness.rs` (new, Hermes-gated, 4 tests),
`tests/test_verb.rs` (17 journeys; the provider journey's verdict in both builds; `detail.build`).

## Before / after

Before (base `4a17b2d224`): `check_effects` returned `pass` on the engine's name alone
(`{ engine, declarations }`, `test.rs:693-721`); no journey could bind a provider (`effects` had
`rows`/`settle` only); with an engine every effect fetch went to the declared origin through Ibex's
raw binding; `receiptVerdict` admitted only the single `effects` block.

After, engine-less (`target/debug/snapback2 test --json` on a scaffolded chat, 14 s):

```
verdict blocked
derived  pass     certify … grant-incarnation-aba (8 derived checks)
journey  pass     × 16 (the template's journeys, unchanged)
journey  blocked  a sent message notifies the recipient   {"reason":"effects:no-engine","journey":{"error":"unsettled: [{\"id\":…,\"reason\":\"engine:none\"},…]","file":…}}
derived  blocked  effects                                 {"build":"scripts/hermes build -p snapback2","declarations":["delivery.notify"],"reason":"no engine in this build"}
```

A dev owner: `POST /control/effects/epoch` and `/bind` →
`{"code":"E_INPUT","message":"provider bindings belong to a snapback2 test journey epoch; this owner serves dev","rewrite":"declare effects.provider(origin, handler) in a journey and run snapback2 test"}`.
`snapback2 guide E_EFFECT_UNBOUND` renders the card.

After, Hermes (`scripts/hermes test -p snapback2 --test effects`, scaffolded chat, the real `test`):
`effects: pass`, `detail.witnesses["delivery.notify"] = { journey: "a sent message notifies the
recipient", state: "sent", attempts: 1, then: { op: "notifications.recordNotified", state:
"committed", seq: <emit seq + 1> }, ms: <number> }`; `refused["delivery.notify"]` lists the
template's other message-sending journeys with `E_EFFECT_UNBOUND` (they bind nothing) — negative
evidence, never a witness; the whole receipt is `pass`.

The consumer-smoke rung (`packDevelopmentConsumer` with the debug binary — the path
`measure --check` scores): status 0; `chat receipt: { accepted: true, verdict: "blocked",
blocked: "a sent message notifies the recipient, effects" }`; `todos receipt: pass`.

## Tests and results (verbatim)

Engine-less:

- `cargo nextest run -p snapback2-effects` (workspace profile): `23 tests run: 23 passed, 0 skipped`.
- Affected integration tests, first pass (`-E 'binary(test_verb) | test(/owner_cases::effects|owner_cases::outbox|owner_cases::timers::effects_settle|effects::tests|writer_effects|writer_bindings|test_effects|control::tests|receipt::tests|test::unit_tests|test::derived_tests/)'`):
  `86 tests run: 85 passed, 1 failed` — the red was
  `test_verb::chat_template_receipt_tracks_the_effect_engine_and_lists_all_journeys` asserting 16
  journeys (the template now has 17); after the expectation update: `2 tests run: 2 passed`
  (`chat_template_receipt_tracks_the_effect_engine_and_lists_all_journeys`,
  `todos_template_passes_without_an_effects_check`).
- Settle-related rerun after the `settling_work` rewrite
  (`-E 'test(/settle|remaining_reason|effect_filter|owner_cases::effects|owner_cases::outbox|owner_cases::timers|writer_effects|writer_bindings|test_effects|control::tests|effects::tests/)'`):
  `Summary [ 13.224s] 40 tests run: 40 passed, 370 skipped` — includes the three
  `writer_bindings` tests, the two `test_effects` tests, `settlement_waits_for_a_running_row_to_the_budget`,
  and every vis-lane settle test.
- `node --test --test-timeout=10000 tests/effects-visibility.test.ts`: `ℹ tests 4 / ℹ pass 4 / ℹ fail 0`
  (new: `a dev owner refuses provider bindings, and E_EFFECT_UNBOUND is a registered effect-family
  card` 0.8 s; `the engine-less receipt blocks exactly on engine absence: the effects check names
  the build and the provider journey is blocked, not failed` 18.2 s).
- `node scripts/measure.mjs --self-test`: `measure self-test ok` (three new `receiptVerdict` cases).
- Compiler: `bun run check` exit 0; `bun src/test.ts` alone: `Compiler checks: 287 passed, 0 failed`
  (includes "diagnostic family examples use current surfaces and every guide resolves"). A run
  concurrent with the Rust integration tests showed 2 reds — `proc: an emit inside an imported proc…`
  ("checker declarations are missing beside the compiler bundle") and `a killed package builder
  leaves a lock…` (`ENOENT target/b2-package-build.lock`) — both the package build lock shared with
  the concurrent test harness; green alone.
- `(cd packages/snapback2 && node build.mjs)`: `guide: 31 cards, 80315/98304 bytes (18% headroom)`, exit 0.
- `./ref-check --verbose`: `ok — 433 LLP docs, 8540 refs in 22340 files, 0 errors, 0 unchecked`.
- `node scripts/caps.mjs`: 2 violations, the same two inherited Snapback 1 files every lane reports
  (`206 of 204 allowed`); largest lane files: `test.rs` 1,456, `writer.rs` 1,340.
- `cargo fmt --check`: every file this lane touched is clean except the pre-existing regions other
  lanes left (`writer.rs:622/633`, `writer_effects.rs:535/549`, `tests/common/mod.rs:271`, …);
  rustfmt's collateral reformat of `test_authority_ir.rs` and `tests/common/mod.rs` was reverted.

Hermes (`scripts/hermes …`; the owner suite needs `snapback2-media` in `target/hermes`:
`scripts/hermes build -p snapback2 -p snapback2-media`):

- `scripts/hermes test -p snapback2-effects` (complete crate): `test result: ok. 60 passed; 0 failed; 0 ignored`
  (54 pre-existing + `bound_tests::{bound_transport_substitutes_the_loopback_after_admitting_the_logical_origin, unbound_granted_origin_is_terminal_and_reaches_no_transport, the_grant_is_checked_on_the_logical_origin_before_any_binding, redirect_hops_are_admitted_on_the_logical_origin_and_rerouted, a_job_with_other_bindings_gets_its_own_runtime_and_equal_bindings_reuse_it, a_retry_after_a_provider_error_completes_on_the_reused_runtime}` — the bound tests keep a real listener at the logical origin and assert it receives nothing).
- `scripts/hermes test -p snapback2 --test effects` (six tests: the two pre-existing owner journeys
  and `witness::{chat_template_test_reports_one_witness_per_effect_with_its_then_committed,
  lifecycle_journeys_isolate_bindings_retry_after_backoff_replay_offline_and_refuse,
  a_schedule_with_every_client_disconnected_is_witnessed_and_a_missing_witness_blocks,
  a_then_changed_while_the_provider_held_the_request_fails_e_effect_then_changed}`):
  run 4 (all six in parallel, before the offline-journey drain fix): `5 passed; 1 failed` — the red
  was the lifecycle test's offline journey ("offline send was rejected": my journey went offline
  before draining the inbox the twin predicts from; fixed by draining first, as the template's own
  offline journeys do). Lifecycle test alone after the fix: `1 passed; finished in 22.05s`.
  **Final complete run: `test result: ok. 6 passed; 0 failed; 0 ignored; finished in 56.52s`.**
  `dev_stop_observes_owner_process_exit_while_a_well_behaved_effect_runs` (lane traps') hit the
  CLI's fixed 2-second `E_OWNER_STOP_TIMEOUT` in two earlier runs while four full `snapback2 test`
  runs shared the box, and passed alone (`1 passed; finished in 4.89s`) and in run 4 — a load
  artifact of this lane's heavy neighbours, not a change in its code.

What the Hermes owner tests prove, per brief item: the chat `notify` witness (`effects: pass`, `then`
committed with a seq — acceptance 2); isolation (a journey whose provider holds a request and then
blocks its event loop with `Atomics.wait` past the host deadline is SIGKILLed with its provider —
process death; a second journey binds the same origin; the first row's retry fails
`E_EFFECT_UNBOUND` on attempt 2, the second journey's provider receives exactly its own request —
acceptance 4; "no socket leaves the loopback" is asserted by the crate tests' reachable logical
origin receiving nothing); an ungranted redirect (`E_EFFECT_GRANT` naming the hop's origin, the
provider sees only the first hop); an unbound granted origin (`E_EFFECT_UNBOUND`, attempt 1, the
message carries the rewrite); a provider 503 with `tick` past `nextAt` (attempt 2, `then` committed,
two provider calls); the restart between provider completion and `then` (`sent_unknown → requeue →
one committed then` with its `seq` on `/control/outbox`); `E_EFFECT_THEN_CHANGED` (the provider
holds, the watcher applies a successor whose `then` moved, release → `then_pending → failed`, history
`queued, running, then_pending, failed`); an offline-queued send replayed after a lost 503 (one
emission, one provider request); a schedule advanced with no client connected (digest rows `sent`,
one provider request per row, witness `then: { declared: false }`, `delivery.notify`/`push.notify`
`missing` with their `needs`, and the selected run recording `scope.journey` with no effects check).

## A bug found on the way (vis lane's `settle`, fixed here)

`control.rs::settling_work` read `then_pending`, then `running`, then `queued` as three separate
writer calls. With an engine, a row the runner claims **between** the `running` read and the
`queued` read is seen by neither, the loop returns "no work", and `settle` reports the row
`running` after ~8 ms of a 3,000 ms budget. Reproduced twice in the 503 journey (`second` returned
`remaining: [{ running }]`; a third `settle` 6 ms later found the row `sent`) and pinned with a
temporary file trace (removed); it needs a concurrent runner, so the engine-less suite never saw it.
Fixed as one ordered scan over every state (a page per writer call, each row seen once in a
consistent state; the early return at the first in-flight or due row is kept).
`settlement_waits_for_a_running_row_to_the_budget` pins the `running` wait at the writer level; the
lifecycle Hermes test is the race's witness (it failed on exactly this twice before the rewrite).

## RFC audit — §3 and §4 item by item

§3: `effects.provider(origin, handler)` starts a loopback server owned by the journey process and
registers `{ origin, to, epoch }` — present. Lifetime: bindings belong to one journey epoch; the
supervisor opens it before the runner and closes it after `supervise_journey_runner` returns —
completion, failure, timeout (the runner's 5 s), or death (SIGKILL of the process group) — never
depending on journey cleanup — present. No fallback anywhere in the test owner: every claim in a
`--test-owner` carries a table (empty for rows at or before the epoch's `since`: derived-check rows,
earlier journeys' leftovers, retries of either); an unmatched fetch is terminal `E_EFFECT_UNBOUND`
(family `effect`, site the fetch, rewrite in the message and the card, page `effects`) and reaches
no transport (Ibex's raw grants are the bound loopback origins only) — present. Grants first: the
logical origin is admitted on every request and every redirect hop before substitution;
credential-stripping keys on logical origins (unchanged in `fetch.js`); `E_EFFECT_GRANT` text and
policy are production's — present. Capture with a reported cap — present. Journeys only: a dev
owner refuses both routes — present.

§4: witnesses, not probes; one successful witness per declared effect (emission → executed against
a journey provider → `then` committed, `then: { declared: false }` recorded explicitly); the receipt
lists `{ journey, id, seq, attempts, state, ms, then }` per effect; expected refusals are `refused`
and never substitute; `blocked: effects:no-witness` names the effect and the journey it needs
(`needs`: the mutation/job/schedule, `effects.provider("<grant origin>", handler)`, `effects.settle`,
and the `then` to let commit); a selected run records `scope.journey` and skips the check (it claims
no coverage); without an engine `blocked: no engine in this build` with `detail.build`;
`receiptVerdict` accepts exactly the engine-absence blocks; publication (`consumerSmoke` with
`allowNoEngine = false`) requires every check to pass — all present.

## Deviations, and facts the RFC should state

1. **Epochs are keyed by the owner's commit seq, not stamped on rows.** "A row from an earlier epoch
   cannot acquire a later journey's binding" is implemented as: a row claims the live epoch's table
   only if `row.seq > epoch.since`; `_outbox` gains no column (`store.rs` is at the 1,500-line cap).
   The epoch opens before the journey body runs, so a journey may bind after emitting; only rows
   from before the journey started are unbound in it.
2. **The logical grant check in the test owner is the bound transport's, not Ibex's.** Ibex's raw
   binding cannot admit one origin and connect to another, so in bound mode the raw grants are the
   loopback origins and `bound.js` performs the logical check with the same origin equivalence and
   the same denial text; `E_EFFECT_GRANT` is identical from the effect's point of view (message,
   code, origin asserted by the crate tests). The RFC's "the existing grant check (`ibex.rs:308`,
   `fetch.js:134,155`) admits the logical origin" should say the check moves in front of the raw
   binding for a test owner.
3. **`response.url` is the loopback URL** while the provider's `request.url` is on the logical
   origin. The effect's code runs unchanged (the template never reads `response.url`).
4. **`sent_unknown → requeue` is the row still `running` at death.** A row `then_pending` at the
   restart is drained by `initialize` without a requeue (LLP 1003 §2); acceptance 3's "between
   provider completion and `then`" is the `running` case, proven by the existing journey extended
   with the `then` receipt (a dev owner: in a test owner the requeued row precedes any later epoch
   and is rightly unbound).
5. **`status.generation` does not move for a `then` change.** The successor a changed `then` makes
   logs `successor: applied` with `from == to`; the effects hash the runner binds
   (`effects_json:<hash>`) does move, and the core's `bound_then_target` uses it. Not this lane's to
   change; the `then`-changed test waits on the applied line. Worth a ticket if the generation
   identity is meant to cover effect bindings.
6. **Route refusals are `E_INPUT`** (the family every control route uses for a bad request); no new
   diagnostic for "not a test owner" or "stale epoch" — message and rewrite carry the rule.
   `E_OWNER_TEST_EPOCH`/`E_OWNER_TEST_OUTBOX` (supervisor-side transport failures) follow the
   existing unregistered `E_OWNER_TEST_*` owner-family codes.
7. **`detail.build`** is `scripts/hermes build -p snapback2` for a checkout; for a binary under
   `node_modules` it names the binary and says it should carry the engine (the published binary
   does; there is no build command to hand a package user).
8. **`then_pending` on a witness**: only `sent` rows are witnesses; a row still `then_pending` when
   the check runs is neither witness nor refusal.
9. Guide pages are over the brief's 4,096-byte figure (4,842 / 5,426) and under the 8,192 the base
   enforces (vis's deviation 6 records the same).
10. The provider journey sits last in the chat template's test file: its `then` writes a
    `notifications` row, and the first journey asserts the shared inbox is unchanged.
11. **`settling_work` rewritten** (vis lane's function; `control.rs` is in this lane's named areas).
12. Scope beyond the brief's named files, all in service of the named items: `verbs.rs`/`owner.rs`
    (the `--test-owner` flag), `writer_assets.rs`/`writer_auth.rs`/`writer_live_tests.rs` (the new
    `State` field), `runner.rs`/`ibex_tests.rs` (`bindings: None`), `tests/test_verb.rs` (journey
    count, the provider journey's verdict), `llp/1002` (the brief names it).

## Merge notes for the deadline lane (`s2/ri-deadline`)

Both branches edit `ibex.rs`. This lane's hunks: `BOUND_TRANSPORT` const (after `FETCH_FACTORY`),
`EffectRuntime.bindings`, the retain check and `build_runtime(decl, job.bindings.as_ref())` in
`run_inner`, the `build_runtime` signature, the grant block (`transport_origins` + the bound
transport eval, formatted `{error:?}` so it compiles against both `JsError` shapes), the
`EffectRuntime { bindings, .. }` construction, `transport_origins`/`bound_transport`, and
`mod bound_tests`. Expected conflicts, each mechanical: the `build_runtime` call in `run_inner`
(`build_runtime(decl, job.bindings.as_ref(), deadline)`), its signature (both parameters), the
`mod` list at the end (union), and `effect_global_surface_is_exact_allowlist`'s call
(`build_runtime(&decl, None, deadline)`). The deadline branch's `ibex_deadline_tests.rs` builds
`EffectJob` at two sites (its `job()` helper and one inline) — each needs `bindings: None`.
`fetch.js` is untouched here; `prelude.js` edits are in different hunks.

## Open questions

- Should the generation hash cover effect bindings (deviation 5)? A `then` change today is a
  successor whose `from == to`.
- `provider.requests[].body` is UTF-8 text; a binary provider body would need bytes. No template
  needs it.
- `receiptVerdict`'s `blocked` field now lists every blocked name (`"effects"` alone when only the
  check is blocked, as before); `measure.mjs`'s self-test pins both forms.


## Fix round r1

Base: `c0b243cdcc7a796251d0f3a75970012c15d5b4e0` (merged lane). HEAD and branch unchanged. No commit, stash, or branch operation. Read both r1 reviews, the lane brief/report, program plan, fence, and LLP 1021 §3–§4 plus LLP 1003.

This section supersedes the initial report's witness, epoch lifetime, URL, capture, and timing claims. The earlier claim of a crash **after provider completion** was incorrect: the existing test kills before releasing the first response.

### Item disposition and tests

1. **FIXED — provider contact.** The bound transport counts substituted requests per attempt and hop and keeps caught grant/unbound refusal counts. The prelude reports framework-owned evidence; the host/runner pass it separately from the authored return value; the writer adds `provider: { origins, requests, refused }` to settlement transitions (including `then_pending → sent/failed`). Production jobs carry none. Granted effects need a `sent` row with at least one substituted request and any declared `then` committed. Grant-less effects record `provider: { declared: false }`. Tests: `granted_effect_returning_without_fetching_is_not_a_witness`, `caught_unbound_refusal_returning_success_is_not_a_witness`, `grantless_effect_witness_explicitly_declares_no_provider`, `chat_template_test_reports_one_witness_per_effect_with_its_then_committed`; all pass. Existing engine retry/reuse test now asserts attempt-local counts; production test asserts absence of provider evidence.
2. **FIXED — epoch close.** Revocation and the claimed-id/attempt set are captured on the writer; the HTTP worker waits off it. Close lists any rows still running/then_pending at budget + 1 s; the supervisor fails with their identities. Opening another epoch is refused until they settle. Normal journey completion retains the stand-ins until the supervisor acknowledges the drained close over stdin; timeout/death/spawn failure still closes through the supervisor. Later claims have no bindings. Durable settlement removes the active epoch claim, so a later explicit requeue resetting the attempt number cannot extend the old close. No live per-hop epoch check. Tests: `epoch_close_waits_for_its_claim_and_post_close_emissions_are_unbound`, `supervisor_close_keeps_a_completed_journeys_provider_alive_until_settlement`, `epoch_close_reports_a_claim_still_running_at_its_bound`, `an_unbound_requeue_does_not_extend_the_closed_epochs_claim`, `epoch_close_with_a_running_row_fails_with_the_row_identity`, existing killed-journey lifecycle test; all pass. `read_timeouts_follow_the_owners_mode_predicate` pins the control client's budget + 2 s receive allowance.
3. **FIXED — logical URLs.** Bound responses expose the logical URL after redirects; manual redirects snapshot a mutable URL argument before I/O. Provider Requests/capture carry the logical `Host`. This is an HTTP/1 stand-in; Web Headers has no `:authority` surface. Tests: `response_url_stays_logical_after_redirect_and_relative_followup` (follow, manual, mutable input, four counted hops) and `owner_journeys_admit_relative_and_host_derived_redirects_on_the_logical_origin`; both pass. Existing grant/redirect/credential tests remain green.
4. **FIXED — capture bytes.** Captured body text is normalized to UTF-8 and cut before a partial scalar. `bodyBytes` reports original request bytes; `bodyCapped: { bytes, limit }` reports truncation. Tests: `provider capture bounds UTF-8 bytes at scalar boundaries and reports dropped requests` covers 16,384 copies of 界, an exact 16,384-byte body, a body one byte over, logical Host, and 201 requests; passes.
5. **FIXED — derived-only scope.** `--derived-only` omits the effects witness check and records `scope.derivedOnly: true`, including failure receipts. Guide testing and LLP 1002 §7 updated. Test: `derived-only states its scope and skips the effects witness check`; passes.
6. **FIXED — test-owner admission.** `--test-owner` without `--owner-child` returns sited `E_INPUT` naming `snapback2 test`. Tests: `test_owner_is_only_accepted_for_the_supervisor_child`, `manual dev cannot opt into test-owner bindings`; pass.
7. **FIXED — bookkeeping.** History matches id and current attempt, beginning at that attempt's last claim (requeue may reset the number). Timing cannot leak across rows in one commit or a previous authorized run. Missing timing is explicitly `ms: null, timing: "unavailable"`. Negative evidence is `refused[effect]: { rows, dropped }`, cap 20. Failed/malformed control responses fail the check instead of inferring engine absence. Tests: `effects_emitted_in_one_commit_keep_their_own_provider_timing` (one commit, delayed and fast effects), `timing_and_provider_contact_match_the_outbox_id_and_latest_attempt`, `refused_evidence_reports_every_row_dropped_past_twenty` (27 rows → 20 retained/7 dropped), `a_failing_control_client_fails_instead_of_claiming_engine_absence`; pass.
8. **FIXED — diagnostics.** Removed both new supervisor codes, folding them into existing `E_OWNER_TEST_IO`; new control failures carry the route site, owner family, executable `snapback2 test` rewrite and testing page. Added the code's family card. Tests: failing-control unit asserts the emitted code/site; package `a dev owner refuses provider bindings, and E_EFFECT_UNBOUND is a registered effect-family card` additionally resolves `E_OWNER_TEST_IO` and its owner card; pass.
9. **FIXED — test-owner restart proof.** Test `a_test_owner_restart_requeues_without_an_epoch_and_never_hits_the_provider_twice` boots `--owner-child --test-owner`, emits and kills during running, restarts the same store, observes `sent_unknown`, opens a later binding, explicitly requeues the same id, and observes terminal `E_EFFECT_UNBOUND` with provider hit count still one; passes. Recovery does not auto-requeue: it preserves LLP 1003's existing operator action.
10. **REFUSED AS DIRECTED — missing deterministic seam.** No existing owner seam distinguishes effect/provider completion from the subsequent durable settlement. A provider write alone is too early; observing `then_pending` is too late. Filed `issues/20260910-snapback2-crash-after-provider-before-settlement-witness-seam.md`; added no apparatus or sleep/race test. Existing restart test proves the pre-response boundary only. Also added the review's requested real-provider rejecting-then proof: `a_bound_provider_with_a_rejecting_then_is_negative_witness_evidence` passes (provider contacted, then rejected, effects:no-witness).
11. **FIXED — comments and RFC facts.** Retry comment no longer claims a runtime rebuild. RFC §3 now states separate logical admission in front of Ibex, seq-keyed epochs, bind before emit, bounded closing, and logical response/Request URLs. Removed the obsolete loopback-response deviation from its implementation record. Guide effects/testing updated in the same change.
12. **FIXED — records.** This fix-round section and the one-line LLP 1021 implementation record are appended. RFC Status unchanged.

### Verification (verbatim counts)

- `scripts/hermes test -p snapback2-effects`: `test result: ok. 73 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.77s` (doc-tests: 0/0).
- `scripts/hermes test -p snapback2 --test effects -- --test-threads=2`: `test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 122.97s`.
- After the final epoch-claim cleanup change, targeted owner epoch/restart rerun: `test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 14 filtered out; finished in 4.85s`; supervisor-close rerun: `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 15 filtered out; finished in 14.18s`.
- Affected unit selection via local-proof nextest (`test_effects`, `writer_bindings`, `verbs`, supervisor unit tests, writer effects, effects seam, client): `Summary [   3.291s] 37 tests run: 37 passed, 177 skipped`.
- Named `test_effects` run: `7 passed; 0 failed; 0 ignored; 0 measured; 206 filtered out`.
- Named `writer_bindings` run: `5 passed; 0 failed; 0 ignored; 0 measured; 209 filtered out`.
- Named verbs admission test: `1 passed; 0 failed; 0 ignored; 0 measured; 212 filtered out`.
- Close-timeout assertion follow-up: `1 passed; 0 failed; 0 ignored; 0 measured; 212 filtered out`.
- `node --test tests/effects-visibility.test.ts`: `ℹ tests 7`, `ℹ pass 7`, `ℹ fail 0`, `ℹ cancelled 0`, `ℹ duration_ms 42433.423709`. Diagnostic-card assertion follow-up: `ℹ tests 1`, `ℹ pass 1`, `ℹ fail 0`.
- `node build.mjs`: exit 0; `guide: 31 cards, 83630/98304 bytes (14% headroom)`. Testing 6,626 bytes; effects 5,435 bytes; each below the merged tree's existing 8,192-byte limit. No budget raised.
- `cargo build -p snapback2 -p snapback2-media` and `scripts/hermes build -p snapback2 -p snapback2-media`: exit 0.
- `ref-check`: `ok — 439 LLP docs, 8595 refs in 22363 files, 0 errors, 0 unchecked`.
- `caps`: only the two inherited Snapback 1 violations (206 oversize vs baseline 204): `crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` 1,504 and `packages/snapback-contract/agent-authority-contract.test.mjs` 1,508. No changed file exceeds 1,500; `test.rs` reduced from 1,473 to 1,358 by moving process supervision into `test_journey_runner.rs`.
- `git diff --check`: pass.
- **Not run:** `scripts/test.sh` / the whole suite, per the fix-round override; the orchestrator owns remote full verification. No owner-stop sandbox artifacts in the passing final owner run.

Intermediate failures were fixed: first owner run 8 passed/6 failed due to an unsupported `Headers.has(":authority")` call; removed it from this HTTP/1 carrier. One control-response unit initially closed its socket before consuming the request body; the fixture now consumes it. The first package baseline attempt timed out in init before reaching any assertions; the final package run passed.

### Before / after evidence

B1, new tests against the base implementation, `/tmp/witness-b1-before.log`:

```
no fetch: effects verdict "pass", then committed, ms 5 → expected "blocked"
caught unbound: effects verdict "pass", then committed, ms 6 → expected "blocked"
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 7 filtered out
```

After: both complete owner test runs observe a sent/committed row but `effects:no-witness`, `provider.requests: 0`; the caught refusal retains `provider.refused.E_EFFECT_UNBOUND: 1`. The positive chat receipt records `provider.origins: ["https://api.example.com"], requests: 1` and its committed then.

B2, preserved base binary `/tmp/witness-base-snapback2`, `/tmp/witness-epoch-scope-before.log` (temporary owner only):

```
{"close":{"epoch":"old","until":2},"ms":1,"providerStillHeld":true,"running":1,"nextEpochOpened":{"epoch":"next","since":2}}
```

After: `epoch_close_waits_for_its_claim_and_post_close_emissions_are_unbound` proves no close reply during a 150 ms held-response interval, refuses an early next epoch, then returns `running: []` after release/settlement. The old provider gets exactly one hit, the next provider exactly its own hit, and the post-close emission fails E_EFFECT_UNBOUND. The full supervisor journey separately proves normal cleanup keeps the old provider alive until settlement.

B3, new Hermes regression with the base `fetch.js`, `/tmp/witness-url-before.log`:

```
Failed { error: "Error: denied: net.fetch http://127.0.0.1:59863; declare http://127.0.0.1:59863 ...", retry: false }
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 72 filtered out
```

After: logical `/next` and `/last` response URLs, plus a manual response retaining the original request URL even after its input object is mutated; four substituted requests. Owner relative and Host-built absolute redirects both pass.

B4/Host, executing the base provider function, `/tmp/witness-capture-before.log`:

```
{"retainedBytes":49152,"cap":16384,"bodyBytes":null,"host":"127.0.0.1:60781","url":"https://api.example.com/capture"}
```

After, same real-server probe, `/tmp/witness-capture-after.log`:

```
{"retainedBytes":16383,"cap":16384,"bodyBytes":49152,"bodyCapped":{"bytes":49152,"limit":16384},"host":"api.example.com","url":"https://api.example.com/capture"}
{"retainedBytes":16384,"cap":16384,"bodyBytes":16384,"bodyCapped":null,"host":"api.example.com","url":"https://api.example.com/capture"}
```

B5/B6, preserved base binary:

```
--derived-only: scope {"changed":[]}; effects blocked, reason effects:no-witness, journeys []
manual --test-owner --status: exit 0, no refusal code, status accepted
```

After: selected package tests assert `scope: { changed: [], derivedOnly: true }`, no effects/journey check, pass; manual test-owner returns E_INPUT naming snapback2 test.

B7/B8 before code facts: timing selected the first successful line for the entire seq; REFUSED_CAP silently discarded after twenty; status failures became `{}` then engine "none"; both new E_OWNER_TEST_* codes had no sites/cards. After assertions pin separate 900/7 ms values for rows in the same seq, no reuse after a new claim, 20 retained/7 dropped refusals, a fail verdict with a sited E_OWNER_TEST_IO on HTTP 500, and a resolving family card. The served two-effect test additionally verifies distinct timings in one actual committed emission pair.

### Files and scope

Effects crate: `host.rs`, `ibex.rs`, `prelude.js`, `prelude/{bound,fetch}.js`, `runner.rs`, `ibex_bound_tests.rs` — contact evidence and logical response URLs.

Owner: `client.rs`, `control.rs`, `effects.rs`, `receipt.rs`, `test.rs`, `test_effects.rs`, new `test_journey_runner.rs`, `verbs.rs`, `writer.rs`, `writer_bindings.rs`, `writer_effects.rs`, `writer_effects_tests.rs` — drain/lifetime handshake, claim tracking, transition evidence, scoped receipt and diagnostics. `writer_effects_tests::effects_state` is now visible only to sibling writer test modules to reuse its actual runtime fixture.

Tests: `tests/effects.rs`, `tests/effects_cases/witness.rs`, new `tests/effects_cases/epoch.rs`; package `tests/effects-visibility.test.ts`.

Package: `src/test.ts`, `types/test.d.ts`, `guide/{effects,testing}.md`, `guide/families.source.json`. No client/twin runtime edit and no budget/config/registry/script added.

Corpus/report: LLPs 1002/1021, the explicitly requested item-10 issue, root `REPORT-witness.md`, and worktree `reports/final-witness.md`.

Areas beyond the original lane's literal named files: `client.rs` for the bounded close receive timeout; `host.rs`/`runner.rs` for passing trusted evidence; `writer.rs`/`writer_bindings.rs` for epoch state; `verbs.rs` for flag admission; reused/new test modules and the item-10 ticket. All support the fix-round's explicit items. Rustfmt also normalized existing blocks within touched Rust files; no unrelated file was formatted.

The shared program's report at `/Users/ccheever/projects/snapback-ri-20260910/reports/final-witness.md` is outside this session's writable roots. Its original content was read and copied into this worktree's `reports/final-witness.md`, with this section appended; the shared original itself was not modified. The orchestrator can copy back the updated report.

### Open work / deviations

- Item 10 only: the deterministic post-provider/pre-durable-settlement crash proof is not claimed; see the issue. No new seam was authorized or added.
- The restart test explicitly requeues sent_unknown, preserving the existing lifecycle; it does not invent automatic retry on restart.
- `:authority` is not exposed by the current HTTP/1/Web Request carrier. Logical Host is implemented and tested; any future HTTP/2 carrier must preserve logical authority too.
- Existing page budgets are 8,192, not the common brief's older 4,096; unchanged.
- No remaining design question is reopened.


## Fix round r2

Base/unchanged HEAD: `79e6cf693d2790164e69d03266819971ad9ccb56`, branch `s2/ri-witness`.
No commit, stash, branch operation, or full-suite run. Governing scope: LLP 1021 §3–§4,
LLP 1003 §2–§4, LLP 1002 §7, and the r1 rulings. Codex r2 and the completed Grok r2
review were read; Grok arrived during implementation and reports LAND WITH FIXES,
none blocking. This section supersedes r1's witness/refusal and runner-exit claims.

### Item disposition

1. **FIXED — caught refusals cannot witness.** A granted effect requires an empty
   `provider.refused` object as well as substituted contact. Any recorded refusal
   also disqualifies a grant-less effect. The terminal row retains its real provider
   evidence in `refused`, even after catching the denial and returning JSON.
   Real-owner tests `caught_ungranted_redirect_after_provider_contact_is_not_a_witness`
   and `caught_unbound_redirect_after_provider_contact_is_not_a_witness` assert a
   passing refusal journey, `effects:no-witness`, exactly one negative row with one
   substituted request and one refusal, no witness, and zero hits at the reachable
   denied destination. Unit:
   `caught_refusals_never_witness_even_after_contact_or_without_declared_grants`.
   Guide testing says a caught refusal proves nothing, including after a substituted
   hop; it defines `refused` as terminal rows that are not witnesses.
2. **FIXED — default-build chat expectation.**
   `quarry_chat_init_check_and_test_end_to_end` requires exactly the named provider
   journey's `blocked: effects:no-engine`, all other 16 journeys passing, and the
   existing `effects` check's `blocked: no engine in this build`. No behavior changed.
3. **FIXED — unsuccessful runner exit.** The supervisor takes and drops stdin after
   its single drained-close acknowledgment. Leaving that pipe open kept Node alive
   until grace cleanup, masking natural nonzero exits and preventing `beforeExit`.
   Existing real CLI regression
   `selection::a_passing_body_receipt_cannot_hide_an_unsuccessful_runner_exit` passes
   with both `exitCode` and `beforeExit`, selected and full-suite modes. New unit
   `drained_close_ends_stdin_and_preserves_the_runners_unsuccessful_exit` exercises
   the actual child process/acknowledgment, retains the passing body receipt, and
   asserts exit codes 7/9 without grace termination. Whole `test_verb` file passes.
4. **FIXED — idle cleanup waiting.** `runCheck` opens/awaits the stdin handshake only
   after successfully binding a provider and removes both listeners at acknowledgment.
   Package regression `a completed journey with no provider exits without an epoch
   acknowledgment` holds stdin open, sends no acknowledgment, and proves natural
   exits 0/7/9. Existing `close_effects_epoch` already returned immediately for an
   empty claim list; new unit
   `epoch_close_without_outstanding_claims_returns_without_polling` pins that it
   issues only the initial close action. Active-claim waits remain intact, proven by
   `epoch_close_waits_for_its_claim_and_post_close_emissions_are_unbound` and
   `supervisor_close_keeps_a_completed_journeys_provider_alive_until_settlement`.
   The budget + 2 s receive allowance is a maximum, not a sleep; it did not need
   changing. Epoch boundaries/round trips remain. Guide testing states the idle rule.
5. **FIXED — unavailable history.** `observe_rows` retains the trace route's
   `{ unavailable: reason }`; receipt `detail.history[effect]` records journey, seq,
   and reason. Missing coverage caused by this becomes `effects:history-unavailable`
   and names that history instead of `needs: another journey`. Malformed history
   fails with sited `E_OWNER_TEST_IO`. Tests:
   `unavailable_history_retains_its_reason_instead_of_requesting_another_witness`
   and `malformed_trace_history_fails_instead_of_claiming_a_missing_witness`.
   Both exercise control HTTP replies through `check_effects`, including two rows
   sharing one cached trace request. Null, object without reason, non-string/empty
   reason, and string reply are malformed cases. Guide testing states both outcomes.
6. **FIXED — binding refusal sites.** Epoch/bind routes attach their path through
   `Refusal::with_site`; epoch-state, stale-token, invalid-origin, and non-loopback
   refusals also carry the site from the writer. No diagnostic code added.
   `binding_refusals_report_their_route` covers the writer cases; package
   `a dev owner refuses provider bindings, and E_EFFECT_UNBOUND is a registered
   effect-family card` now asserts route sites on malformed epoch/bind requests
   and dev-owner refusals. Guide testing names the rule and repair.
7. **FIXED — minor corrections.** RFC §3 names `test_journey_runner.rs` for the
   supervisor. `a_failing_control_client_fails_instead_of_claiming_engine_absence`
   asserts the actual `receipt.detail.refusal`: `E_OWNER_TEST_IO`, `/control/status`,
   owner family, testing page, rerun rewrite, and HTTP 500 message.
8. **FIXED — records.** This section appended to the worktree's
   `reports/final-witness.md`; standalone `REPORT-witness.md` written; r2 line
   appended under LLP 1021's Implementation record. RFC Status unchanged.

### Before / after evidence

Logs retained in `/tmp/witness-r2-*.log`.

- Redirect regressions against base behavior (`redirect-before.log`):
  `test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 16 filtered out; finished in 15.65s`.
  Both wrongly selected a `sent` witness with `requests: 1` and
  `refused: { E_EFFECT_GRANT: 1 }` / `{ E_EFFECT_UNBOUND: 1 }`. After: both assert
  `blocked: effects:no-witness`, retained negative evidence, zero denied hits.
- Init (`init-before.log`):
  `test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 16 filtered out; finished in 22.93s`.
  The named provider journey was correctly blocked; the all-pass expectation was wrong.
- Runner (`exit-before.log`): `left: Some(0)`, `right: Some(1)`, receipt `verdict: pass`;
  `test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 33 filtered out; finished in 3.06s`.
  Isolated real Node pipe reproduction: pipe left open → SIGKILL at 506 ms;
  pipe ended → natural exit 7 at 25 ms. After: the CLI exits 1 with a fail receipt
  retaining the passing body and the runner's actual unsuccessful status.
- Provider-free runner (`handshake-before.log`): `ℹ tests 1`, `ℹ pass 0`, `ℹ fail 1`;
  timeout killed it (`null !== 0`). After: natural exit without any acknowledgment.
- History (`history-before.log`): unavailable reason became `effects:no-witness`;
  malformed reply became `blocked` instead of `fail`; each new test failed 0/1.
  After: reason retained; malformed reply fails at `/control/trace?seq=3`.
- Sites (`sites-before.log`, `route-sites-before.log`): writer `site: None` and
  HTTP `site: undefined` instead of `/control/effects/epoch`; both tests failed.
  After: epoch/bind/stale refusals carry the applicable route.

### Verification and loop measurements

- `scripts/hermes test -p snapback2-effects`:
  `test result: ok. 73 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.77s`.
- `scripts/hermes test -p snapback2 --test effects -- --test-threads=2`:
  `test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 121.57s`.
- `cargo test -p snapback2 --test init quarry_chat_init_check_and_test_end_to_end`:
  `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 16 filtered out; finished in 20.08s`.
- `cargo test -p snapback2 --test test_verb`:
  `test result: ok. 34 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 49.62s`.
- `cargo test -p snapback2 --bin snapback2 test_effects`:
  `test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 210 filtered out; finished in 0.01s`.
- `cargo test -p snapback2 --bin snapback2 writer_bindings`:
  `test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 213 filtered out; finished in 0.07s`.
- `cargo test -p snapback2 --bin snapback2 control::`:
  `test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 213 filtered out; finished in 0.14s`.
- `cargo test -p snapback2 --bin snapback2 test_journey_runner`:
  `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 219 filtered out; finished in 0.05s`.
- `node --test tests/effects-visibility.test.ts` (final serial run):
  `ℹ tests 8; ℹ suites 0; ℹ pass 8; ℹ fail 0; ℹ cancelled 0; ℹ skipped 0; ℹ todo 0; ℹ duration_ms 32280.124375`.
- `cargo build`, `cargo build -p snapback2-media`: exit 0.
- `node build.mjs`: exit 0; `guide: 31 cards, 84472/98304 bytes (14% headroom)`.
  Testing page: 7,130 / existing 8,192-byte cap; no budget raised.
- `./ref-check --verbose`: `ref-check: ok — 439 LLP docs, 8599 refs in 22365 files, 0 errors, 0 unchecked`.
- `git diff --check`: pass. Every changed file is below 1,500 lines; largest
  changed source is `tests/init.rs`, 1,069 lines.
- `node scripts/caps.mjs`: only the two pre-existing Snapback 1 violations:
  `crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` (1,504),
  `packages/snapback-contract/agent-authority-contract.test.mjs` (1,508).
  No Snapback 2 violation. No owner-stop sandbox artifact in the passing Hermes run.

Local `node scripts/measure.mjs --check`, pinned Node 24.18.0:

| Step | Before | First fixed run | Final fixed run |
|---|---:|---:|---:|
| Chat `test` | 13.918 s | 9.760 s | 10.195 s |
| Todos `test` | 1.241 s | 0.867 s | 0.964 s |
| Install tarballs | 12.811 s | 0.991 s | 1.086 s |
| Entire consumer smoke (30 s budget) | 35.41 s | 18.66 s | 20.08 s |

The first cache was cold: the entire smoke improvement includes npm warming.
Chat's own reduction is 3.723 s in the final run (4.158 s in the first fixed run),
consistent with removing the 17 unnecessary 250 ms grace waits. The host's supplied
baseline is 32.56 s overall / 18.5 s chat; no host-after timing is claimed.
All final measured latency budgets pass. `measure --check` exits 1 solely on the
same three package-size comparisons as the before run and supplied host log:

```
measure: client_gzip_bytes: 138714 bytes exceeds 136547 by more than 1%
measure: react_gzip_bytes: 148334 bytes exceeds 146166 by more than 1%
measure: expo_gzip_bytes: 152004 bytes exceeds 149836 by more than 1%
ok runtime_gzip_bytes: 84986 bytes ≤ 84580 + 1%
ok Test what you just changed: 20.08s ≤ 30s
measure: failed steps: client_gzip_bytes, react_gzip_bytes, expo_gzip_bytes
```

All four measured byte values are identical before and after this round. Those
inherited byte regressions are outside this lane; no baseline/ceiling changed.

Intermediate verification: the concurrent package run was 6 passed / 2 failed,
with compiler `Cannot find module 'snapback2/internal'` / missing declarations
while the Rust fixture was rebuilding the shared package. The final serial run
passes 8/8. Initial redirect fixtures were corrected for the declared `unknown`
result type and for grant error codes living on `error.code`; the retained
`redirect-before.log` is the corrected fixture against base behavior, failing
both witness assertions (not TypeScript compilation).


### Files and scope

- Owner: `snapback2/crates/snapback2/src/{test_effects,test_journey_runner,writer_bindings,control}.rs`.
- Rust tests: `snapback2/crates/snapback2/tests/init.rs`, `tests/effects_cases/witness.rs`.
- Package: `snapback2/packages/snapback2/src/test.ts`, `tests/effects-visibility.test.ts`, `guide/testing.md`.
- Records: `llp/1021-effects-in-the-loop.rfc.md`, `reports/final-witness.md`, `REPORT-witness.md`.
- Measurement-generated additions outside the lane's literal source list:
  `snapback2/metrics/{loop,twin}.jsonl`; retained append-only. No budgets changed.
- `tests/common/mod.rs` was reformatted transitively by rustfmt, then restored byte-for-byte;
  no remaining diff. Other formatting changes are limited to touched files.
- Pre-existing `vendor/llp` change was left untouched. Nothing under the shared
  `/Users/ccheever/projects/snapback-ri-20260910` program directory was modified;
  it is outside the writable roots. The orchestrator can copy the local report back.

### Deviations / remaining work

- No r2 item refused and no design ruling reopened. Exact blocked-history receipt
  spelling was not prescribed; `effects:history-unavailable` plus `detail.history`
  makes the requested distinction without adding a diagnostic family or code.
- Empty epoch close already had the required immediate return on this base;
  the wasted time was the stdin lifetime and unconditional handshake, not the
  active-claim drain or its receive timeout.
- R1 item 10 remains ticketed as ruled:
  `issues/20260910-snapback2-crash-after-provider-before-settlement-witness-seam.md`.
  No claim of a post-provider/pre-durable-settlement crash proof.
- Grok's additional nonblocking coverage suggestions (bind-after-emit journey,
  engine-bearing derived-only run, https Host-built redirect, production response URL)
  were read; they are not new implementation items in this fix brief. Its `refused`
  terminology and two overlapping minor comments are covered here.
- No full suite run: the fix-round instruction assigns that to the orchestrator.
- Node on the initial PATH was the Volta shim/v25.9.0; every build/test/measurement
  used the real `/Users/ccheever/.volta/tools/image/node/24.18.0/bin` first on PATH.
  Initial measurement hit EPERM writing the default npm cache; reruns used
  `npm_config_cache=/tmp/witness-r2-npm-cache`, without changing configuration.


## Fix round r3

Base/unchanged HEAD: `d49a32f1445558c8dfe435f8e062f89038380fe7`, branch `s2/ri-witness`.
Read Grok r2, the prior report through r2, the program plan, the Snapback 2 fence,
LLP 1021 §3–§4, and the cited lifecycle/receipt contracts. No commit, stash,
branch operation, or whole-suite run. All seven requested items are fixed;
no r3 item is refused.

### Governing context

Scope: provider witness receipts, epoch client timeout, and their existing tests.
Constraints: LLP 1021#3-a-provider-stand-in-and-nothing-else-answers (bindings are
snapshotted at claim, grant-first bound transport, logical URLs/Host),
LLP 1021#4-test-counts-witnesses (coverage requires successful contact without
refusals), LLP 1003#2-the-outbox-lifecycle (terminal settlement and committed
then), LLP 1002#7-test-and-the-receipt (selected coverage). No new design decision
or hand-off; the RFC Status remains unchanged.

### Item disposition

1. **FIXED — bind after emit/claim.**
   `binding_after_an_emission_is_claimed_cannot_rescue_its_unbound_attempt` emits
   `messages.send`, polls `effects.rows()` until its `delivery.notify` is `running`,
   then binds and settles: `failed`, `E_EFFECT_UNBOUND`, zero provider requests.
   The fixture delays its first fetch by one second so the running claim is
   observable. Choosing `running` from the brief's queued/running alternatives
   pins the claim-before-bind ordering; a merely queued row has not snapshotted
   its bindings yet. No production change. The existing guide bind-first sentence
   already states the rule.
2. **FIXED — Hermes derived-only.**
   `hermes_chat_derived_only_passes_without_effect_or_journey_checks` runs the
   Hermes test binary against a scaffolded chat using `test --derived-only --json`:
   exit 0, verdict pass, `scope.derivedOnly: true`, nonempty passing checks, no
   effects check and no journey checks. No production change; existing guide
   scope sentence applies.
3. **FIXED — honest receipt name.** `detail.notWitnessed[effect]: { rows, dropped }`
   replaces the terminal non-witness list's `refused` key, without an alias.
   `lastError` and `provider` evidence remain on every retained row. Actual
   refusal counts keep their distinct `provider.refused` field.
   `not_witnessed_receipt_names_terminal_non_witnesses_and_preserves_evidence`
   exercises `check_effects` over HTTP and trace history, asserting sent/no-contact,
   caught refusal, real failed refusal, their original evidence, and absence of
   the old list key. `not_witnessed_evidence_reports_every_row_dropped_past_twenty`
   pins 20 retained / 7 dropped. Every real-owner receipt reader now uses the new
   key. `receiptVerdict uses coverage verdicts with notWitnessed evidence` pins
   consumer acceptance with and without a successful witness, with both values
   of `allowNoEngine`. `receiptVerdict` already ignores evidence-field names;
   its explanatory comment and coverage test were updated, with no unnecessary
   acceptance-logic change. Guide testing and LLPs 1002/1021 use the new name.
4. **FIXED — HTTPS Host-built redirect.**
   `owner_journeys_admit_relative_and_https_host_derived_redirects_on_the_logical_origin`
   keeps the scaffold grant `https://api.example.com`. `/send` returns
   `Location: https://${request.headers.get("host")}/next`; `/next` returns JSON.
   Both relative and Host-built cases assert two hits, `sent`, committed `then`,
   logical `/next` URL, and second-hop `Host: api.example.com`. No transport change.
5. **FIXED — production response URL.**
   `production_response_url_is_the_engine_url_without_rewriting` uses production
   jobs (`bindings: None`) whose body returns `(await fetch(payload.url)).url`.
   Direct and redirected requests return the real server URL/path/query; three
   real hits and no substituted-provider evidence. No engine or fetch-factory edit.
6. **FIXED — minor timeout and receipt site.**
   `epoch_open_keeps_the_task_timeout_and_only_close_gets_the_drain_budget`
   pins five seconds for open/malformed epoch values, budget + 2 seconds for
   close (null or omitted, matching the owner), and no extension on other routes.
   Guide testing states the open timeout. The existing
   `a_failing_control_client_fails_instead_of_claiming_engine_absence` already
   asserted the actual receipt's `E_OWNER_TEST_IO` and `/control/status` site in
   r2; those assertions remain and pass. Its one-read raw-socket HTTP-500 fixture
   failed once during this round, so it now uses the existing `tiny_http` helper
   to answer a complete request instead of risking an early connection close.
7. **FIXED — records.** This section appended to `reports/final-witness.md`,
   standalone `REPORT-witness.md` written, and r3 line appended to LLP 1021's
   Implementation record. RFC Status unchanged.

### Before / after evidence

Logs: `/tmp/witness-r3-*.log`. Items 1, 2, 4, and 5 are missing-coverage fixes;
their new assertions passed against the existing r2 behavior. Only the list
name and open timeout change product behavior.

- Bind (`bind-before.log`):
  `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 19 filtered out; finished in 11.47s`.
  Asserts `failed` + `E_EFFECT_UNBOUND` and zero requests after observed running.
- Derived-only (`derived-before.log`):
  `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 19 filtered out; finished in 16.73s`.
- Receipt (`receipt-before.log`): emitted `"refused":{"delivery.notify":{"dropped":0,"rows":[…]}}`
  with states `sent`, `sent`, `failed`; the no-old-key assertion failed.
  `test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 220 filtered out; finished in 0.00s`.
  After (`receipt-after.log`): the same evidence is under `notWitnessed`.
  `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 220 filtered out; finished in 0.01s`.
  The final unit additionally sources provider evidence from claim/settlement history.
- HTTPS (`https-before.log`):
  `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 19 filtered out; finished in 17.39s`.
- Production URL (`production-before.log`):
  `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 73 filtered out; finished in 0.08s`.
- Open timeout (`timeout-before.log`): `left: Some(32s)`, `right: Some(5s)`
  for `{"epoch":"journey-1"}`.
  `test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 221 filtered out; finished in 0.00s`.
  After: open 5 s, close 32 s; the client group passes 4/4.
- Initial test_effects group (`test-effects.log`):
  `test result: FAILED. 10 passed; 1 failed; 0 ignored; 0 measured; 211 filtered out; finished in 0.01s`.
  Only the existing HTTP-500 fixture's message assertion failed. After its complete
  HTTP-response fixture replaced the single raw read, the group passes 11/11.

### Verification (verbatim counts)

- `scripts/hermes test -p snapback2-effects`:
  `test result: ok. 74 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.77s`.
- `scripts/hermes test -p snapback2 --test effects -- --test-threads=2`:
  `test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 149.78s`.
- `cargo test -p snapback2 --bin snapback2 test_effects`:
  `test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 211 filtered out; finished in 0.01s`.
- `cargo test -p snapback2 --bin snapback2 writer_bindings`:
  `test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 215 filtered out; finished in 0.11s`.
- `cargo test -p snapback2 --bin snapback2 client::`:
  `test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 218 filtered out; finished in 0.00s`.
- `node --test tests/effects-visibility.test.ts`:
  `ℹ tests 9; ℹ suites 0; ℹ pass 9; ℹ fail 0; ℹ cancelled 0; ℹ skipped 0; ℹ todo 0; ℹ duration_ms 43969.472042`.
- `node build.mjs`: exit 0; `guide: 31 cards, 84584/98304 bytes (13% headroom)`.
  Testing guide 7,242 / existing 8,192-byte cap; no budget changed.
- `cargo build`, `cargo build -p snapback2-media`, final `cargo build`: exit 0.
- Final requested selections: 125 tests passed, 0 failed. Effects crate doctests: 0/0.
  Both owner-stop tests passed; no sandbox artifact in the final results.
- `./ref-check --verbose`: `ref-check: ok — 439 LLP docs, 8599 refs in 22365 files, 0 errors, 0 unchecked`.
- `git diff --check`: pass. All 11 changed/added files are below 1,500 lines;
  largest is LLP 1002 at 1,475, largest changed source is `test_effects.rs` at 864.
- `scripts/test.sh`, full workspace tests, and loop measurements were not run,
  following this final round's explicit targeted-only instruction.

### Changed files and scope

- `snapback2/crates/snapback2/src/test_effects.rs`: receipt list/internal names,
  end-to-end receipt unit fixture, complete HTTP-500 fixture, existing assertions.
- `snapback2/crates/snapback2/src/client.rs`: epoch timeout predicate and unit.
- `snapback2/crates/snapback2/tests/effects_cases/witness.rs`: bind-after-claim,
  Hermes derived-only, HTTPS redirect, renamed receipt readers.
- `snapback2/crates/snapback2-effects/src/ibex_bound_tests.rs`: production URL test.
- `snapback2/packages/snapback2/tests/effects-visibility.test.ts`: receiptVerdict test.
- `snapback2/packages/snapback2/guide/testing.md`: list name/evidence and open timeout.
- `snapback2/scripts/consumer-smoke.mjs`: receiptVerdict explanation only.
- `llp/1002-dev-loop.spec.md`: receipt-field spelling in the cited receipt contract.
- `llp/1021-effects-in-the-loop.rfc.md`: receipt-field spelling and r3 record.
- `reports/final-witness.md`, `REPORT-witness.md`: requested reports.

Scope note: the receipt contract in LLP 1002 and the existing consumer-smoke
script were also touched to keep the explicitly requested name/consumer update
consistent; no new script, registry, config, check, design document, or template
was added. The shared program directory was read only; its report copy remains
for the orchestrator to update from this worktree. No edit to `writer.rs`
(still 1,363 lines), runtime transport, or epoch claim policy.

### Deviations / open questions

- No r3 item refused and no open r3 question. The running-state poll is the
  deterministic member of the requested queued/running alternatives; it does
  not claim that a later bind must fail while the row remains unclaimed.
- The existing receiptVerdict function does not inspect the renamed key; behavior
  remains verdict-based, now documented and exercised with `notWitnessed`.
- No new grant, diagnostic, budget, or runtime behavior beyond the named changes.
- Historical report sections above use the field names at those revisions; this
  section supersedes their terminal-list naming. Actual refusal counts continue
  to be called `provider.refused`.
- The prior post-provider/pre-durable-settlement crash-seam issue stays open;
  r3 neither changes it nor claims that boundary.

## Fix round r4 (orchestrator)

Codex r3 (`reviews/witness-r3-codex.md`): with the trace history unavailable, a row carries no
provider evidence, and the aggregator read a missing `provider.refused` as zero refusals for a
grant-less effect — a caught denial became a witness once its record was lost. Fixed: zero
refusals is evidence the row must carry; a row without provider evidence never witnesses, grants
or not, and the check blocks with the retained history reason. Test: the caught-refusal unit
now also removes the evidence and asserts no witness for both grant shapes. `test_effects` 11/11.

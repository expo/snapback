# snapback2: Clique-findings program — non-blocking review residue (2026-09-05)

**Status:** Open
**Systems:** snapback2, compiler, effects, guide, client
**Severity:** P3
**Author:** Claude Fable 5.1 (orchestrator), from Grok 4.6 and Muse Spark round-2 reviews
**Date:** 2026-09-05

The 2026-09-05 program that fixed nine Clique-benchmark findings (`PANEL/plan.md` in the
program workspace; LLPs 1001/1002/1003/1010/1011/1017 amended) landed each lane after two
blind review rounds. Round-2 items the reviewers marked non-blocking and that did not fit a
third round are collected here so they are not lost.

## L5 — effect bodies are ES2020 (Muse r2)

- `packages/compiler/src/project.ts` ~147-151: the skip comment says "helpers" but the
  condition also skips effect-only modules; name both cases.
- A static `import` inside `run` yields both `E_EFFECT_IMPORT` and `E_EFFECT_TYPE` at the same
  site; pin the count or suppress the second.
- Keep the ordered-identity test (`test-effects.ts` ~102-115) intact through later rebases of
  `project.ts` (lane L1).

## L3 — honest certificates (Muse r2, Grok r1 minor)

- `protocol.rs` ~8-28: `E_STEPS` falls through to the `opaque/subset` family mapping instead of
  `bound/ceiling` (pre-existing; the lane's report carries the reproduction).
- `merge_label` early-`None` edge in `collection_rewrite.rs` ~132-134 (unreachable today).
- Tests not written: steps/heap filler under a mixed refusal; the `fits == 0` cap-repair
  branch; two-cap ordering on the `index entries` diagnostic; the closure-bytes shape of a real
  Quarry merge asserted in the suite (the CLI transcript shows it).
- LLP 1017 §7 has no landing row for the L3 commits (add at the next LLP 1017 touch).

## L2 — Quarry language holes (Muse r2, Grok r2)

- Grok r2: `selectIndex`'s mixed named/positional key check moved above the explicit-index
  branch (`quarry/catalog.ts` ~175-176), so `[author = viewer, now] by byAuthor` now refuses on
  every `by <index>` read, not only merge lanes; the guide's "positional or named" reads as
  exclusive, so this is consistent, but pin a point/range case or restore implicit-only if
  merge-only was intended.
- Grok r2: the TypeScript harness path still admits `for (const t of p.tags)` over an optional
  list column (`authored-types.ts` ~60-62, `binding-bound.ts` ~59-60 unwrap `?` before reading
  `max`); Quarry refuses; mirror the refusal (or an empty default) in `lowerCollectionDomain`
  before another lane treats the TS path as equivalent.

- `upsert posts['copy'] { … }` (a text-literal key on an upsert) refuses
  `E_SCHEMA_ID_RESERVED` because the identity checker compares the lowered key and row id
  structurally (`lower/write-identity.ts` ~11); the plan's F6-C covers key/equality/`??`/merge
  prefixes, so this is triage input, not a defect of the lane.
- The public offline client pins no read time and refuses clock-dependent corpus replays with
  `E_INPUT: readTime was not pinned` (correct fail-closed posture; a client clock is a design
  decision, not a fix).

## L6b — effect fetch headers (Muse r2)

- Extend the cross-origin status loop to 301 and 308 (`ibex_tests.rs` ~474 covers 302/303/307;
  301 shares 302's branch and 308 shares 307's).
- Use the whole-block `assert_content_type` in the redirect matrix and cross-origin tests too
  (they still assert `content-type` by first match).
- The lane report says "all eight headers" where the test asserts nine pairs.

## L7 — auth machine (Muse r2, Grok r2)

- **Resolved 2026-09-05 (auth startup follow-up):** `initializeOffline` returns immediately when `operationFence > 0` (`client.ts` ~1012),
  so a `login`/`signup`/`guest` started before `ready` skips confirm, metadata, and resume for
  that client; restoration later retries `me` but resume is not retried unless something calls
  `online()`. After a failed racing login, run metadata/resume once custody is restored, or run
  them from the post-`ready` `me` path (test: a login submitted during startup then outbox/resume).
  Startup now retains pending sync; a successful session or restored bearer joins the
  existing metadata/resume flight. SQLite restart regressions cover successful and failed
  login both before hydration and during a pending `me`, with a durable intent replayed
  exactly once without `online()` or mounted queries. Ordinary re-login keeps its explicit
  resume contract for a past-fence queue.
  Review follow-up (2026-09-06, Astra + Grok): interruption during initial metadata/resume
  releases `ready` even when fetch ignores abort. Recovery captures authority only after
  the latest queued transition settles, retries metadata through that flight, and restarts
  after a failed transition preserves authenticated custody. Regressions cover queued Alice/Bob
  logins, failure during deferred resume, both outcomes during initial metadata/resume, and
  one failed manifest fetch.
  Round-2 cancellation follow-up (2026-09-06, Astra + Grok): the resume flight now
  races cancellation, so reconnect and already-waiting operations wake without the
  obsolete transport returning. Recovery installs its barrier before waiting for the
  transition tail, and awakened callers recheck both authority and the current barrier.
  Two regressions withhold the obsolete response until reconnect/replay or a waiting
  mutation completes, then release a late success/expiry response and prove no duplicate
  replay or snapshot/outbox change.
  Round-3 cancellation follow-up (2026-09-06, Astra; reproduced from source):
  resume-owned replay and log-tail awaits now race cancellation, releasing the
  existing serialized outbox drain. Delayed resume refusal bodies and JSON failures
  check cancellation before custody, partition, or snapshot effects. Nine regressions
  fail on `0e6cebfcd` and pass with the fix: offline and failed-login interruptions at
  replay fetch, replay body, and tail fetch; delayed terminal 401, invalid 401 JSON,
  and invalid 200 JSON bodies. Every case completes replacement recovery while the
  old response/body remains withheld; retries preserve FIFO and exactly-once execution.
  Late `me()` terminal evidence remains bearer-keyed, including a delayed body across
  successful or failed replacement.
  Integration follow-up (2026-09-06, Grok): mutation-owned drains now carry the
  same cancellation fence as resume drains. Offline, close and account transitions
  release noncooperative replay fetches/bodies and log tails without losing the
  queued intent. A mutation passes its captured authority into its own drain;
  waiting for an auth transition there would deadlock the transition's write barrier.
- **Resolved 2026-09-05 (auth startup follow-up):** `ClientAuth.session` publishes `authenticated` before metadata and then throws on a
  non-retryable metadata failure (offline runtime only): resolve after install and leave metadata
  to `ready`, or fail the promise only when custody did not settle.
  Metadata preparation remains awaited so immediate offline writes keep their certificates;
  a metadata refusal remains on `lastRefusal` while installed custody resolves successfully.
  Login, signup, and guest regressions pin malformed metadata; expiry and close still reject.
- Grok r2: `useQuery` lists `restoring` as an effect dependency (`react-core.tsx` ~185, ~226); a
  non-live `client.query` waiting on the lifetime controller is not aborted by cleanup, so
  confirmation can double-dispatch the read. Drop the dependency and let `settled` resume the
  wait, or abort the in-flight read on cleanup.

- **Resolved 2026-09-05 (auth startup follow-up):** the early-held query path (`client.ts` ~217-224) answers from held coverage before awaiting
  `operationAuthority`, so a query issued mid-login-transition can read predecessor-principal
  held coverage instead of waiting for successor authority (device-held data, labelled
  held/`hydrating`; React identity re-keys on the generation bump). Gate the early path on a
  settled transition tail, or document why predecessor coverage is acceptable there.
  Both query paths and the live subscription shortcut now wait for a stable transition tail
  and check authority after reading.
  Regressions hold login open, prove the read remains pending, then prove a failed login
  reads nonempty retained coverage and an account replacement dispatches only the successor
  bearer. Live regressions prove predecessor messages are not delivered during login.
- A failed transition during backoff restarts the backoff at 1 s (`suspend` → `stop` → `cancel`
  resets it); spec-conformant but unpinned — add a test either way.
- `auth.md` has 6 bytes of headroom (4,090 of 4,096).

(Appended per lane as later round-2 reviews arrive.)

## Wave 2/3 residue (rounds 2–3, 2026-09-06)

Non-blocking review residue from the wave-2/3 lanes (L8a uniformity proofs, L8b enriched capped pages, L9 `words`, L10 lazy merge, L11 `image … once`, L12 `connected`), each reviewer-named and left after the lane's final round.

- **L8a (d2dbe78dc + d45d6e520).** Coverage: a helper scan instantiated twice with different prefixes must prove the pin on every lowering (the `every()` conjunction is untested); one-verdict-for-many metering — two members under one conversation, a member's scan is `Complete` with exactly two probes regardless of range size; the forged split `hoist=false, decided_true=true, ppc=0` through the candidate-limit branch (Muse r2 §5).
- **L8b (4e28bc2e8 + 31e5661ca).** The TypeScript-lowered enriched test asserts `Capped`, the wire result, and `Secret` absence but not the trace-keeps-hidden-point / receipt-key sweep its Rust sibling carries (Muse r2 M2); a bare-page two-page cursor journey with the `hidden-before` seed to settle whether `issues/20260905-snapback2-enriched-capped-page-cursor-parity.md` is generic client custody (Muse r2 M3) — note L10 made `ClientStore::reexecute` clear `next` on any Partial replay, which answers the Rust half of that ticket; the site-label mismatch (`profiles.owner` vs `profiles.byId`) remains.
- **L9 (5b91985d2 + eb29f936c + 354720ffd).** A Quarry table named after a builtin (`words`, and by the same mechanism `tokens`, `range`, `min`, `max`, `count`, `divmod`, `share`) collides with the ambient declaration in generated code ("Duplicate identifier 'words'" as `E_OPAQUE`) instead of refusing at the schema with a rewrite — found at integration when L8a's compiler fixture table `words` met L9's builtin; the fixture was renamed `terms`, the reservation is owed (ticket filed at the sweep). The TypeScript type analysis unwraps an optional left arm of `??` but not an optional right, so `a ?? b` with both optional types as a present text with the left maximum (Quarry takes the right maximum and is sound); narrow it before anyone copies the arm (Muse r3 M1). The compiler matrix lacks the fourth coalesced shape (narrower argument to wider column) the Rust helper covers (Muse r3 M2). The recipe's closure assertion is a result-size sanity check (comments say so); an engine-side held-bytes meter would make it real (Grok r2 M2). `schema.ts` infers rule-literal text maxima with UTF-16 `.length` while the program path counts Unicode scalars (pre-existing inconsistency, Grok r1 §4).
- **L10 (5f556dffe + c32534df7 + ef1dc675b).** Engine-side pins that the system viewer still caps on a forced `Limit` stop and an overlarge union (the twin has them; the engine test asserts only the bypass direction) (Muse r3 M1). The merge remainder's halo may start on an id-duplicate (commented, harmless).
- **L11 (d3f2df71a + c64de817e).** Soften the two `expect()` panics in the schema-certificate disclosure merge (`registry.rs` ~1310) into a refusal for a non-array `disclosures` value (Muse r2). Once `HEAD` on the ordinary path is pinned as headers-only by tiny_http's method handling, not by our code — a comment at the route would save the next reviewer the same claim.
- **L12 (6bf503e9a + bd7e07fc7 + fix round 2).** None beyond round 2.

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — umbrella narrowed to unclosed subitems. **Triage priority:** P3.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

The auth-startup findings explicitly marked Resolved stay resolved. Later direct Quarry compilation retires the old TypeScript authoring-path concerns; current generation must not be changed to preserve that removed lane. Later LLP 1020 also assigns E_STEPS to the bound family.

Remaining work is the separately named reachable diagnostics, source wording and missing controls (redirect statuses, uniformity/cap cases, partial-site parity, live-read cleanup/backoff). Cross-check each against its owning current test before fixing; retain other tickets as the single owner of their reproduced defects. No broad compiler or auth regression is established by this umbrella.

## Server/compiler implementation and disposition — 2026-09-11

**Status remains Open for the client-owned L7 items and the separately owned
L8b partial-site ticket.** The server/compiler residue in this umbrella is now
resolved or explicitly retired as follows.

- **Compiler (`2b3ea88b5`).** A nested static import did reproduce two
  diagnostics at one source site (`E_EFFECT_IMPORT` plus `E_EFFECT_TYPE`); the
  effect checker now owns the single refusal and the exact-count regression
  pins it. The nearby wording and helper-module ES2020 coverage were already
  correct. Explicit-index point and range reads now pin the intentionally
  exclusive named/positional spelling. Direct Quarry compilation proves that
  `words`, `tokens`, `range`, `min`, `max`, `count`, `divmod`, and `share` are
  legal table names; the deleted generated-TypeScript path no longer creates
  the reported collisions, so reserving them would be a regression. Rule
  literal text widths now count Unicode scalars, consistent with program text.
  The old TypeScript optional-list and optional-`??` authoring paths are
  obsolete under LLP 1018.000 §6 and were not revived.
- **Certificates and authority (`408af8ad4`).** Exact regressions now cover the
  `fits == 0` cap repair, largest-first ordering on both examined and index
  entries, two visible members under one conversation with exactly two rule
  probes, and an overlarge system-viewer merge union remaining capped. The
  `every()` helper-instance conjunction and forged
  `hoist=false, decided_true=true` cases were already permanent tests. Mixed
  steps/heap refusal terms and real Quarry closure bytes were also already
  pinned. `E_STEPS` has mapped to the bound family since `27088fe5c`.
- **Effects and asset HTTP (`01f004564`).** The cross-origin redirect matrix now
  covers 301 and 308 as well as 302/303/307 and uses the whole header-block
  content-type assertion. The ordinary asset route now records why
  `tiny_http` supplies headers-only HEAD behavior; the existing raw-TCP test
  remains the executable proof.
- **No behavior change is warranted for two speculative edges.** Every
  constructed merge shape label begins with `merge {site}:`, so
  `merge_label`'s early `None` cannot be reached by the typed caller. Likewise,
  `Generation::schema_certificate` creates the private disclosure object and
  `Certificate.disclosures` is `Vec<String>`; no untyped caller can reach the
  two `expect()` branches in `disclose_once_assets`. Turning either private
  invariant into a public refusal would add an API for an impossible input.

Remaining acceptance is unchanged client work: the `useQuery` cleanup race,
the failed-transition backoff pin, and the site-label parity owned by
`20260905-snapback2-enriched-capped-page-cursor-parity.md`. Keep this umbrella
open until those owners land or move their criteria; do not reopen the resolved
auth-startup sections.

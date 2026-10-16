# SURF3 — 0.4.30 workstream report

Branch `sb4-w13-surf3`, base `59fb4ead1b` (0.4.29), worktree
`/home/ccheever/projects/sb4-w13-surf3`. Initial worktree was clean and
`git log sb4-loop..HEAD` contained no lane work. Version unchanged; no origin
push or publication. User-authorized branch transport went only to the Mac
scratch clone `~/projects/snapback-ws-surf3` via `surf3-incoming` and fast-forward.
Neither the original Mac checkout nor publication clones were modified.

## Scope and governing context

Read Snapback4 AGENTS, NOT-DOING, JOURNAL, root rules; wave13 patterns publish
gate, prioritized list, ledger, Harness H9, R3/P11/DT8/NA12/NA19 and prewave
carryover. Applied llp-orient and llp-ship; the user's fixed branch/no-push and
explicit reviewer commands override generic delivery/roster defaults. Four
lanes handled fixtures/qualification, IDs, help, and production/assets/workers.

Governing LLPs: 3000 §7, REL3 3000.000.000.000 §5, proof kit
3000.011.003.000.000 §2, app bootstrap 3000.013, workers 3000.009 §5.2,
assets 3000.038, and Lean/oracle scope 3000.035. Semantic amendments are
3000.000.000.000.000 (fixtures/surface), 3000.000.001 (mint contexts),
3000.013 §6.10, 3000.009 §5.2, and 3000.038 §11.

## #9 — check/test, fixtures, mint order

- `check` unwraps static `$literal`/`$$` escapes and resolves typed now-relative
  fixture times through the same conversion as `test`. Malformed fixture times
  produce `E_FIXTURE_TIME`, including in intentional operation-refusal cases.
  Ordinary signature drift remains advisory; runtime aliases remain dynamic.
- Assertion enum literals may equal saved aliases. Argument alias diagnostics
  remain deliberate. `matchSet` performs a full duplicate-preserving bijection
  of recursive row subsets; nested arrays retain order. Per-query sweep personas
  are validated in `fixtures/test.sweep.json`; `--as` deliberately overrides them.
- Exported `loadFixtures` lives separately in `proof-fixtures.ts` for KIT2
  integration. It loads reset-ready rows using bounded catalog/status requests,
  typed optional/list time conversion, and one captured dev clock.
- `/seed` and `/dev/reset` accept typed `now+…`. Reset resolves against its
  prospective clock and refuses invalid input atomically; changing store identity
  replaces both persisted and cached time-audience floors. Decoding uses the
  engine's admitted schema under the engine lock.
- Clock/reset/doctor discovery builds on PUBFIX29b with owner-only, locked,
  project-local per-live-instance registrations for memory and persisted devs.
  It validates canonical project, live instance, PID, lifetime and initial store
  identity against /dev/status; reset can rotate current store identity without
  losing discovery. Wildcard listeners normalize to the matching loopback family.
  Stale records are ignored and bounded startup pruning removes only unlocked
  well-formed same-inode records; invalid/unreadable/overflow state fails clearly.
  Multiple live hosts refuse ambiguity with explicit port/URL choices; stale
  legacy hints cannot veto valid registered hosts. Current-protocol automatic
  clock/reset/latency-reset requests carry an instance header checked before
  mutation, closing reused-port races. Explicit selection and legacy hosts retain
  their documented selection semantics. Guidance names the assigned PORT_LO–HI
  or free port0, never invented4401.
- Rust `ids::Mint` is explicit shared owned context: random 80-bit suffix on
  first/newer milliseconds, successor on equal/regressed time, overflow refusal.
  Engine/context/native jobs/auth/assets/Postgres/device prediction and admission
  use their declared contexts. JS retains its module-instance monotonic stream.
  Order holds within a live context, not across devices, processes, restarts or
  commit order. IDs remain public identities, never bearer secrets. Cross-context
  applications use an explicit order column; fixture membership uses `matchSet`.

Main commits: `00c3f2ed87`, `72967c3355`, `eafae0c1b4`, `7271032f2a`,
`f31430833c`, `2d24038c35`, `f92b712251`, `378fe7937a`, `9278435502`.

H9 evidence: the published **0.4.29 binary fails agreement**: `test` passes
`now+2h`, while `check` emits `N_FIXTURE_ARGUMENT_DRIFT`. Verbatim exit codes and
outputs: `snapback4/reports/20261016-surf3/baseline-fixture-agreement.json`.
The current read-only census copied wave13 schemas/fixtures into private temp
projects: **100/100 test passes, zero drift notes**; evidence is
`fixture-census.json` beside it. Evidence app lanes were never modified.
Two frozen-millisecond mutations are tested through native/device memory and
SQLite prediction/admission, the Lean oracle, and 16 actual shipped-WASM
predictions at equal/regressed clocks.

## #12 — coherent surface/help and carryover

One authoritative `cli-commands.json` table drives Rust admission/usage/help and
binary-independent JS helper help. Serve exposes its accepted flags; ignored
flags/combinations either work or refuse before project work. This includes
check URL/release/store combinations, why instance/JSON, types JSON, test JSON,
doctor instance, run token environment, job persona, and incompatible modes.
`data --json` returns an array including `[]`; token quiet and JSON are usable
output modes. Deployment provenance records source hash, CLI version, time and
release separately from executable identity, preserving unchanged redeploys.

`startServe` options-only calls produce `E_PROOF_USAGE`. Guide aliases include
fields/headless/backfill; long piped cards keep their complete body and add
canonical section selectors (or --full for cards without subheadings).
Optional-reference validation is runnable. README proof:web guidance matches the
script. Duplicate identity uses its own diagnostic; reserved-name framing,
witness .code, installed Playwright module loading, social starter port hint,
and synopses/descriptions are repaired. Tests compare all verbs' top-level
synopsis, usage and --help, including a standalone staged binary.

Main commits: `2f20b7ef67`, `707809087a`, `012acdf387`, `a2f3e6b66e`,
`3e1e77b1d5`, `75c1ace42e`. The six-card guide budget stays **12792/12810**
words; exact facts and Quarry examples remain present. README stays317/320 lines.

Ownership pointers: PREV owns prewave F1 preview grouping; DAY3 owns F2 inherited
expiry children, saved-source compatibility, saved-version fixtures and starter
ports; LANG2 owns planner/language notes; RULES3 owns authorization/refusal
recipes; KIT2 owns broad proof helpers/client auth UI; EX8 owns the Exact fresh-app
contract qualification. This lane does not edit their evidence or duplicate work.

## #8 — persona to production

README, CLIENT-AND-OPERATIONS and Expo starters use
`secureStoreSessionStore(SecureStore)`. Generated native/web/online clients test
the real adapter, including encoded-key persistence. Device-less browser/online
AppOptions require an explicit sessionStore; device/persona forms retain their
contracts. TypeScript cannot infer the runtime host, so server callers explicitly
select memorySessionStore if appropriate; browser journal authority still checks
at runtime. The production guide opens with the guest-policy choice, gives a
persona/account/role transition checklist, and separates UI from server roster
identity. Readiness inventories **all** first-writer blockers and generates
reviewable service-seat proposals for each enum role, including viewer-default
principal columns. Operators review each grant; signup does not grant a role.

Main commits: `0c3fdb19b3`, `7271032f2a`, `bc64079c5a`, `75c1ace42e`.

## #14 — workers and assets

Ordinary/generated workers call onError exactly once after a recorded failed
attempt, including missing handlers. Generated authority-loss paths preserve
lease/token redaction whether terminal or retrying. Dev prints settled handler
failures; doctor includes retry and terminal errors. Generated callback tests
assert the same redacted persisted error and retain success/authority controls.

Asset decision: **shared immutable home rows and nominal references**, with
explicit on-delete keep for audit references. References grant no byte authority;
the original home rules/lifetime still govern every download. Independent
lifetimes use authorized download/new upload. The published recipe includes its
complete deletion rules/mutations and is compiled verbatim by the engine test.
The scan adapter verifies the exact byte digest and fails closed on unknown,
failed, unavailable, timed-out, malformed and wrong-byte results. The scanner
service seat and authenticated transport remain trusted application configuration;
engine policy cannot independently attest a scanner's digest claim.

Main commits: `665e156676`, `a9fc04d9ef`, `bc64079c5a`, `2f1e0b5ae8`,
`71dfd36345`. All lane-visible changes are recorded in the **0.4.30 guide
changes** entry; no package version bump.

## Independent reviews

All five amendments and current implementations were reviewed read-only against
59fb4ead1b, with reviewers forbidden prior reviews/report. Verbatim artifacts with
commands/model/brief hashes are under `llp/reviews/3000.000.000.000.000-surf3-*`.

- Fresh `codex exec -m gpt-6.1-sol`, high: R1 NOT READY (reset retained future
  clock; readiness skipped literal escapes), both fixed with regressions; R2
  NOT READY (ignored test JSON), refused with regression; **R3 READY**.
- Muse `muse-spark-1.3-contributor`, high via prescribed wrapper: R1 NOT READY
  (authority-loss redaction, test-only asset schema injection, overstated digest
  authority), all fixed with regressions; **R2 READY**. Wrapper used its configured
  Meta fallback after plan quota and retried a stream error; no key file read.

## Qualification

Implementation/qualification Cargo commands used `CARGO_INCREMENTAL=0
CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`; no full scripts/test.sh run.
One preliminary reviewer attempted an unconfigured Cargo compile; it was stopped
before executable relink, with no test verdict claimed. Fresh scoped review
briefs subsequently forbade all compilation/tests/mutations. Root and Snapback4
frozen Bun installs, root hoist, CLI/client builds, and shipped WASM build done.

- Full native `cargo test --workspace --no-fail-fast` with
  `SNAPBACK4_REQUIRE_LEAN=1`: **COMPLETED**, all seven crates (the requested
  scope plus device/native). Initial exit101:401 parent targets,6301 pass,15 fail,
  45 ignored;9 failing targets. Every failed target has a passing complete
  affected rerun. Initial stale JSON/help assertions were repaired; final reruns: check103, cli_friction40,
  clock35, init50, run_admission28, all pass. Optional Postgres cargo check passes;
  no live-Postgres or default-ignored stress campaign claim.
- Full client bounded pool: **401/401 files completed**, initial14 failing files
  (7542 tests:7461 pass,25 fail,56 skipped). Every failing case now has a passing
  affected rerun; see ledger below. Both full serial models pass81/81, yielding
  **403 files run,7623 initial test cases**. These are initial-run plus repair
  results, not a claim that the initial pool exited zero. Discovery addition has
  further discovery runtime checks pass: client15/15, clock35/35, latency21/21,
  registry1/1, complete CLI unit suite446 pass/5ignored, check103/103,
  cli_friction40/40, dev_reset4/4, replay24/24, run_admission28/28,
  token_live22/22. Final bounded-writer registry2/2 and clock35/35 reruns also pass.
  The old memory-port-refusal test was corrected to the new
  discovery contract; latest complete file passes.
- Lean full check passes 76 theorem audits,115 examples,7 oracle fixtures. Native
  mint unit tests 6 pass. Memory/SQLite mutation-order tests2 pass, each checking
  prediction/admission. Actual WASM mint regression passes.
- Final WASM 2354702 B raw /717039 B gzip /541719 B Brotli; existing 717214 B budget
  unchanged,175 B headroom, +325 B gzip from 0.4.29. Strict serde-family/absence audit
  passes. A lazy-context experiment exceeded budget by41B and was reverted;
  metric records dirty=true due concurrent unrelated CLI edits. Brotli uses
  Node24 quality11 through a temporary wrapper because CLI is unavailable.
- Guide card suite125/125; published file-assets suite7/7; root inventories pass
  (365 package tests,35 script tests,31 demos,487 publication leaves); root guide
  pass22/22 (162 pages,1937 snippets,zero missing preconditions); docs-budget pass;
  ref-check pass550 docs/11935 refs/zero errors at final closure.
- Additional repaired reruns: worker/generated callback/app-storage40/40;
  API/fixture-loader4/4; event-slot producer plus clients48/48; delivery source
  boundary guard1/1 (only proof-await classification changed, no delivery-site
  addition); periphery28/28. Final complete-file surface/examples reruns pass: readme9/9, release43/43, social17/17, standalone help4/4. Follow-up commits `6c5007db67` and `32e6e2dae6` preserve runnable examples and public-helper coverage.
- Mac scratch Darwin arm64 (Node25.9.0), discovery semantic source632d869300:
  complete affected Rust targets pass **612 tests,5 ignored** (unit438, clock35,
  latency21, cli_friction40, dev_reset4, replay24, run_admission28, token_live22).
  Initial friction target had the old memory-refusal expectation; complete
  corrected40/40 rerun passes atcdde7f83cf. Both IPv4/IPv6 wildcard discovery,
  locked registry custody, crash cleanup and stale-instance refusal passed on
  Darwin. Affected client pool initially126/127; its sole stale SecureStore VM
  stub was repaired and complete periphery28/28 passes. Final Mac pubfix29b and
  maintenance-wakeup files pass **28/28**. Earlier files cover surface/proof/
  fixture loader, actual WASM minting, ordinary/generated worker callbacks.

Qualification follow-up: inherited export-maintenance successor PID-capture race
was reproduced unchanged from base, then its test was corrected to prove actual
child sleep refusal even if it exits before live PID capture. All deadline, lease,
wakeup and cleanup assertions remain; full file22/22 passes, commit236a84cdb1.
Mac complete affected file passes as part of the28/28 final client overlay.
Final bounded-writer follow-up at252696bbb3 passes both registry2/2 and
clock35/35 on Darwin. Final negative-clock compatibility source09a1d55d8a
passes Mac Mint 6/6, timeline 17/17 unchanged, and actual rebuilt-WASM3/3.

Qualification limits: initial server-e2e worker-spawn red was reproduced as
concurrent Cargo relinking the running executable inode (`current_exe` becomes
`(deleted)` on Linux); worker spawn source is unchanged from baseline. With the
binary stable, full unchanged server-e2e passes9/9 (119s). No workaround or
unrelated runtime change added. Follow-up ticket:
[worker executable replacement](issues/20261016-snapback4-worker-restart-after-executable-replacement.md). Root generated-artifact bootstrap was required
before inventories/guide passed. A legacy Contract acceptance attempt needed an
unavailable Snapback1 Ibex runtime (SNAPBACK_IBEX_CARGO_BUILD_FAILED); generated
leaves materialized and required root checks passed. No Snapback4 claim depends
on that separate legacy acceptance.

Native campaign completed; all nine initial failing targets have green complete
affected reruns (check, cli_friction, clock, init, run_admission, readauth, lean,
guide and timeline_background). No complete workspace rerun is claimed after
repairs; scoped verification is explicit, and unchanged semantic inputs were not
rerun merely because commits advanced. Full initial command exit101 is retained
in the structured evidence, alongside all passing reruns.
Lean regression harness used `mint.q` while the shared oracle uses `schema.q`;
24e6106706 uses the common compiler helper. Complete Lean integration file45/45
passes with REQUIRE_LEAN, including frozen-millisecond order,400-case campaign
and the retained4-classified+24-resolved roster. Native32-seed and device40-seed
smoke campaigns pass with unchanged signature sets. No generator/oracle/
allowlist or found-case files changed. This is fixed-seed/regression coverage,
not a million-case/live-Postgres campaign claim. Device authoring census grew by
six online-only guide operations;55ce6a3795 adds only explicit never-predicted
entries, no old entry or private-write coverage removed; full readauth88/88 pass.

Discovery addition9278435502 and fixes632d869300 complete the audit's missing
custom-port memory discovery. Scoped R2 findings (wildcards, latency-reset fence,
stale legacy veto) fixed and runtime regressions pass on Linux/Darwin. CodexR3
READY; MuseR3/R4 and CodexR4 found stale ownership prose, rewritten in place by
a734dac765/ae4950dd19. Fresh **CodexR5 and MuseR5 READY** on the complete final
contract. Root then enforced the existing8192-byte reader bound before writer
publication (252696bbb3), with positive/negative tests; both fresh focused
reviews also **READY**, saved as surf3-memory-bound.*. Earlier full-scope READY
verdicts cover unchanged non-discovery amendments. No requested implementation
is deferred; external lane pointers above are ownership boundaries.


## Final compatibility and delivery

The broad native run caught one real compatibility regression beyond stale
expectations: negative signed Rust host clocks had been rejected by minting.
The old normalization is restored in 09a1d55d8a: normalize only the ID timestamp
to epoch zero, preserve signed operation time, and apply the context high-water
rule. Public JS's existing explicit negative-input rejection is preserved.
Original timeline 17/17 passes without weakening or editing those tests;
Mint 6/6, complete latest difftest 94/94, Lean 76/115/7 and actual WASM 3/3 pass.
Both fresh reviewers returned **READY** on this final semantic revision, saved
under `llp/reviews/3000.000.001-surf3-negative-host.*`. Final measurements are
commit d99564a2f9. The earlier 717156 B gzip record remains as a truthful prior
attempt, superseded by 717039 B (175 B headroom), not deleted or relabelled.

Both new LLPs are Implemented and archived from current/. Journal and guide
changes 0.4.30 are updated. All commits use Charlie Cheever's requested identity.
No requested implementation is deferred. The only separate open follow-up is
the inherited executable-replacement issue above, not a SURF3 semantic delta.
Optional/live-Postgres and default-ignored stress campaigns were not requested
or claimed. No origin push, package version bump or publication.

Durable machine-readable evidence:
[snapback4/reports/20261016-surf3/qualification.json](snapback4/reports/20261016-surf3/qualification.json).
This records initial nonzero full-run outcomes, repaired reruns, review paths,
0.4.29 negative H9 witness, 100-schema census, final native/Lean/WASM and Mac scope.

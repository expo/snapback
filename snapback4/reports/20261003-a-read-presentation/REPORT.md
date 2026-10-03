# Lane A: read presentation

Base: `1bea1a149c6df00bae7276c7114c06ea5749b7bf`, branch
`sb5/a-read-presentation`, eb1000. Commission: Charlie's 2026-10-02
“build all of those and see if they improve anything”, LLP 3000.032 §4.1.
Local commit only; no push or publication.

## API and decision

Implemented `readPresentation<T>(read: Read<T>): ReadPresentation` from
`snapback4/contract`, with declaration documentation. The helper owns no
subscription, result, timer, cache or pending-write query. It reads no data
values. `existence` calls the existing helper, preserving its five words.
`pending` means read loading, not pending writes. `incomplete` means ready and
partial, incomplete coverage, a disclosed cut, or a continuation. It includes
nonempty present pages and pending-blocked empty pages. `stale` is ready and
not fresh; `revalidating` is independent. `why?` is the exact current refusal;
`since?` copies the ready timestamp, including zero. No ready metadata survives
loading or denied. No “safe to mutate” bit or alternate existence algorithm.

The complete React/Expo conversation recipe has an explicit backend/account/
resource key, an always-mounted draft, current `usePage` results, and a notice.
It uses actual hooks and generated handles. Membership-dependent Send uses
the original read's existing rule and server authorization. Browser tests run
this exact published code under Strict Mode with React Native host-view stubs.
They check draft/focus retention and result withdrawal separately, key resets,
independent stale/revalidation notices, Send gating and final listener cleanup.
This is not a native layout/input-runtime qualification.

**Keep the small helper, with a modest claim.** It does more than rename fields:
`incomplete` composes the existing partial word with coverage, cut and
continuation even when existence is present. Both pilots now show this truthful
notice on nonempty partial results. The helper owns that tested predicate;
the app still chooses labels. It saves only 124 B/81 B against equivalent
recipe-only presentations. A2's latch removal belongs entirely to the stable
shell recipe. Neither integration shrinks against its original version once
new truthful notices are charged. No cold-builder score improvement, general
LOC reduction, latency benefit or net SDK/app byte saving is claimed.

Rejected: reclassifying existence from rows; conflating stale with revalidating;
reading private pending facts into a display authority bit; latching approved
profiles/results; interpreting partial/loading as permission denial; a second
subscription; changing RV/ON withdrawal logic. Once-media code is untouched.
The helper is a value transform for current renders, not a security boundary
that can erase an object an application previously saved.

## Governing context and documentation

Orientation used the repository's llp-orient workflow. The local skill symlink
was uninitialized; the identical named workflow was read from
`/home/ccheever/projects/snapback-release-0-1-9/vendor/llp/skills/llp-orient/SKILL.md`.
Scope: public client contract, guide/client/React/starter recipes and A1/A2.
Governing constraints: LLP 3000 §4 (independent fence and generated artifacts),
3000.032 §§2.3,4.1 (real specimens and pure presentation), 3000.031 §§1.1,1.3
(single classifier, pending/cut/continuation and composer), 3000.023 §§3.3,3.4,12
(freshness, exact withdrawals, RV retention). Hand-off: none; implemented API
extends 3000.031 §7 rather than creating a second contract spec.

Updated the package README entry point, CLIENT-AND-OPERATIONS complete screen,
client/offline-interactions/social guide cards and `readPresentation`/`read-presentation` CLI aliases, social starter Search/README,
public JSDoc (emitted into `dist/contract.d.ts` by the package build), and the
research implementation record. Generated declarations and wasm are built,
not committed. The affected documentation audit removed the stale claim that
only `partial` emptiness can show an incomplete notice and the old local-only
retention paragraph that contradicted the current .023 policy above it. README stays 300
physical lines; the client card stays 1,199 whitespace-delimited words.
The pre-existing historical retention comment on `ReadyMetadata` still
references .023 §10; current guide text and this API's spec use §12. This lane
does not rewrite RV's contract commentary or any withdrawal implementation.

## Real builder pilots

Counting is LLP 3000.032 §2.3 / EVIDENCE.md: physical source lines, including
blank/comment lines inside a block; UTF-8 bytes excluding the final newline.
A1 is a fragment of one compressed line, not its whole file. Disjoint fragments
on that line are not added as extra physical lines. No formatting-derived LOC.
`pilots.json` retains hashes and counts; `pilot-check.mjs` regenerates them.

| Specimen | Original excerpt | Helper excerpt | Whole original file | Whole helper file | Added notice |
|---|---:|---:|---:|---:|---:|
| A1 Cal29 `src/search.tsx` | 1 line / 123 B | 1 / 80 B | 2 / 1,958 B | 2 / 2,077 B | 10 / 548 B |
| A2 G47 `src/AuthGate.tsx` | 7 / 281 B | 4 / 191 B | 87 / 2,850 B | 87 / 2,934 B | 11 / 604 B |

A1 also adds the 41 B adapter binding and 29 B notice call on the same physical
line; imports are in the whole-file count. Whole integration costs are
**+10 lines / +667 B** for A1 and **+11 / +688 B** for A2, not the excerpt
savings. Notices are charged per independently measured specimen.

A recipe-only ablation implements the same predicates directly in each notice,
using `existence`, `isReady` and unchanged metadata. It keeps the same shell,
labels and result behavior. Both versions' changed integrations are strictly
typechecked against generated APIs; their notices also render identical markup
for 1,010 read cases per specimen; complete edited app files get syntax checks.
These are source pilots, not full application or native-runtime runs.

| Equivalent recipe | Direct-read app + notice | Helper app + notice | Helper difference |
|---|---:|---:|---:|
| A1 | 13 lines / 2,749 B | 12 / 2,625 B | −1 line / −124 B |
| A2 | 98 / 3,619 B | 98 / 3,538 B | 0 lines / −81 B |

Behavior changes: A1 no longer claims “No results” merely because `complete`
is true; it requires `absent`. Cuts, continuations and pending-blocked emptiness
remain uncertain. It now shows incomplete nonempty pages, refusal, stale/as-of
and revalidation notices. A2 mounts the signed-in shell even before the first
profile answer, keeps it through loading/refusal, and displays the read notice;
it explicitly keys profile interaction state by backend/account/resource. It
never used profile readiness as authorization and still does not. No profile
image is saved. Authenticated routing remains owned by the original auth gate.

Custody: Cal29's bundle lacks the client source. The exact file was retrieved
read-only from the original M1 host recorded by the evidence ledger,
`/Users/ccheever/clique-sb4-20261001-astra-cal29/lanes/astra-snapback4/src/search.tsx`.
Its SHA-256 is `8751cb22d22ae46983259e5531e02af6a400db6dfa8d84cac4b04ce01b8d50be`.
G47 came from `/home/ccheever/clique-cmp-20260928-047/lanes/grok-snapback4/src/AuthGate.tsx`,
SHA-256 `c135b00c51924724cb9b77f307cab4bd8ef9420f9485eb1d5e12abb4ad72647b`.
Both match `measurements.json` exactly. Originals remain unchanged. Backend
schemas are copied only for generated API qualification; neither pilot changes
its schema. Cal29 uses the supplied bundle schema and windows.

## Verification

Host environment:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH
export CARGO_TARGET_DIR=$HOME/sb5-lanes/target CARGO_INCREMENTAL=0
# Node v24.13.1; Bun 1.3.14
```

Some repository scripts use literal `target/` paths. The worktree target is a
real directory, never a symlink. A host-only Cargo wrapper in
`~/sb5-lanes/a-artifacts/bin/cargo` runs the real Cargo unchanged, then copies
this lane's completed binary/wasm build into those paths. The full suite uses
this wrapper before the required PATH. Its initial version incorrectly handled
nested fixture builds that remove CARGO_TARGET_DIR; its repaired version only
copies when that variable names the commissioned shared target. It does not
alter flags, selected tests or production code; the initial harness-induced
failures and reruns are classified below. The local CLI copy prevents another lane's later shared
binary replacement from changing client-test semantics. Logs preserve lock waits.

Commands and exact results are recorded below; full lossless logs are retained
in `checks/`. The complete suite and its failure classifications follow below.

- `bun install --frozen-lockfile`: exit 0 (`install.log`).
- `cargo build -p snapback4`: exit 0; `Finished \`dev\` profile [unoptimized + debuginfo] target(s) in 45.00s`.
- `cargo build -p snapback4-device --no-default-features --features web --profile wasm --target wasm32-unknown-unknown`: exit 0 (`wasm-cargo.log`).
- `bash scripts/build-wasm.sh`: exit 0; `wasm 2048753 B raw, 617410 B gzip (budget 618040: ok)`. Ceiling unchanged; 630 B headroom. No Rust runtime change; same bytes as the base's recorded SJ round-1 measurement.
- `bun run --cwd packages/snapback4 build`: exit 0; generated declarations contain the public helper and flag comments.
- `bun run --cwd packages/snapback4 typecheck`: exit 0 (`typecheck.log`).
- `cargo test -p snapback4-lang --test guide`: final result `test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.44s` (`guide-qualified.log`).
- `node --test packages/snapback4/test/read-presentation.test.mjs packages/snapback4/test/read-existence.test.mjs packages/snapback4/test/read-existence-integration.test.mjs packages/snapback4/test/read-types.test.mjs packages/snapback4/test/readme-examples.test.mjs`: `ℹ tests 36`, `ℹ pass 36`, `ℹ fail 0`, `ℹ cancelled 0`, `ℹ skipped 0` (`affected.log`).
- After adding real-device nonempty continuation/stale-empty regressions, `node --test packages/snapback4/test/read-existence-integration.test.mjs`: `ℹ tests 7`, `ℹ pass 7`, `ℹ fail 0`, `ℹ cancelled 0`, `ℹ skipped 0` (`devices.log`).
- `node --test packages/snapback4/test/read-presentation-react.test.mjs`: `ℹ tests 1`, `ℹ pass 1`, `ℹ fail 0`, `ℹ cancelled 0`, `ℹ skipped 0` (`recipe-fixed.log`). React Native host controls are DOM stubs; no native runtime claim.
- `node reports/20261003-a-read-presentation/pilot-check.mjs`: both source hashes, schemas, generated API/changed integration types and edited source syntax pass; recipe-only integrations pass the same typecheck; each pilot also passes 1,010 actual static-render notice equivalence cases (`pilots-equivalence.log`).
- `./ref-check --verbose`: `ref-check: ok — 527 LLP docs, 10131 refs in 32633 files, 0 errors, 0 unchecked` (`ref-check-final.log`; before adding the final journal and failure ticket).
- `node --test snapback4/packages/snapback4/test/read-presentation.test.mjs` after adding the dev-meter non-disclosure regression: `ℹ tests 7`, `ℹ pass 7`, `ℹ fail 0`, `ℹ cancelled 0`, `ℹ skipped 0` (`presentation-final.log`).
- After adding only the CLI discovery aliases and their existing alias assertion, `cargo test -p snapback4-lang --test guide`: `test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.60s` (`guide-aliases.log`). This affected rerun covers the final documentation delta after the full suite's Rust phase.
- `git diff --check`: exit 0.

Initial failures, all introduced and repaired: first guide run exceeded the
1,200-word budget (`109 passed; 1 failed`); the shortened second version broke
an existing required membership sentence (`109 passed; 1 failed`). The final
version preserves that sentence within 1,199 words. The first browser harness
omitted the `react/jsx-dev-runtime` alias, producing Vite import failure; that
run was interrupted and reports one cancelled file. Adding the alias passes
with the actual recipe. These were test/doc integration errors, not inherited
product failures. No green status is assigned to the initial runs.

### Full-suite Rust failures and base proof

The complete Rust inventory runs 287 binaries / 1,000 executions and workspace
doctests, and reports five failed targets, classified individually:

| Target | Failed cases | Classification | Resolution / evidence |
|---|---:|---|---|
| `snapback4-device::native_following` | 2 | Our host harness, environmental to product | The wrapper attempted `/wasm32-unknown-unknown/wasm/snapback4_device.wasm` after fixtures intentionally removed `CARGO_TARGET_DIR`; corrected wrapper ignores those nested builds. Rerun: 2 passed, 0 failed. |
| `snapback4-device::native_reads` | 8 | Same host-harness error | Rerun: 8 passed, 0 failed. |
| `snapback4-sim::native` | 9 (plus 2 passed, 1 ignored) | Same host-harness error | Rerun: 11 passed, 0 failed, 1 ignored. |
| `snapback4-lang::prefix_reads` | 2 | Inherited, reproduced on base | Existing no-note assertions now encounter `N_SHAPE_METER`; base has the same 8 passed, 2 failed. |
| `snapback4-sim::membership_search` | 2 | Inherited, reproduced on base | Existing no-note assertions now encounter `N_SHAPE_METER`; base has the same 22 passed, 2 failed. |

Reruns used ordinary Cargo on the required PATH, with the same shared target
and `CARGO_INCREMENTAL=0`, without the wrapper:

```sh
cargo test -p snapback4-device --test native_following --test native_reads
cargo test -p snapback4-sim --test native
```

Exact results (`native-device-rerun.log`, `native-sim-rerun.log`):

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.99s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.40s
test result: ok. 11 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 1.47s
```

Base proof was extracted with `git archive 1bea1a149c6df00bae7276c7114c06ea5749b7bf`
for `snapback4/{Cargo.toml,Cargo.lock,crates,vendor,packages/snapback4,native-fixtures}`,
plus that commit's `snapback4/rust-toolchain.toml`, into
`~/sb5-lanes/a-artifacts/base`. No source changes there. An initial control
build missing the pinned toolchain file was stopped before tests; it is not
used as evidence. The completed controls use Rust 1.97.0, the shared target,
and the same non-incremental build configuration:

```sh
cargo test -p snapback4-lang --test prefix_reads
cargo test -p snapback4-sim --test membership_search
```

Both exit 101. Exact results (`base-prefix-reads-pinned.log`,
`base-membership-search.log`):

```text
test result: FAILED. 8 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: FAILED. 22 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.61s
```

Every inherited case is named in
[the follow-up ticket](../../../issues/20261003-snapback4-shape-meter-test-expectations.md).
No compiler behavior or unrelated test expectation is changed in Lane A.

### Full-suite client failures and repair

The client sweep runs 290 files at concurrency 24. Its exact summary is:

```text
ℹ tests 5941
ℹ suites 0
ℹ pass 5927
ℹ fail 4
ℹ cancelled 0
ℹ skipped 10
ℹ todo 0
ℹ duration_ms 690776.433159
-- FAIL: client tests (691 s)
```

All client failures are ours: three assertions plus their parent in
`social-browser.test.mjs`, “social search in React/browser uses current server
and retained device pages”. They expected zero partial-result notices for
nonempty pages, even with continuation or incomplete retained coverage. That
is the old UI behavior this lane intentionally changes. The failing scenarios
are `search spans a live and a departed conversation`, `leave followed by a
search`, and `pagination accumulates both domains with no duplicate`.

Updated those expectations to one notice, including incomplete retained
coverage after the final cursor. The row values/order, duplicate checks,
continuation controls, source query, and blank-on-new-needle checks remain.
No product behavior was changed to satisfy the assertions. The focused rerun
exercises all three journeys in Chromium against the real wasm device and
actual generated social starter:

```sh
node --test --test-name-pattern='social search in React/browser' packages/snapback4/test/social-browser.test.mjs
```

Exact result (`social-search-rerun.log`):

```text
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4946.348996
```

The original full sweep remains red; no full client rerun is claimed. Every
other client case passed or was explicitly skipped, and all new presentation,
process/wasm integration, declaration and published-recipe tests passed inside
the full sweep as well as their focused runs. No unresolved introduced failure
remains. The inherited compiler expectations remain open in the linked ticket.

### Final complete-suite result

`bash scripts/test.sh` ran once and exited 1. Its summary line, verbatim:

```text
== 2 failure(s) in 1853 s
   cargo test
   client tests
```

Every top-level check is preserved verbatim:

```text
-- ok: cargo build (14 s)
wasm 2048753 B raw, 617410 B gzip (budget 618040: ok)
-- ok: wasm build (40 s)
docs budget: README 300/300 physical lines
-- ok: docs budget (24 s)
-- ok: release guard (7 s)
-- ok: package typecheck (2 s)
-- ok: package build (3 s)
-- ok: chat app check (0 s)
-- FAIL: cargo test (765 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
-- ok: fixture wrapper tests (11 s)
-- FAIL: client tests (691 s)
-- ok: client models (307 s)
```

The two final client-model files retain the full counts and report:

```text
ℹ tests 79
ℹ suites 0
ℹ pass 79
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 306946.396007
```

All original failures and affected repairs are classified above. No full-suite
green claim: only the four base-reproduced compiler assertions remain unresolved.
Original and final logs, exact exit files, and the corrected host wrapper are
in [checks/](./checks/). The source/distribution wasm SHA-256 is identical:
`6d436f5ce09e6c6e86dcb5f33c04fcd7e1e2809f32d9ff1c69d9dbe18ad55bd8`.
No budget increase, package version bump, push or publication.

Final reference audit: `ref-check: ok — 527 LLP docs, 10131 refs in 32635 files, 0 errors, 0 unchecked`.
Final `git diff --check` passes.

## Round 1 — both blind reviews, 2026-10-03

Read the complete Astra and Grok round-0 reviews in `~/sb5-lanes/reviews/`.
Both said READY WITH CHANGES and found the helper itself sound. Rebased the
lane cleanly onto `origin/main` at `f0c7d7a038`; round 0 is now `3bc5aa80cd`
(formerly `2bf8f36731`). No runtime helper predicate changed in this round.

### Context and dispositions

The scoped `llp-orient` pack covers the public read contract, stable screen,
client/search cards and their tests. Governing documents are LLP 3000.031
§§1.1,7 (disclosed existence and pure presentation), LLP 3000.023 §3.4
(hard withdrawals), and LLP 3000.032 §4.1 (the commissioned screen/helper).
These are in `current/`, not `foundation/`. The guide's composer supplies the
existing synchronous-clear and refusal-edit pattern. No new authority, saved
result, subscription policy or LLP is needed; hand-off: none.

| Review finding | Round-1 change |
|---|---|
| Astra Medium: delayed admission erases a new draft | Clear before awaiting `send.run`; retain `{ id: mintId(), body }` and pass that ID to the write. Match the latest refusal by ID, offering Edit/Dismiss without replacing a newer draft. Chromium holds admission, deletes/retypes identical text, releases it and checks the new draft and focus. Separate regressions cover admission refusal and refusal after pending custody. |
| Grok Medium: dropped inbox rule | Restore the exact sentence “Unknown counts never hide conversations.” in the search/screen paragraph and assert it in the guide test. Trim redundant screen wording; final card is 1,199 words, within 1,200. |
| Astra Low: weak withdrawal test | Two independent subtests each publish a nonempty protected answer immediately before loading or denial. Both require content removal in the committed DOM, with the same draft, input node and focus. |
| Astra/Grok: inconsistent incomplete documentation | Both search references and the screen teach `readPresentation(page.read).incomplete`. The client table points both present and partial notices at `incomplete`; partial remains uncertain empty, never absence or denial. The contract comment states the exact ready-and-predicate condition. |
| Grok: implementation status | LLP 3000.032 §4 now marks §4.1 and landed receipt bindings §4.3 implemented. §4.2 is still unimplemented on the rebased main. |
| Grok: stale incomplete tests | Add an exact nonempty `fresh: false`, `complete: false` result assertion: present, incomplete, stale. Assert the stale empty recipe still renders “No messages in the available snapshot”. |

The screen follows `useMutation`'s latest-submission presentation, as the
existing composer does; durable recovery of an intent history remains the
documented saved-intent pattern. No new pending-intent helper is introduced.

### Verification

Used the commissioned PATH, `CARGO_TARGET_DIR=~/sb5-lanes/target` and
`CARGO_INCREMENTAL=0`. The same host-only Cargo wrapper described above copies
the completed wasm artifact into the script's literal `target/` path. Logs are
under [checks/round1/](./checks/round1/), losslessly compressed.

| Command | Result / log |
|---|---|
| `bun run --cwd packages/snapback4 build` | Pass; final declarations and wasm copied (`client-build.log.gz`). |
| `bun run --cwd packages/snapback4 typecheck` | Pass (`typecheck.log.gz`). |
| `node --test packages/snapback4/test/{read-presentation,read-presentation-react,read-existence-integration,read-types,readme-examples}.test.mjs` | 36 passed, zero failed/skipped: 8 pure presentation, 7 real-device integration, 6 Chromium recipe including its parent, 7 type tests, 8 published-example tests (`affected-final.log.gz`). All 36 README blocks compile. |
| `cargo test -p snapback4-lang --test guide` | 110 passed, zero failed (`guide-final.log.gz`). |
| `bash scripts/build-wasm.sh` | Final pass: 2,048,753 B raw / 617,410 B gzip, budget 618,040 B, 630 B headroom (`wasm-rebuilt.log.gz`). |
| `node reports/20261003-a-read-presentation/pilot-check.mjs` | Both original hashes, schemas, generated API/changed integration types and source syntax pass; 1,010 notice-equivalence cases per pilot (`pilot.log.gz`, separate round-1 schema logs). All code-size counts and the keep decision remain unchanged. |

The first wasm attempt failed because the shared target reused core artifacts
missing `search_decoration`, `decorate_search` and `decoration_expiry`, all
present in this lane's source. Touching only the core crate root's mtime forced
its rebuild; no Rust source content changed. The rebuilt wasm is byte-identical
to round 0, SHA-256
`6d436f5ce09e6c6e86dcb5f33c04fcd7e1e2809f32d9ff1c69d9dbe18ad55bd8`, in both
source and distribution. The initial failure remains in `wasm.log.gz`.
The first green browser run logged React act warnings for DOM-stub events;
wrapping those events in act removes the warnings in the final green run.

Mutation checks were temporary and restored before the final affected run:

- A `Results` ref retaining its last ready items fails both independent
  withdrawals on the still-visible protected text (two subtests plus parent
  failed; other three subtests passed; `mutant-retained-results.log.gz`).
- Adding `read.fresh &&` to the helper's incomplete predicate fails the new
  stale-nonempty deep equality (7 passed, 1 failed;
  `mutant-stale-incomplete.log.gz`).

Chromium executes the actual published recipe with DOM substitutes for native
views; this remains no native layout qualification. The full `scripts/test.sh`
was not rerun in round 1; round 0's full-suite result and inherited failures
remain recorded above. No budget increase, publication or push.

Final `./ref-check --verbose`: 527 LLP docs, 10,131 refs in 32,636 files,
zero errors or unchecked references (`ref-check.log.gz`). `git diff --check`
passes. The requested Astra co-author trailer accompanies the local commit.

# Round 7 reproduction and failure ledger

Base: `bb94366395`, branch `sb4-np/nx-export-proves-native-slim`.
Astra's complete review was read at
`eb1000:~/sb4-intent/reviews/nx-r6.astra.md`, together with the still-present
`/tmp/nx-r6-review-tutjbtvs/group-probe.rs` and its non-exec shell shim.
This is implementation evidence responding to that review, not a new review.

## Reproduction

From `snapback4/`, with frozen workspace dependencies and the built JS package:

```sh
export PATH="$HOME/.volta/bin:$PATH" # mini: actual Volta launcher, Node 24.18.0
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
node -v
cargo test -p snapback4 --bin snapback4 verbs::witness -- --nocapture
cargo test -p snapback4 --test witness -- --nocapture
cargo build -p snapback4
node --test packages/snapback4/test/export-native.test.mjs packages/snapback4/test/export-native-round2.test.mjs packages/snapback4/test/export-publication.test.mjs packages/snapback4/test/export-failure.test.mjs
```

`run-suite.py` records the single canonical `scripts/test.sh` invocation, its
PID, exit status and wall duration. It keeps Volta's launcher on PATH, checks
Node 24.18.0, and supplies the same SQLite flag. No guard, concurrency or budget
override is used. The suite's Rust tests repeat the affected checks.

Linux uses `/tmp/sb4-nx-r7.Gfl8K2` on eb1000 (100.65.137.99), Rust 1.97.0,
Node 24.13.1, Bun 1.3.14, `CARGO_BUILD_JOBS=8` and the same SQLite flag.
The source transport includes the two embedded benchmark Quarry fixtures.
`bun install --frozen-lockfile` installs actual Expo config dependencies.
The existing built `dist/resolve-binary.js` is supplied separately, bound by
`resolver-transfer.json`; it is JavaScript, not a copied native binary.
The source archive and complete per-file manifest are external blobs indexed
in `EVIDENCE-ARCHIVE.tsv`; `source-transfer.json` identifies both.

## Regression boundaries

The three new unit tests call the production preparation spawn path with a
direct runtime, a Volta-style spawn-and-wait JS launcher, and a non-exec shell
launcher. The launcher count proves it is used once for runtime resolution.
The worker reports its parent PID and runtime through an atomic ready file;
its parent must be the recorded group leader. The journal's birth identity is
checked against the actual leader. After recovery's first member snapshot,
a separately parent-owned `sleep` joins that group. Recovery must enumerate
again, drain the late member, stop the leader last, succeed on retry, and
permit repeated abandoned-output cleanup. All three cases run on both hosts.

The existing live-wrapper recovery test now constructs its runner through the
same resolver. The reused-birth refusal, anchor loss during the snapshot,
TERM-resistant descendant, pidfd/Darwin identity checks, leases and publication
crash controls remain in the affected unit run. Recovery's production checks
and signaling algorithm are unchanged; its snapshot hook only gains sibling
visibility for these tests. No new hook is reachable from the CLI.

## Setup failures retained

The first Linux JS run passed 14 tests, failed four and skipped the existing
Darwin-only adapter case. All four failures came from my source transfer
omitting the built `packages/snapback4/dist/resolve-binary.js`:

- Installed-shim signal forwarding: `copyfile` ENOENT before test execution.
- Wrapper interruption/rejection: the same fixture `copyfile` ENOENT.
- Live-wrapper kernel lease: CLI import failed with ERR_MODULE_NOT_FOUND.
- Changed inventory/proof refusal: the CLI import error arrived in place of
  the expected `E_WITNESS_PROOF` refusal.

These are scratch provisioning failures. Supplying the unchanged built JS
resolver and repeating the identical four files fixes them without changing
product code, test assertions, guards, samples or budgets. Both runs are kept.
A preliminary read-only SSH probe found `rustc` absent from the noninteractive
PATH; verification explicitly prepends `~/.cargo/bin` before running Cargo.

The initial mini unit run also passed 32/32. Before the final affected run,
the new fixture's ready file was made atomic to avoid a partial-read race;
the final unit run and canonical suite use that version. Both unit logs remain.

## Scope, custody and limits

No real simulator is needed: Darwin integration uses fake `xcrun` fixtures.
`mini-verify-iphone`, X27R worktrees/simulators and system settings are untouched.
No native timing cohort was run. Social's 25 s warm target and its quiet-host
measurement ticket remain open; no budget changes. Nothing is pushed or published.
The Linux scratch is deleted after copying and hash-checking its evidence.

LLP orientation: scope is preparation process launch, abandoned-process
recovery and their tests. [LLP 3000 §4](../../../../llp/3000-snapback4.explainer.md#4-fence-numbering-routing)
supplies the Snapback 4 fence; [LLP 3000.030 §15](../../../../llp/3000.030-native-proof-in-minutes.rfc.md)
governs birth identities, group custody, leases and retention. Both are in
`llp/current/`, together with design brief LLP 2000.000. The Snapback 1 foundation
gates are outside this fence. The current witness guide card was read; its
published timing limitation and 399-line budget need no change. Risks remain
§15's documented Darwin numeric-PID residual and the open social timing bar.
§15 now states how the anchor is selected; this report and the append-only
JOURNAL entry record the result. Hand-off: none.

## Canonical result

One invocation, exit 0: **`== 0 failure(s) in 2419 s`**. Client pool 5,767 passed,
zero failed, five existing skips; final models 79/79; guide 110/110; CLI units
235 passed with four existing ignored; witness integration 53/53. No canonical
failure occurred. The four Linux provisioning failures remain classified above.
The known delivery-fault flake did not reproduce; no fix for it is claimed.
The complete log is an external, read-back-verified gzip blob; its compressed
and raw hashes are recorded in `full-suite-archive.json`. Tested Rust hashes
match the source transferred to Linux and the final stage. The wasm rebuild
matches round 6 exactly and uses the same 605,225 B cap.

Git whitespace checking also flagged five whitespace-only indented lines in the
initial Linux JS failure log. The committed text view strips that trailing
whitespace; its complete original bytes remain in the external gzip archive.
`small-log-formatting.json` maps the original and view hashes; Linux validation
keeps the original hash and affected-verification records the final view hash.
This formatting check changed no test result or product source.

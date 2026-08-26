# LLP 0209 D2 — complete principal-bound private-overlay conformance

**Opened:** 2026-08-25 (P-C publication-readiness record)

Add positive own-principal, absent, and other-principal rows for both `viewState` and notification state on list and detail graphs (today: other-principal non-interference and one positive own-principal `viewState` case exist; no positive own-principal notification case, no complete matrix). Exercise data updates and authority transitions through the served path while exact-checking result bytes, partition identities, completeness proofs, and matcher dispositions. Acceptance: another principal's row never influences bytes while the active principal's row appears and updates correctly.

**Claimed:** 2026-08-25, session snapback-e9 (claude.ai/code session_01VKza4iiZ918TtDxobNDvvy), sbs-orchestrate lane — in flight. Coordination: this session also holds the superseded pre-port G3-B series (branch `sbs/20260824-g3b-delta-lanes`) whose frozen cases (backward/bounded/NULL root windows, duplicate-app-id, chained delta) feed the two-way-windows lane.

## Implementation update — 2026-08-25

**Status:** Open. The requested implementation and scoped qualification are
present locally; this ticket remains open per the implementation brief. The two
final-tree `snapback` corpus commands are still compile-blocked by the unrelated
`AuthProvider::agent_random_source` error described below.

The canonical freezer now emits
`tests/conformance/graph/private-overlay-matrix.v1.json`, a corpus-local
independent oracle that explicitly says it never uses the D1 control oracle.
It freezes these 16 cases:

| Graph | Overlay | Frozen arms | Evaluator | Served scheduler |
| --- | --- | --- | --- | --- |
| list | `viewState` | own-positive, own-update, absent, other-principal | exact bytes + node/graph proofs | exact establishment/update + cross-principal probes |
| detail | `viewState` | own-positive, own-update, absent, other-principal | exact bytes + node/graph proofs | exact establishment/update + cross-principal probes |
| list | notification state | own-positive, own-update, absent, other-principal | exact bytes + node/graph proofs | exact establishment/update + cross-principal probes |
| detail | notification state | own-positive, own-update, absent, other-principal | exact bytes + node/graph proofs | exact establishment/update + cross-principal probes |

Each case carries case-local evaluator, matcher, served-scheduler, authority-
transition, and unchanged replace-only delta dispositions. The executable tests
assert:

- own rows appear, absent rows project `null`, and own data commits produce one
  exact replacement with exact successor proofs;
- paired worlds with and without another principal's row have identical bytes
  and completeness proofs;
- writes to principal B's row produce a target-node `skip`, zero deliveries,
  and no change to principal A's complete served observation;
- principal B's canonical authority-instance rotation is admitted only in the
  private case's scoped manifest, produces `skip` and zero deliveries, and
  leaves principal A's bytes, partition, and proofs byte-identical;
- active authority generation 0 is fenced before exactly one generation 1
  delivery, with zero stale deliveries and the overlay still scoped correctly;
- list and detail use `partition-of-one`; active and other canonical principals
  have distinct partition hashes, while each active hash is stable across its
  own data update.

Authority fixtures use the canonical mints from `0b140beb3`:
`usr_00000000000000000000000000` and `usr_00000000000000000000000001`,
with `aut_01hw6s0ysjf8h8rct4ank7f24s`,
`aut_01hw6s0ysmf8h8rct4ank7f24s`, and the transition instance
`aut_01hw6s0ysnf8h8rct4ank7f24s`.

The canonical freezer passes with 16 private-overlay cases. Existing frozen
digests remain byte-identical:

- corpus: `sha256:744a285abe3892e2e10bb58c67fb5027f53eb83b8fc263b346a0c314a8c29c44`
- bounds: `sha256:4bc770c50ca2395799c9dc3b79055595307f86db73450a86116c49f021664294`
- pending: `sha256:3bf923f367d8a4bde6c41ca07987b2cfef9790d896e021dd90a225d47177807b`
- dispositions: `sha256:3d81481f82089034d382884bd5044ee4375ee4d823d0e076d7419dad201b7b5c`
- paired worlds: `sha256:7d22ff66914acc9538e7594c53b84ed622970de12cb0b0e8c902898dfac7c009`

No sealed artifact changed, no D1 control source or generated projection is in
the diff, and no `PendingLiveFanout` constructor was added or changed.

### Verification record

- `bun install` at the repository root: PASS (1,039 packages).
- `bun install` in `demos/zerobugs/control`: PASS (374 packages).
- `SNAPBACK_OUTBOUND_ACTIONS=1 bun run generate` at the repository root:
  FAIL, because the root package has no `generate` script.
- The same required command from `demos/zerobugs/control`: PASS (23 tables,
  56 operations, 139 files, 122 warnings). Ambient control manifest rewrites
  were restored; D1 bytes are absent from the diff.
- `scripts/bootstrap-ibex-runtime`: FAIL at its final binary build with
  `SNAPBACK_IBEX_CARGO_BUILD_FAILED`. `scripts/ibex-doctor` found the Hermes
  sources/framework/stamp and local Cargo/Node/Bun inputs present; the final
  build reaches the unrelated OAuth compile error below.
- `cargo test -p snapback --test graph_corpus_v1` on the final tree: FAIL before
  the test binary runs, exit 101, `E0599` at
  `crates/snapback-server/src/server/oauth.rs:700` because
  `AuthProvider::agent_random_source` no longer exists. Freshly fetched
  `origin/main` (`029164f60`) has the same compile defect.
- `cargo test -p snapback --test relational_corpus_v0` on the final tree: FAIL
  before the test binary runs, exit 101, at the same unrelated OAuth error.
- Qualification with a temporary one-line `&OsRandom` compile shim (fully
  reverted before this record): graph corpus PASS, 56 passed / 0 failed in
  1167.96s; relational corpus PASS, 4 passed / 0 failed in 1.13s. All three new
  private-overlay tests pass inside that full graph run.
- `cargo test -p snapback-kernel live_matcher`: PASS, 28 passed / 0 failed /
  830 filtered out in 0.04s.
- `./ref-check --verbose`: PASS, 316 LLP docs, 7,424 refs in 16,016 files,
  0 errors, 0 unchecked.
- `volta run --node 24.18.0 node scripts/check-inventories.mjs`: PASS, 358
  package tests, 31 script tests, 31 demos/catalog entries, 487 publication
  leaves, 157 guide pages, and 1,872 snippets (with the existing gap-review
  warnings).
- `cargo test -p snapback-engine`: expected unrelated FAIL, exit 101, with 14
  `E0599` compile errors: missing test-only `store_for_test` /
  `replace_store_for_test` helpers and `AdmissionLease::unmanaged`, matching
  `issues/20260825-engine-unit-tests-do-not-compile-on-main.md`.
- `cargo fmt --all -- --check`, `git diff --check`, and the canonical freezer
  `--check`: PASS.

# LLP 0209 D2 — complete principal-bound private-overlay conformance

**Opened:** 2026-08-25 (P-C publication-readiness record)

Add positive own-principal, absent, and other-principal rows for both `viewState` and notification state on list and detail graphs (today: other-principal non-interference and one positive own-principal `viewState` case exist; no positive own-principal notification case, no complete matrix). Exercise data updates and authority transitions through the served path while exact-checking result bytes, partition identities, completeness proofs, and matcher dispositions. Acceptance: another principal's row never influences bytes while the active principal's row appears and updates correctly.

**Claimed:** 2026-08-25, session snapback-e9 (claude.ai/code session_01VKza4iiZ918TtDxobNDvvy), sbs-orchestrate lane — in flight. Coordination: this session also holds the superseded pre-port G3-B series (branch `sbs/20260824-g3b-delta-lanes`) whose frozen cases (backward/bounded/NULL root windows, duplicate-app-id, chained delta) feed the two-way-windows lane.

## Implementation update — 2026-08-25

**Status:** Open. The requested implementation and scoped qualification are
present locally; this ticket remains open per the implementation brief.

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
  exact successor row payload. The served own-update arm compares completeness
  shape after normalizing the harness-specific proof tuple and intentionally
  widens the test carrier's page allowance; it does **not** claim the frozen
  carrier's exact successor identity/proof tuple;
- paired worlds with and without another principal's row have identical bytes
  and completeness proofs;
- principal B's UPDATE, DELETE, and INSERT overlay commits each produce a
  target-node `skip`, zero deliveries, no executed evaluation, and no change to
  principal A's complete served observation;
- an ordinary write to principal B's `identityBinding` row remains a separately
  named capture-skip proof; it is not represented as an authority transition;
- retained principal B rotates through the resolver's real second owner-issued
  authority instance, crosses the shared §2.4 fence before its gated
  restoration, and records one per-subscription fence, wake, and delivery;
  retained principal A records zero fence, wake, delivery, frame, or byte delta
  and keeps a byte-identical served observation;
- active authority generation 0 has an in-flight predecessor data evaluation
  fenced before delivery; the delivery-time gate discards that late result,
  then the transition emits the closed census of exactly one fence and one
  generation-1 snapshot, with no other wire kind;
- the frozen crew/removed pair has byte-identical class-2 inputs and present,
  distinct class-3 inputs. The served normal/alternate owner-issued instances
  likewise differ only in class 3, and their engine-issued partition hashes are
  reconstructed and compared without hash normalization;
- every Rust matrix case executes the frozen unchanged replace-only
  `deltaEligibility` disposition.

Authority fixtures use the canonical ordinary, crew, and removed principals.
The freezer uses crew/removed only for the same-class-2 input proof; the served
rotation obtains both authority instances from the engine-owned session
fixture rather than adding authority data to application tables.

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

- `scripts/bootstrap-ibex-runtime`: PASS, including link, launch, and restricted
  handler-VM qualification (`SNAPBACK_IBEX_RUNTIME_LINK_OK`; 532,740,808-byte
  binary, 8.75% above the recorded baseline).
- `cargo test -p snapback --test graph_corpus_v1`: PASS, 58 passed / 0 failed
  in 1,287.45s.
- `cargo test -p snapback --test relational_corpus_v0`: PASS, 4 passed / 0
  failed in 1.55s.
- `cargo test -p snapback-kernel live_matcher`: PASS, 28 passed / 0 failed /
  830 filtered out in 0.04s.
- `./ref-check --verbose`: PASS, 316 LLP docs, 7,430 refs in 16,050 files,
  0 errors, 0 unchecked.
- `volta run --node 24.18.0 node scripts/check-inventories.mjs`: PASS after
  regenerating the diagnostics registry and chained guide manifest for moved
  Rust diagnostic sites: 360 package tests, 32 script tests, 31 demos/catalog
  entries, 487 publication leaves, 157 guide pages, and 1,872 snippets (with
  the existing gap-review warnings).
- `cargo fmt --all -- --check`, `git diff --check`, and the canonical freezer
  `--check`: PASS.

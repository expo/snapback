# Independent implementation review: derived-fork requalification round 3

## Provenance and disposition

- **Reviewer family:** codex
- **Provider/runtime:** OpenAI Codex
- **Date:** 2026-08-07
- **Redacted:** no
- **Method:** independent delta/source review, independent digest reconstruction,
  adversarial fixture replay, and focused local verification
- **Round-2 baseline:**
  `review-codex.requalification-round2-2026-08-07.md`
- **Qualification candidate C:**
  `03f9d147cbf6798de2f74467cf5a2a3d8d3d756a`
- **Candidate committer date:** `2026-08-07`
  (`2026-08-07T18:01:25-07:00`)
- **Scoped implementation digest:**
  `sha256:582ed92c5aa69e1aac52a009e95680131de6f743b713035e29d2eec90602bed5`
- **Digest contract:** `snapback:agent-safe-implementation-tree:v3`
- **Canonical scope:** `src/`; `.gitmodules`; `Cargo.lock`; `Cargo.toml`;
  `build.rs`; `scripts/check-agent-safe-publication.mjs`;
  `scripts/generated-artifact-policy.mjs`;
  `scripts/local-proof-selection-policy.v1.json`; and the `vendor/ibex`
  gitlink, subject to the committed publication-cycle exclusions.
- **Reviewed delta:** the complete canonical-scope delta
  `622d61b9f29c18bdab3e4f0b23fa9de085eb3161..03f9d147cbf6798de2f74467cf5a2a3d8d3d756a`,
  plus the finding-4 test, lifecycle-emitter, and ticket changes.
- **Patch provenance:** `2d4d276d9` and its rebased candidate commit
  `c24ee93e1` have stable patch id
  `c48b246289a30706be158d936c0e63ab2ea88698`; `3c50c970e` and
  candidate HEAD `03f9d147c` have stable patch id
  `f9303a60d733beb70079429bb6b559014ee35323`.
- **Independence:** I did not open or consult another concurrent round-3
  review. This session did not author the candidate changes.

Finding 4 is closed to the bar in my round-2 review. The acceptance contract
can now admit a truthful fresh acceptance without replacing or backdating the
retained v1 artifact; current dated evidence is add-only at publication; and
the lifecycle emitter refuses a collision without changing the first bytes.
The three round-1 closures remain intact, and I found no new blocking defect in
the scoped delta. Candidate C is ready for the next qualification steps; this
review does not itself publish the capability or stand in for the still-needed
platform receipts, other-family review, or named-author acceptance.

## Finding 4 closure

### CLOSED — fresh acceptance is truthfully dated and cannot substitute the historical locator

The checker retains the 2026-08-06 chain separately as
`DERIVED_FORK_HISTORICAL_EVIDENCE` and admits a current v3 acceptance only at
`tests/acceptance/fixtures/instance-forks/author-acceptance.<date>.v3.json`
(`scripts/check-agent-safe-publication.mjs:30-55`). The locator date must be a
real ISO calendar date, and every current dated lifecycle, bounds, and
acceptance locator must be on or after qualification C's committer date and
absent from C (`:1141-1163`, `:1236-1248`). The acceptance validator derives
the required line from that locator and requires exactly
`Charlie Cheever — accepted <same date>`, while retaining the v3 C, digest,
scope, candidate, component, evidence-digest, and review-head bindings
(`:2062-2111`). C's committer date is 2026-08-07, so a truthful 2026-08-07 or
later record is admissible; a 2026-08-06 locator, a locator/line mismatch, or a
path already present at C refuses.

I re-attempted the round-2 substitution by making the current v3 receipt name
the historical
`author-acceptance.2026-08-06.v1.json` locator. The production validator
refused at receipt shape with `evidence 12 drifted`. The focused fixture run
also proved that a mismatched line date, pre-C acceptance, pre-C platform or
bounds dates, and a current locator pre-existing at C all refuse. The positive
synthetic v3 publication path, which uses the truthful 2026-08-07 locator and
line, passes in the complete checker suite.

I compared every one of the 13 retained historical evidence-chain files at
round-2 C and round-3 C. All are byte-identical. In particular, the retained
v1 acceptance remains
`sha256:82dbbcebe055f602d46b5fe5c64efc30fa460f459929d93014adf050c65f9e8c`;
the three 2026-08-06 lifecycle/bounds receipts remain respectively
`sha256:47c20cd5b05b4bdd5158d6cb1e3a651fc94611293afcc38df9b14c112999c38d`,
`sha256:e79d33fe1fdfe54aac823916145fad6528e5930c02a903dfbac0222ed12cdf1a`,
and
`sha256:bf73b3a6f09032fb166c25eea646c9f5170aab7301c43431ffe4eb21de886e4f`.

### CLOSED — evidence locators are append-only at the publication boundary

For the four dynamic current locator classes, `allowedPublicationPath`
recognizes only the exact dated filename grammars and
`allowedPublicationChange` accepts status `A` but rejects `M` (as well as all
other non-add statuses) (`scripts/check-agent-safe-publication.mjs:393-396`,
`:565-573`). The focused allowlist test exercised both results for both
platform paths, bounds, and acceptance. Independently, published semantics
require each selected current path not to exist at C, closing pre-existing-file
reuse. Receipt-bound paths, rather than fixed globals, are used for bounds,
platform, asset, review-history, and acceptance reads (`:1889-1904`,
`:1930-2059`, `:2114-2197`). There is no rolling locator for a later
requalification to overwrite.

### CLOSED — the lifecycle emitter mints with exclusive create

The bench now derives its filename date from UTC Unix days and opens the final
path with `OpenOptions::create_new(true)`, then writes and `sync_all`s it
(`tests/instance_fork_bench_v1.rs:103-136`, `:522-539`). The two focused Rust
regressions pass: UTC day 0 and 2000-01-01 map correctly, and a second write to
an existing dated path returns `AlreadyExists` while preserving the original
bytes exactly.

## Earlier closure regression check

1. **Round-1 finding 1 remains closed.** The canonical derived-fork scope is
   still closed and sorted; v3 receipt validation still requires canonical
   deep equality before review/evidence authority; acceptance still binds the
   same scope. The complete 95-test checker suite reran all ten noncanonical
   receipt-scope attacks and the acceptance-scope attack successfully.
2. **Round-1 finding 2 remains closed.** The transfer policy remains in scope,
   and the exact admitted frozen-record definitions, tracked record paths,
   trigger coverage, and regeneration commands are unchanged. The deletion,
   remapping, command-replacement, and post-C policy-tampering negatives all
   remain green in the complete checker suite.
3. **Round-1 finding 3 remains closed.** `src/instance_fork.rs` did not change
   in this delta. The full 52-test `instance_fork::tests::` filter passes,
   including same-ID publication and
   `conflicting_first_writers_accept_one_identity_before_mint_or_launch`.
   Exactly one conflicting identity remains accepted before mint or launch.

## Scoped-delta scan

The hash-relevant canonical-scope changes from round-2 C are the acceptance /
locator checker change and an unrelated one-line `src/manifest.rs` digest-pin
refresh. The two local-persistent-store JSON leaves under `src/` also changed
in ancestry but are committed publication-cycle exclusions; their carrier and
anchor digests agree, and the affected local-persistent-store conformance proof
reports published with `17 PASS / 0 GAP`, `8/8 PASS`, and `8/8 PASS`.

The finding-4 support delta contains the synthetic publication-fixture
updates, the UTC/exclusive-create lifecycle emitter, and the resolved
filesystem ticket. I inspected the complete changes, including receipt-shape
selection, date parsing/comparison, receipt-bound semantic reads, dynamic path
classification, acceptance construction, and collision behavior. I found no
claim widening, stale global-locator read, or new defect. The unrelated ambient
ancestry changes outside this review's canonical/support scope were not used as
evidence for the verdict.

## Execution record

- Independently reconstructed the v3 byte stream over 173 committed entries:
  exact dispatched digest
  `sha256:582ed92c5aa69e1aac52a009e95680131de6f743b713035e29d2eec90602bed5`.
  The production digest function returned the same value.
- Verified all 13 historical evidence-chain paths byte-for-byte between
  `622d61b9f` and C.
- Focused finding-4 fixture run: 6 passed, 0 failed (historical locator
  substitution, line-date mismatch, pre-C acceptance, pre-existing current
  acceptance, pre-C platform/bounds evidence, and A-versus-M allowlist).
- `node --test tests/agent_safe_publication_checker_v1.mjs`: 95 passed, 0
  failed.
- `node scripts/check-agent-safe-publication.mjs`: clean exit; both live
  records correctly report `withheld`.
- `scripts/bootstrap-ibex-runtime`: exact-link, launch, and restricted
  no-eval handler-VM qualification passed for C with a clean build stamp.
- Focused lifecycle-emitter Rust filter: 2 passed, 0 failed.
- `cargo test --lib instance_fork::tests:: -- --nocapture`: 52 passed, 0
  failed.
- Affected local-persistent-store publication conformance: passed.
- JS syntax checks and focused Rust formatting check: passed.
- `./ref-check --verbose`: 190 LLP documents, 4,059 refs, 0 errors, 0
  unchecked.
- `git diff --check 622d61b9f..03f9d147c`: clean.
- The worktree remained clean at detached candidate HEAD. I modified no
  repository file and did not push.

VERDICT: READY

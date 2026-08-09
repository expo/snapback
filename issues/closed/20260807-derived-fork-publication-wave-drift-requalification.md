# Requalify derived-fork publication after wave drift

**Status:** Closed
**Opened:** 2026-08-07
**Resolved:** 2026-08-09
**Owner:** Charlie Cheever
**Systems:** Instance forks, capability publication, LLP governance
**Related:** LLP 0158, LLP 0162, LLP 0185,
`issues/closed/20260806-derived-fork-publication-author-gate.md`

## Problem

Publication landing `7cada777b` validly bound qualification C `ad0ad5874` and
implementation digest
`sha256:fc6e3e58453b4700ce06c647aaef87132879e0da336e560eca834d1d42c5459a`.
The later wave integration changes nine covered proof/checker/metrology files.
The combined-tree oracle therefore refuses with publication digest
`sha256:5e6ed9beda2067a7da8dbb6a3a133f91f532bb4323fd6b24805be18d0a74e9ab`.

The changed leaves are not a fork runtime correctness regression. They are
still deliberately covered by the v2 digest, so this ticket must not exclude
them, weaken the custody rule, rewrite old review histories, or treat old
platform measurements as evidence for new bytes.

## Current posture

- The source anchor is `withheld` and the capability-index target is `none`.
- Historical receipt, carrier, platform measurements, review histories, and
  named-author acceptance remain retained but make no current claim.
- `agent_safe_derived_deployment_fork_v1` remains wholly `Missing` in every
  target manifest.
- No fork runtime code was changed as part of the withdrawal.

## Exit

1. Select a fresh qualification C containing the wave changes.
2. Produce fresh canonical release-profile lifecycle evidence on exactly
   `macos/aarch64` and `linux/x86_64`.
3. Obtain fresh independent review heads naming that exact C and digest.
4. Obtain named-author acceptance binding the new platform evidence, review
   heads, implementation digest, candidate facts, and component scope.
5. Rebuild the dated receipt/carrier/anchor chain atomically and move the
   capability-index row to `local` only after
   `node scripts/check-agent-safe-publication.mjs` reports the derived-fork
   record `published` on a clean tree.

## Author ruling — digest scoping under LLP 0189 (2026-08-07)

LLP 0189 D-3/D-4 supersede this ticket's "must not exclude them" constraint,
by the named author's own ruling: the fresh qualification digest is scoped to
the claim-relevant surface (fork runtime/CLI plus the checkers defining the
claim's semantics). Wave-shared proof/checker/metrology files may leave the
digest **only** in the same change that installs (or names the existing)
frozen-record drift gate covering each departing file — coverage moves, it
never vanishes. Custody rules, review-history integrity, and the prohibition
on rewriting old records are unchanged. The exit sequence stands, with step 1
amended: select the fresh C *after* the digest re-scope and the two deferred
checker-hardening tickets land, so this is the last wave-drift
requalification of this class.

## Requalification round 1 — findings and closure (2026-08-07)

Codex reviewed C `336a605bc808a340c71407c148af450789f420ad` / v3 digest
`sha256:c42666589ceea579e7ac6a635e3a4ef9b4f888a54b329c552929fff71c81ecf0`
and returned `NOT READY` on three blocking findings. Fable reviewed the same
bytes and returned `READY`, with F1/F2 converging on the two checker findings
and F3 requesting a legible residual scope classification.

Round-1 checker closure:

- The receipt can no longer choose its own derived-fork scope. Publication
  requires canonical deep equality with `DERIVED_FORK_IMPLEMENTATION_SCOPE`
  before review or evidence validation, and named-author acceptance binds the
  same exact scope.
- The transfer policy is now an in-scope checker input. The four admitted
  frozen-record gate definitions are exact, their record paths must exist in
  Git, their trigger rules must cover the transferred path, and their
  regeneration commands must match the registered commands. Policy deletion,
  record/trigger remapping, and regeneration-command replacement after C each
  invalidate the claim.
- The synthetic publication fixture uses the production scope. Negatives drop
  `src`, `vendor/ibex`, every explicit file, or replace the scope with another
  valid nonempty scope; each refuses at receipt validation before review or
  evidence can grant authority.

The fresh acceptance record is also required to name the residual v2→v3
departing class beyond the nine transfer-ledger files:
`packages/snapback-codegen/`, `packages/snapback-contract/`, and the remainder
of `tests/`. The checked v3 acceptance shape records that exact class and its
qualification-time/re-review disposition. Codex finding 3, first-writer-wins
app-root identity, is closed by the separate runtime change: a synced
same-directory temporary is atomically installed with a no-replace hard link,
the winner is compared on `AlreadyExists`, and the directory is fsynced after
temporary cleanup. Deterministic same-ID and conflicting-ID barrier tests prove
that same-ID writers both succeed with one file, while exactly one conflicting
identity is accepted and the loser returns
`SNAPBACK_FORK_APP_BINDING_MISMATCH` before either mint or launch. The original
32-writer regression passes, the full `instance_fork::` filter passes 52/52,
and `cargo test --test instance_fork_cli_v1 --no-run` compiles the live suite.

This closes the three round-1 implementation findings only. It does not publish
the capability or complete the ticket's fresh-C, evidence, review, acceptance,
and atomic publication exit sequence.

## Requalification round 2 — finding 4 and closure (2026-08-07)

Codex reviewed C `622d61b9f29c18bdab3e4f0b23fa9de085eb3161` / v3 digest
`sha256:f4c68ebfc0209659da01c91b30b82d2d54004e746e6683530778dc4f5413d612`
and verified all three round-1 closures. It returned `NOT READY` on one new
blocking provenance defect: the v3 checker still required the retained
`author-acceptance.2026-08-06.v1.json` locator and the old 2026-08-06 author
line while also requiring a fresh C/digest/scope. The three lifecycle/bounds
locators were pinned to the same historical date, and the lifecycle emitter
overwrote a same-date platform receipt.

The round-2 fix separates retained history from current authority:

- legacy v1/v2 receipts remain admissible only while withheld and continue to
  name the byte-retained 2026-08-06 evidence chain;
- a current v3 receipt names exact dated lifecycle, bounds, and
  `author-acceptance.<date>.v3.json` locators; every dated locator must be on or
  after qualification C's committer date, and the acceptance line's date must
  equal its own locator date;
- all semantic evidence reads use the exact paths bound by that receipt, so a
  later requalification appends new evidence rather than selecting or
  rewriting a rolling path; and
- the lifecycle bench now derives its UTC run date and uses exclusive-create
  output, with a regression proving a collision preserves the first bytes.
  The emitter defect is resolved in
  `issues/closed/20260807-lifecycle-bench-overwrites-dated-receipt.md`.

Synthetic publication fixtures now construct a truthful 2026-08-07 v3
acceptance. Negatives prove that rewriting/substituting the historical v1
locator refuses, a locator/line date mismatch refuses, a pre-C acceptance
refuses, and pre-C platform or bounds locators refuse. Both live publication
records remain `withheld`; this closure neither selects the next C nor supplies
the still-required real platform runs, review heads, or named-author
acceptance.

## Acceptance packet — round-3 qualification complete (2026-08-08 UTC)

Everything below is landed and verifiable; the sole remaining exit step is
the named author's fresh dated acceptance and the atomic publication rebuild.

- **Qualification C:** `03f9d147cbf6798de2f74467cf5a2a3d8d3d756a`
- **v3 scoped implementation digest:**
  `sha256:582ed92c5aa69e1aac52a009e95680131de6f743b713035e29d2eec90602bed5`
- **Scope classification (the author accepts this as part of the record):**
  roots `src/`; files `.gitmodules`, `Cargo.lock`, `Cargo.toml`, `build.rs`,
  `scripts/check-agent-safe-publication.mjs`,
  `scripts/generated-artifact-policy.mjs`,
  `scripts/local-proof-selection-policy.v1.json`, `vendor/ibex` (gitlink).
  Residual v2→v3 departing classes beyond the nine ledgered paths
  (`packages/snapback-codegen/`, `packages/snapback-contract/`, `tests/`)
  are classified in the v3 acceptance contract.
- **Review chain (all landed under `llp/reviews/`):** round 1 blind
  (codex NOT READY ×3 blockers / fable READY-conditional); round 2 delta
  (all round-1 blockers verified closed; codex NOT READY on acceptance
  provenance); round 3 delta (**dual READY**, both families, digest
  recomputed independently by each).
- **Platform evidence at exactly C (dated receipts in
  `tests/acceptance/`):**
  - macOS aarch64: `instance_fork::` 52/52, `fork_promotion::` 37/37,
    vm-egress 1/1, disk-pressure 1/1, live cli suite 5×15/15, row-13 bench
    pass with all ratified bounds
    (`instance-fork-lifecycle-bench.2026-08-08.macos-aarch64.v1.json`,
    sha256 `bbd8e488a9a3…0664d`).
  - Linux x86_64: 52/52, 37/37, vm-egress 1/1, live cli suite 3×15/15,
    row-13 bench pass
    (`instance-fork-lifecycle-bench.2026-08-08.linux-x86_64.v1.json`,
    sha256 `a2abe878b51f…2bed`).
  - Both platforms: a same-day bench rerun refused via exclusive-create —
    live proof of the append-only receipt contract.
- **Disclosures:** round-1 verdict split (codex blocking vs fable advisory
  on the same two custody findings) resolved by fixing to the stricter bar;
  three Low findings earmarked for the next legitimate checker rotation
  (R3-1 `%cs`-vs-UTC seam, false-refuse only; R3-2 historical evidence
  bytes are P-window-mutable, guarded by review discipline; R3-3 no upper
  bound on locator dates).

**Exit steps remaining:** named-author fresh dated v3 acceptance
(`author-acceptance.<date>.v3.json`, line "Charlie Cheever — accepted
<date>"), then the atomic receipt/carrier/anchor rebuild and the
capability-index flip to `local`, gated on
`node scripts/check-agent-safe-publication.mjs` reporting `published` on a
clean tree.

## Resolution — five-round requalification and publication (2026-08-09)

Charlie Cheever accepted the final supervised packet with exact line
`Charlie Cheever — accepted 2026-08-09`. The publication binds qualification
C `7b590a169b75839847c4755bbf0d4e7ae053cadd`, scoped digest version
`snapback:agent-safe-implementation-tree:v3`, implementation digest
`sha256:15db39c790471a1f0d6afcb447dd008662a0232cff3b1042e254fa798df75128`,
and the C-time selection-policy digest
`sha256:e17665f97846a0bf04b625be45c303fb5e3eb2c47ebd2fe0b537014bae27303a`.

The complete requalification chain is retained and appended as five
frozen-per-round entries in each Codex/Fable Spec and implementation verdict
history:

1. round 1 at `336a605bc808a340c71407c148af450789f420ad`
   (Codex `NOT_READY`, Fable `READY`);
2. round 2 at `622d61b9f29c18bdab3e4f0b23fa9de085eb3161`
   (Codex `NOT_READY`, Fable `READY`);
3. round 3 at `03f9d147cbf6798de2f74467cf5a2a3d8d3d756a`
   (dual `READY`);
4. final round at `772c00649534d68b2ba63b98699e8ce2b2019057`
   (dual `READY`); and
5. closing round at exact C
   `7b590a169b75839847c4755bbf0d4e7ae053cadd` (dual `READY` at the accepted
   digest).

Both required release-platform receipts bind exact C: macOS/aarch64 is
`sha256:311bdd18a063d98f203c2b425b3656fa31537eb7a3384a0acc76dc923cd837f2`
and Linux/x86_64 is
`sha256:7770fc5c9f1d2ce508ed0afa0225e81cf05244f98ab0244839739b155d66b775`.
The dated bounds-ratification locator carries the exact macOS receipt bytes.
The v3 acceptance binds all twelve non-self evidence digests and the four
17-round review-history heads; its artifact digest is
`sha256:e7e1e3443b7def4d3efe5e8c360bed1f9b2e3771741240971b4338df3584ba29`.

The rebuilt receipt, carrier, and source anchor publish the narrow
contributor-source local guide claim. The separate storage publication stays
`withheld`, and `agent_safe_derived_deployment_fork_v1` remains wholly
`Missing` in every target manifest. Released-binary/npm parity,
normal-installation, public-package, hosted/Cloudflare/remote, merge-back, and
process-containment claims remain open or explicitly absent.

Normal fleet landings after C changed scoped source, so the successful oracle
also reports `PUBLISHED_REQUALIFICATION_DUE` with `since` equal to C and the
exact changed paths. This is the honest standing state authorized by LLP 0189's
2026-08-09 D-3 clarification; no frozen-chain integrity failure is present.

R3-1 (`%cs`/UTC seam), R3-2 (historical-evidence P-window mutability), R3-3
(no locator future-date ceiling), N-1 (unrelated in-scope sibling carrier
churn), and N-2 (due-warning ticket/escalation automation) remain non-blocking
findings for the next legitimate checker rotation. They are not closed by this
publication.

## Final publication record — seven-round chain (2026-08-09)

The two earlier local P attempts recorded in `../publication-REPORT.md` and
`../publication-final-REPORT.md` did not land on `origin/main`. This dated
record supersedes their qualification, digest, receipt, and review-head values
without rewriting the preserved attempt record above.

Charlie Cheever accepted the final packet in a supervised session with exact
line `Charlie Cheever — accepted 2026-08-09`. Publication P binds qualification
C `04332ab8b73799bd3279b3150dbd8598df275530`, scoped digest version
`snapback:agent-safe-implementation-tree:v3`, implementation digest
`sha256:42d8fdccbe42ed3699da014f1c3ec68aa8fd05ca99de423310b6a6885190708f`,
and qualification-C selection-policy digest
`sha256:9221291f95c690d455be3240b342010216b7e1b470cf21aba53104408a3f9075`.

The complete retained requalification sequence is appended frozen-per-round
to each Codex/Fable Spec and implementation history:

1. round 1 at `336a605bc808a340c71407c148af450789f420ad`
   (Codex `NOT_READY`, Fable `READY`);
2. round 2 at `622d61b9f29c18bdab3e4f0b23fa9de085eb3161`
   (Codex `NOT_READY`, Fable `READY`);
3. round 3 at `03f9d147cbf6798de2f74467cf5a2a3d8d3d756a`
   (dual `READY`);
4. final round at `772c00649534d68b2ba63b98699e8ce2b2019057`
   (dual `READY`);
5. closing round at `7b590a169b75839847c4755bbf0d4e7ae053cadd`
   (dual `READY`);
6. publication-C round at `866f5d025645ce20a9149d8ea20032bd2f31c9b0`
   (Codex `NOT_READY`, Fable `READY`); and
7. publication-C2 round at exact C
   `04332ab8b73799bd3279b3150dbd8598df275530` (dual `READY`).

All four histories now contain 19 rounds. Their accepted pubC2 head entry
digests are:

- Spec Codex:
  `sha256:5f09bd785c42be0b3615ed7c9257662c0f7dbe75fd305cb60b3dc0353be0fb9c`;
- Spec Fable:
  `sha256:00498fa5ed660d5c9fba91e0f7e0093560636429c364e5507282a5fdae0309ba`;
- implementation Codex:
  `sha256:dd0bc18349e0e997b784188a078fad6645b10b1fcbd1b04ce68268bb6130b00f`;
  and
- implementation Fable:
  `sha256:636023a4220ec444dcf971d871d6bd72f5d09cf8da3c44d3aa70adec34a36e91`.

Both canonical release-platform receipts bind exact C: macOS/aarch64 is
`sha256:34dd3421ba779f6bc5064230903f5dd100ef4e160802ec01a2e7c7ff0b02fa74`
and Linux/x86_64 is
`sha256:f564f0bfc8fe6c5609a3cfec8a3dfb2127216b156c41df58e6c816b450e8dcd0`.
The dated bounds locator carries the exact macOS bytes and the unchanged
2026-08-06 ratified bounds. The v3 author-acceptance artifact digest is
`sha256:e775e163d5ab385220187ae82cd72794c6de7a1cd81215dfca7b2e9394b168f0`;
the publication receipt digest is
`sha256:15438d4cb27d90226debc2c3ce6a0d776d35b846e2419405a046c9c876edd4ff`.

The clean-tree oracle reports the derived-fork record `published` and the
separate storage record `withheld`. It also honestly reports
`PUBLISHED_REQUALIFICATION_DUE` since C for these post-C scoped changes:

- `src/local-persistent-store-publication.anchor.v1.json`;
- `src/local-persistent-store-publication.v1.json`;
- `src/local-relation-activity-publication.v1.json`;
- `src/local-sequence-allocation-publication.v1.json`;
- `src/local.rs`;
- `src/manifest.rs`;
- `src/storage.rs`;
- added `src/storage/asset_attempts.rs`; and
- `src/storage/asset_maintenance.rs`.

Publication P does not modify or restore any of the four sibling publication
carriers; they remain byte-identical to `origin/main`, under their own frozen
drift gates. No frozen fork-chain integrity failure is present. The narrow
contributor-source local guide claim is published; the target-manifest tuple
remains wholly `Missing`, and released-binary/npm parity,
normal-installation, public-package, hosted/Cloudflare/remote, merge-back, and
process containment remain nonclaims.

R3-1, R3-2, R3-3, N-1, and N-2 remain open, non-blocking findings for the next
legitimate checker rotation. This final publication does not close them.

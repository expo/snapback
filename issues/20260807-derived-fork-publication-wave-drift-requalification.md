# Requalify derived-fork publication after wave drift

**Status:** Open
**Opened:** 2026-08-07
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

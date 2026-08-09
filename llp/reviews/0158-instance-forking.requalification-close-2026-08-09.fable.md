# Review: derived-fork requalification closing delta, commit 7b590a169

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-09
**Redacted:** no
**Reviewed commit (closing qualification C):**
`7b590a169b75839847c4755bbf0d4e7ae053cadd`
**Implementation tree SHA-256 (v3 scoped):**
`sha256:15db39c790471a1f0d6afcb447dd008662a0232cff3b1042e254fa798df75128`
**Digest version:** `snapback:agent-safe-implementation-tree:v3` (scope
unchanged from the final round)

**Method:** declared **delta round** on my rounds 1–3 and final heads (all
READY). No codex review was read. I read the due-state commit
(`7b590a169`) in full and attacked its leniency boundary by construction;
enumerated the complete `772c00649..7b590a169` scoped delta; ran a
line-conservation analysis over the LLP 0199 god-file split commits; and
re-verified every prior closure. Node checks executed here; Rust
execution is supervisor-supplied.

**Execution evidence produced in this worktree:** digest recomputed with
this C's own checker = `sha256:15db39c7…5128`, matching the commission
exactly; clean-tree checker run reports both records `withheld`; unit
suite **99/99 pass** (was 97; the two new fixtures are
published-stands-with-due and tamper-still-refuses-on-due).

**Reliance statement.** All Rust execution — fork CLI suites, instance-
fork/fork-promotion module tests, and the row-13 dual-platform bench — is
outside this worktree's reach. My verdict relies on the
**supervisor-supplied dual-platform execution evidence at exactly
`7b590a169`** for every claim of that class.

**Commission-vs-tree note (material, stated plainly).** The commission
describes the remaining fleet delta as "src/assets.rs,
src/contract_types.rs, src/lib.rs, two src/ publication JSONs". The
actual scoped delta is much larger: the LLP 0199 god-file split series
(`cli.rs` → `src/cli/{fork,config_command,guide_command,migration,tests}.rs`,
plus `local.rs`, `server.rs`, `storage.rs` splits and the `realtime.rs`
extraction), a 35-type move out of `manifest.rs`, a visibility-tightening
commit, and one genuinely semantic commit (the asset finalize
prepare/commit seam, `b60e477e5`). I reviewed the tree, not the summary;
my findings below cover the real delta.

---

## 1. The due-state boundary — I could not construct an abuse

The change is surgically narrow. `evaluateClaimSnapshot` gains
`allowRequalificationDue` (default false — every other caller, including
all prior fixtures, is byte-for-byte unchanged in behavior), and
`assertQualifiedImplementationDigestAtPublication` relaxes **exactly one
predicate**: the publication-tree digest may differ from the receipt
digest only when (a) the record is `agent_safe_derived_deployment_fork_v1`
and (b) the C→P diff names at least one concrete scoped change. Every
abuse shape I attempted refuses:

- **C-side digest lie:** `qualificationDigest !== expectedDigest` refuses
  unconditionally — the due path cannot launder a receipt that misstates
  what was qualified at C.
- **P mismatch with no named scoped change** (scope/receipt
  inconsistency): `requalificationDue` is only minted when
  `scopedChanges.length > 0`, so the "none detected between C and P
  (receipt or digest scope is inconsistent)" arm still refuses.
- **Chain-artifact tampering on a due record:** the evidence-bytes loop
  (`sha256(live file) !== binding.sha256`) runs **before** the digest
  assertion and is untouched; the acceptance's digest equality is
  computed at C (`implementationDigestAt(root, C, scope)`), so it is
  immune to P-side evolution and still refuses forgery; frozen-per-round
  prose bindings, legacy verdict codes, C-ancestry (`merge-base
  --is-ancestor`), the canonical-scope deep equality, and the C-bound
  selection-policy pin are all unconditional. I traced the full
  `validatePublicationRecord` order: the due branch relaxes one
  comparison and short-circuits nothing — no later check is skipped, so
  ordering cannot mask an integrity refusal. The new fixture proves the
  evidence-bytes case with due pending; my code reading extends the same
  conclusion to every other binding, since none consults the due flag.
- **Withheld leniency:** none. The withheld short-circuit sits before any
  snapshot evaluation; `allowRequalificationDue` is only reachable in the
  published branch. Withheld behavior is byte-identical.
- **Storage-record leniency:** none — the flag is gated on the derived
  record id at both call sites.
- **Silent standing:** impossible — the due state is a typed
  `requalificationDue{scopedChanges, since=C}` field on the result plus
  an unconditional `WARNING <id>:PUBLISHED_REQUALIFICATION_DUE` on
  stderr naming every changed path. `since` names C, which is what
  D-3's four-battery escalation needs to key on.

Design assessment: this implements what LLP 0189 D-3 already says
("requalification happens on the next natural cycle … not as an emergency
that races the fleet"; the pending marker is the mandatory demotion
mechanism), where the previous implementation enforced a stricter rule
D-3 never asked for — one empirically proven unsatisfiable at fleet
velocity three times. The claim's factual content (qualification at C)
remains true under post-C landings; what changes is that the marker, not
withdrawal, carries the staleness. One reporting subtlety, correct but
worth recording: on a due record `result.implementationDigest` is the
*evolved P* digest (which is what the clean-working-tree comparison in
`runChecker` checks against), while the qualified digest stays in the
receipt — checkout integrity and qualification identity are separately
represented.

## 2. The remaining scoped fleet delta

- **The god-file splits are pure moves.** My line-conservation analysis
  (whitespace-stripped added/removed multiset comparison per commit):
  cli split 20,200 moved lines with 26/60 unmatched, local split 58,313
  with 14/43, server split 53,780 with 55/75, storage split 40,940 with
  22/154, realtime extraction 264 with 6/26, types move 1,082 with
  10/20 — and every unmatched sample I inspected is reflowed signatures/
  struct braces from the move, `mod`/`use`/visibility scaffolding, or
  (storage split) the legitimately re-minted publication-carrier digest
  pins whose drift is covered by the committed fix-forward record
  (`eb976f423`). No behavioral line appears or disappears.
- **Claim anchors survive the moves**, verified in the split tree: the
  fork CLI lives in `src/cli/fork.rs` with `configure_detached_child`,
  the `deny-all-v1` posture strings, database-sibling admin-token
  binding; `install_app_root_identity_sync` (`src/instance_fork.rs:233,
  1404`), `replace_bytes_sync` (`:1494`), nested-fork refusal,
  `promotable: false`, and the fail-closed `for_derived_host_op` egress
  wiring at both dispatch sites (`src/local.rs:3271`,
  `src/server.rs:1412`) are all present. `src/instance_fork.rs` itself
  is not in this delta.
- **The one semantic commit** (`b60e477e5`, asset finalize
  prepare/commit seam, ~921 diff lines) restructures upload
  finalization in `assets.rs` with idempotent blob puts, planned-
  publication records, and digest/byte-length verification on copy —
  hardening in character. The fork-side asset custody
  (`copy_fork_private_assets`, digest-and-length-verified same-cut copy
  with torn-cut refusal) is in `instance_fork.rs` and untouched; a
  planned-but-uncommitted publication is not a committed asset row, so
  the fork cut's referenced-blob copy surface is unchanged. Reviewed at
  moderate depth; nothing claim-adverse found.
- `contract_types.rs`/`lib.rs` changes are the type moves and module
  wiring for the splits; the two non-persistent-store publication JSONs
  (`local-relation-activity`, `local-sequence-allocation`) are ordinary
  carrier refreshes — see N-1.

## 3. Prior closures at this C

All survive (17 anchor matches for the closure constructs in the
checker, individually confirmed): canonical-scope deep equality, the
admitted-gates mirror with the C-bound `selectionPolicySha256` pin (round
F1 — I re-verified the wrong-pin and C-bound behaviors at the final
round; the due commit does not touch that code), `residualV2DepartingClass`
in the v3 acceptance, frozen-per-round prose history with the closed
legacy enumeration, dated append-only evidence locators with the
locator-derived author line, A-only publication custody for fresh dated
evidence, install-once first-writer-wins identity, and atomic evidence
publication. Carried papercuts R3-1/R3-2/R3-3 remain open and unchanged.

## Findings (non-blocking)

**N-1 — Low. Two sibling publication carriers are in-digest and churn on
unrelated cycles.** `src/local-relation-activity-publication.v1.json` and
`src/local-sequence-allocation-publication.v1.json` are not in
`PUBLICATION_CYCLE_ALLOWLIST` (the persistent-store carrier is), so their
routine refreshes rotate the derived-fork digest and will now surface as
recurring `PUBLISHED_REQUALIFICATION_DUE` noise with no fork relevance.
Harmless under the due semantics, but avoidable: move them to the
allowlist (with their own receipt-digest custody, as the persistent-store
trio already has) at the next legitimate checker rotation, alongside
R3-1/R3-2/R3-3.

**N-2 — Note.** The due warning's usefulness depends on operators
watching stderr of checker runs; wiring it into the D-1 battery-red
ticket automation (the still-open piece 3) is the natural completion so
four-battery escalation actually triggers.

---

## Verdict

The due-state change is the narrowest possible implementation of the
author's D-3 ruling: one predicate relaxed, for one record, only when
concrete scoped changes are named, with a typed marker and a conspicuous
warning — and every integrity binding I could think to attack (C-side
digest, evidence bytes, acceptance equalities, prose freeze, ancestry,
scope equality, policy pin, withheld posture, storage record) remains
fail-closed, confirmed by fixtures and by tracing that no check is
skipped or reordered. The remaining fleet delta is mechanical module
splitting (verified conservation), one asset-finalize hardening commit
that does not touch fork custody, and carrier refreshes. All prior
closures stand. Conditional on the supervisor-supplied dual-platform
execution evidence green at exactly
`7b590a169b75839847c4755bbf0d4e7ae053cadd`:

**Verdict: READY** — no blocking findings; N-1/N-2 and the carried
R3-1/R3-2/R3-3 papercuts are non-blocking record items for the next
legitimate checker rotation.

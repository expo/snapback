# Codex-family closing delta review — derived-fork requalification true C

## Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex
- **Date:** 2026-08-09
- **Redacted:** no
- **Method:** independent delta/source review, independent v3 digest reconstruction,
  control-flow and trust-boundary audit, complete checker execution, and focused
  adversarial fixture replay
- **Prior Codex head:** READY at
  `772c00649534d68b2ba63b98699e8ce2b2019057`
- **Candidate C:**
  `7b590a169b75839847c4755bbf0d4e7ae053cadd`
- **Scoped v3 digest:**
  `sha256:15db39c790471a1f0d6afcb447dd008662a0232cff3b1042e254fa798df75128`
- **Digest contract:** `snapback:agent-safe-implementation-tree:v3`
- **Independence:** I consulted only my four named prior Codex review heads. I
  did not consult another concurrent review. This session did not author the
  candidate changes.

## Overall assessment

I found no blocking regression in `772c00649..7b590a169`. The candidate
implements the 2026-08-09 LLP 0189 D-3 clarification at the exact intended
boundary: only an already-published derived-fork record may turn post-C scoped
source evolution into a typed `requalificationDue` state. A qualification-C
digest mismatch, noncanonical scope, receipt/carrier/anchor inconsistency,
evidence mismatch, historical review-byte rewrite, named-author mismatch, or
non-ancestor C still refuses. Withheld records and the storage claim do not
receive the exception.

The 26-commit total delta contains eight ordinary commits that touch the v3
scope and the final D-3 commit. The ordinary changes rotate the scoped digest,
as they should, but do not weaken the narrow derived-fork invariants. Candidate
C is ready for the remaining qualification evidence and publication steps;
this review is not itself a platform receipt, named-author acceptance, or
publication action.

## 1. Independent candidate and digest verification

The checked-out detached `HEAD` is exactly candidate C. I independently
reconstructed the v3 preimage rather than relying only on the checker export:

1. enumerated the committed `src/` tree and the seven explicit scope files;
2. removed the six exact publication-cycle leaves admitted by the checker;
3. sorted the remaining 198 entries by repository-relative path;
4. hashed the v3 domain line, exact canonical scope JSON, and each entry's
   mode, type, path, big-endian byte length, and committed blob/gitlink bytes.

That reconstruction produced
`sha256:15db39c790471a1f0d6afcb447dd008662a0232cff3b1042e254fa798df75128`.
The production `implementationDigestAt` function independently returned the
same value.

## 2. D-3 due-state trust boundary

### Exactly scoped leniency

`evaluateClaimSnapshot` creates `requalificationDue` only when the caller
explicitly sets `allowRequalificationDue` and the C-to-P diff contains at least
one claim-scoped change (`scripts/check-agent-safe-publication.mjs:676`).
`validatePublicationRecord` supplies that flag only for capability id
`agent_safe_derived_deployment_fork_v1`, and only after the anchor has been
validated as `published`; the withheld branch returns before snapshot/digest
evaluation (`:2272`, `:2347`, `:2353`). The storage record therefore retains
strict generic custody.

The resulting record remains `state: published`, its snapshot remains
`state: stands`, and both carry the exact typed payload
`{ scopedChanges, since: qualificationCommit }`. The CLI emits the exact
`PUBLISHED_REQUALIFICATION_DUE` warning on stderr while retaining a successful
exit (`:2496`).

### Qualification identity cannot rotate to P

`assertQualifiedImplementationDigestAtPublication` still requires the digest
recomputed at C to equal the receipt unconditionally (`:1081`). It relaxes
only the publication-P digest comparison, and only when the same C-to-P tree
diff produced a nonempty due state. A receipt rotated to P cannot pass by
claiming the newer digest, because the independent C comparison fails first.
Mode-only changes, symlink/type swaps, additions/deletions, and the Ibex
gitlink all appear in the scoped name-status set and remain visible.

### Frozen-chain failures are not masked

The production validation order remains fail-closed:

1. canonical anchor/carrier/receipt parsing and exact shapes;
2. anchor-to-carrier and carrier-to-receipt SHA-256 bindings;
3. exact candidate, component, v3 digest-version, canonical scope, and
   selection-policy bindings;
4. every receipt evidence byte digest;
5. C ancestry;
6. qualification-C digest, followed by the narrowly relaxed P comparison;
7. the complete platform/bounds/review/named-author semantic validation
   (`validatePublishedEvidenceSemantics` is still called unconditionally at
   `:2355`).

Thus a pending due state cannot bypass a chain failure that occurs before it,
and cannot short-circuit the semantic checks that follow it. The fully rebound
historical-prose fixture remains important: even after review, verdict,
acceptance, receipt, carrier, and anchor hashes are recomputed consistently,
the per-round frozen-byte digest catches the rewrite. The new pending-due
fixture separately proves direct historical evidence tampering still fails.

The checker does not itself implement the scheduled ticket filer or four-run
aging/escalation mechanism. LLP 0189's implementation ticket continues to
track that repository-wide battery automation as open. I do not treat that as
a defect in this candidate's narrower author-ruled contract, which is the
typed visible state plus conspicuous warning consumed by that automation.

## 3. Ordinary scoped fleet delta

The eight pre-fix scoped commits are ownership/refactoring work:

- storage, server, and local god-file splits move implementations and tests
  into submodules; the relation-activity and sequence-allocation JSON records
  refresh their exact source inventories for the storage split;
- the asset-finalization prepare/commit seam moves database-free preparation
  into `src/assets.rs` without changing the fork asset-copy authority or the
  derived fork publication protocol;
- the contract/type leaf moves dependency-free manifest DTOs without changing
  their serde/wire shapes;
- the realtime leaf moves fan-out state and stats without changing fork
  runtime authority;
- the `src/lib.rs` visibility tightening leaves `instance_fork` and
  `fork_promotion` public as before and only demotes unrelated internal façade
  modules;
- the CLI split moves the fork command implementation to `src/cli/fork.rs`.
  Comparing the complete old `fn fork_root` through pre-next-function region
  against the new module, after normalizing only the deliberate `pub(crate)`
  re-exports, was byte-identical except for one leading blank line.

No ordinary commit in this range changes `src/instance_fork.rs`,
`src/fork_promotion.rs`, or `src/instance_lock.rs`. I found no change to
deny-all host-operation classification, finite TTL/renewal ceilings,
non-promotable lineage, first-writer-wins app identity, host-mediated
isolation, atomic publication ordering, or exact reap/drop authority.

## Verification record

- Candidate identity: exact C confirmed.
- Independent 198-entry v3 digest reconstruction: exact expected digest.
- Production digest recomputation: same exact digest.
- `node --test tests/agent_safe_publication_checker_v1.mjs`: **99 passed, 0
  failed**.
- Focused boundary matrix: **10 passed, 0 failed**. It covered published
  one-byte scoped evolution becoming due; historical evidence tamper while
  due; withheld behavior; withheld anchor authority smuggling; noncanonical
  receipt scope; named-author scope mismatch; historical-acceptance locator
  reuse; invalid/uppercase/sibling ancestry; receipt rotation to P; and the
  generic strict C-receipt/P-drift case.
- `node scripts/check-agent-safe-publication.mjs`: clean exit; both current
  live records correctly remain `withheld` before the fresh publication
  ceremony.
- JS syntax checks for checker and fixture: passed.
- Exact D-3 commit `git diff --check`: passed.
- Full `772c00649..C` `git diff --check` reports unrelated fleet whitespace
  and blank-at-EOF findings; none is in the D-3 patch or changes a fork claim
  invariant.
- The repository worktree remained clean. I modified no repository file and
  did not push.

READY

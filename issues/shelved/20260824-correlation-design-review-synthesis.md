# Correlation design: two independent reviews, one converged flaw

Status: open
Date: 2026-08-24
Systems: snapback-sync, snapback-engine, snapback-kernel
Related: issues/shelved/20260823-mandatory-authority-correlation-design.md,
  issues/shelved/20260823-uncorrelated-authority-axes-are-systemic-153-sites.md,
  issues/closed/20260823-capsule-landing1-fix-moved-the-seam-not-closed-it.md

## Gate result: adopt with changes (both reviewers)

codex and grok reviewed the mandatory-correlation design independently; neither saw the
other's review. Both returned **adopt with changes**, and both identified the **same central
flaw** without prompting from each other.

- grok: *"Until (1) and (2) are written as type rules rather than sink-writing advice,
  implementing this document will produce capsule landing 4."*
- codex: *"The opaque carrier does escape the rejected third-occurrence critique — but only if
  the staging API itself accepts the carrier and every carrier-independent staging sibling is
  removed."*

Independent convergence on the same remedy is the strongest evidence this session has produced.

## The flaw

Pairing subject and reservation in one opaque carrier does **not** bind them if a sink can still
stage using a separately supplied `&PreparedAuthority` and commit with the carrier. The design
forbids the extra-subject signature in prose, but prose is a review rule, not a language
invariant: nothing stops `fn f(bound: BoundAuthorizedEffect, extra: &PreparedAuthority)` or a
closure capturing `subject_A`.

This is exactly how capsule landing 1 failed three times —
`LocalSnapback::stage_watch_management` (`crates/snapback-engine/src/local/engine.rs:25073`)
validates only its own authority's admission and source and never compares it to the carrier
that commits. A design that leaves that shape legal reproduces the defect it was written to end.

**Required change:** staging must become a consuming operation on the carrier
(`bound.stage_*(...)`), and every carrier-independent staging sibling must be *removed or made
unreachable, not merely wrapped*, with a compile-fail attack for any survivor. The complete set
of such entry points is being inventoried in
`issues/20260824-uncorrelated-staging-entry-point-inventory.md` (in flight); that inventory is
the work-list and the completion criterion.

## codex-only findings

- **Phase 5 is not currently supportable.** Even with zero legacy guard rows, publication
  substitution lets the caller's authority terminate while an independently attached
  publication/service fence keeps the carrier live. Mode/operator constructors are also
  insufficiently closed.
- **Weakest load-bearing assumption:** that "one prepared-authority root" already means one
  completely assembled authority including every retained publication/service/rehearsal guard.
  **Actual code disproves this today.** Amend that boundary and the non-caller factories, and
  the carrier plus typed final-cut design is the right direction.
- Phase 2 is honest only if every alternate raw/generic commit entry for a kernel family is
  removed in the same landing — removing one `BeforeCommit` signature while a sibling reaches
  the same transaction is not leaf closure.
- Phase 0's registry must not record "153 sites" as one semantic population.

## grok-only findings

Seal the retention generic `R` (no `CorrelatedCommitGuard<()>`; add `'a`). Closed-carrier
constructors must not be `pub(crate)` in kernel or a leaf server. No public
`AuthorityOrigin::mint` on the kernel API. Single admission acquire, last, with nothing above
holding an `AdmissionEffectGuard`; phase 1's two-arg form must stop acquiring in the same commit
phase 2 starts. `inherit_for(LiveRerun)` needs a fresh origin, matching `prepare_rerun`.

*Caveat:* grok's output was corrupted mid-file (interleaved garbage, roughly lines 345-660). Its
head and tail are coherent and are what is recorded here. Its middle-section findings are
**unread, not cleared**, and should be re-requested before the revision is considered complete.

## Agreed and unchanged

Both reviewers endorse rejecting the two-argument `commit_guard(effect, &subject_authority)` as
the terminal API — the proposal I originally recommended. It survives only as a migration
ratchet. The corrected population does not change the architecture: all forwarding occurrences
still need signature propagation, but only **eight** kernel cuts need new commit semantics. The
corrected raw-guard mechanism (borrowed reference, guard stays alive) does not remove those
sites from scope; it narrows their defect to correlation and makes the non-reentrant migration
constraint *stricter*.

## Next

Revise the design against both review sets before any implementation. Do not begin Phase 0 until
the revision lands and the staging inventory is complete.

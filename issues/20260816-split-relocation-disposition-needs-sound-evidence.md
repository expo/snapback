# owngate: split-relocation disposition needs sound evidence

**Status:** Open
**State:** needs-design
**Date:** 2026-08-16
**Systems:** Proof/gates, LLP governance
**Related:** `issues/20260810-owngate-split-relocation-disposition-gap.md`,
LLP 0225 §2 and §5

## Goal

Give the ownership gate a sound way to carry a predecessor disposition and
its obligations across any justified fingerprint-changing transition,
including god-file edge-key splits and owner reassignment. This is needed to
make continued `src/local.rs` drainage and owner re-keying describe
pre-existing coupling honestly without weakening the ownership ratchet.

No `split-relocation` disposition is currently accepted or implemented. Until
this ticket produces a reviewed design, edge-key splits remain time-bounded
waivers exactly as on `origin/main`.

The attempted owner-reassignment extension to ordinary `relocation` is also
removed. Until the same design bar is met, an owner re-key that changes a
fingerprint is not silently admitted as relocation, even when its module
endpoints are unchanged.

## Three-round finding history

Round 1 rejected endpoint assertions and incomplete transition validation:

- A retained frozen predecessor plus one shared endpoint admitted unrelated
  new coupling; sharing an endpoint did not prove that the new module derived
  from the predecessor module.
- An unchanged fingerprint could change from `time-bounded-waiver` to
  `split-relocation` without entering the baseline-growth validator, silently
  shedding the deadline and inversion owner.

Round 2 rejected assertion-based lineage and unconstrained discharge:

- A pre-existing unrelated module could add a manifest `extractedFrom` claim
  and be accepted as derived from the god file. The assertion proved only that
  two current paths were assigned, not that code or coupling moved.
- An unchanged waiver could be rewritten as `analyzer-upgrade` while carrying
  an exact `dischargedWaiver` record. Because the edge already existed in the
  predecessor graph, the analyzer-upgrade predicate admitted it and removed
  the obligation without proving an analyzer discovery.

Round 3 rejected name-only Git evidence and successor-keyed waiver lookup:

- Top-level symbol-name overlap admitted unrelated lineage when a name was
  removed from the predecessor module and an unrelated declaration with the
  same name appeared in the successor. A coincidental name is not content or
  edge derivation evidence.
- Renaming a module laundered a time-bounded waiver into ordinary relocation.
  The old path-based fingerprint disappeared, and mandatory-discharge logic
  looked up the successor fingerprint rather than the relocation record's
  predecessor fingerprint, so the predecessor waiver was invisible. The
  sanctioned `--update-baseline` path completed both attacks; neither needed a
  hand-edited baseline.

The post-round Codex confirm-review found the same laundering class in the
owner-reassignment path. Reproduction: the predecessor is a deadline-bearing
`time-bounded-waiver` for `service` (`sync-realtime-engine`) → `other`
(`background-services`); the current graph retains those exact module
endpoints but reassigns an owner and records the successor as `relocation`.
The exact-endpoint path validated only that the predecessor fingerprint was
removed and the endpoints remained. It never checked the predecessor
disposition, so the protocol returned `introduced: []` and `inherited: []`
while silently dropping the waiver deadline and inversion owner.

## Design bar

Derivation and discharge must be proven from Git content **and history** in a
way that neither a rename nor a coincidental symbol name can satisfy. Evidence
must establish the lineage of the coupling being re-keyed, not merely file
absence, a manifest assertion, an endpoint match, or declaration-name overlap.

For every successor disposition that names a predecessor, the
predecessor-disposition lookup must key on the **predecessor fingerprint**, not
the successor's fingerprint. A time-bounded waiver may lose its inversion
owner or deadline only after the protocol proves that exact predecessor
obligation was soundly discharged.

More generally, every disposition or relocation that changes a fingerprint
must carry forward the predecessor's disposition and all of its obligations,
including deadline and inversion owner, keyed on the predecessor fingerprint.
Endpoint equality, owner-pair equality, file absence, or successor-only lookup
cannot by itself discharge or replace those obligations.

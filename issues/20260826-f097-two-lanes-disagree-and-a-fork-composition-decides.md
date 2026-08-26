# Two lanes disagree about F097, and a fork composition decides it

**Status:** open — blocks any F097 closure claim
**Found:** 2026-08-26, by comparing two independently-run lanes that both reached F097.

## The disagreement

Two lanes worked F097 from different directions and reached opposite conclusions:

| Lane | Verdict | Basis |
|---|---|---|
| `f127` (HEAD `6eb0a14fd`) | **"F097: proven closed"** | Four witnesses that compiled in 14 feature cells now refuse with `E0599` at the marked expression; full corpus 26 rows × 2 cells, zero mismatches. |
| `rowfam` (HEAD `377bc5f07`) | **"F097 does not close"** | An LLP-orientation pass prompted a **fork composition, which succeeded.** The same lane closes F122 and declines to claim F127. |

Both lanes are otherwise careful — `f127` explicitly declined F210/F212/F213 and F215 for lack of
row-specific evidence, and `rowfam` explicitly declined F127. Neither looks like overclaiming. They
simply tested different things.

## Why the fork composition probably wins

`f127`'s evidence is compile-fail witnesses: they prove the *spellings* are gone across 14 cells. Per
LLP 0303 revision (s), that proves a spelling is gone, not a capability. A fork composition is a
**runtime** route and would not be caught by any compile-fail witness, however many cells it spans.

LLP 0303 revision (t) is the governing rule: inherited graphs must fail closed in the child via a
private creator-process identity compared against the CURRENT process. Until recently nothing in the
tree enforced that — `Arc::ptr_eq` was open-coded as an identity check at ~20 sites and fails open
across `fork()`, because a child inherits pointers identical to its parent's and therefore compares
*equal*.

## Likely resolution, to be verified rather than assumed

The `forkseam` lane introduced `crates/snapback-kernel/src/process_bound_identity.rs`, whose equality
reads the current process at comparison time and requires **both** sides' creator to match it, with a
`pthread_atfork` hook advancing a private lineage generation so PID reuse cannot resurrect an inherited
identity. It converted `DatabaseBinding` and all `storage.rs` sites, and censused **48 remaining
sites, 30 of them authorization/custody guards**.

If F097's publication path is among those 48 censused-but-unconverted sites, then the honest sequence
is: convert that site to the process-bound primitive, re-run `rowfam`'s fork composition, and only then
claim F097.

## What must happen before F097 is claimed

1. Obtain `rowfam`'s exact fork composition and run it against `f127`'s tree. A closure claim that has
   not survived it is not evidence.
2. Determine whether F097's path appears in
   `issues/20260826-fork-identity-primitive-census.md` as remaining.
3. Do not land an F097 `Closes-rows` trailer from either lane until this is settled. F122 (rowfam) and
   F127 (f127) are unaffected and can proceed on their own evidence.

## Why this matters beyond one row

This is the third time in this programme that a row looked closed under one class of evidence and open
under another — the corpus reported F170 CLOSED while a second `LocalDatabase` handle reached the same
effect, and settlement is currently mismeasured as safe because its witness refuses an obsolete
spelling. **Compile-fail witnesses and runtime compositions are not interchangeable, and a row is only
as closed as the weaker of the two.**

## Related

- `issues/20260826-allocation-identity-fails-open-across-fork.md`
- `issues/20260826-fork-identity-primitive-census.md` (lands with the `forkseam` change)
- `issues/20260826-authorization-denominator-and-seam-map.md` — F127 seam holds F097 plus four others
- LLP 0303 revisions (s) and (t)

## Addendum, same day: fork is a general route, not an F097 quirk

A second, unrelated lane (`addradm`, HEAD `a4dedb174`) independently reported a succeeding fork
composition on a different row:

> F070 remains **OPEN**: fork inheritance succeeds, and a field-by-field rebuilt public catalog
> plan commits and yields a resolvable bearer.

Two lanes working different rows, neither aware of the other, both found that inherited state
survives `fork()` and is accepted. That reclassifies the finding: **fork is a general route into
the authority surface, not a peculiarity of F097's publication path.** Any row whose closure rests
on compile-fail witnesses alone should be assumed open across fork until a runtime fork
composition has been run against it.

`addradm` also re-confirmed LLP 0291's third enumerated forgery from scratch — a *field-by-field
rebuilt public catalog plan* that commits and yields a resolvable bearer, needing no feature at
all. That is independent corroboration of LLP 0291's central claim that authority creation has no
chokepoint, arrived at by a lane that was not looking for it.

`addradm` behaved correctly throughout: it removed all unproven `Closes-rows` trailers, kept the
30/30 historical fail-first matrix, and reported the 14 inherited engine compile errors without
chasing them.

**Consequence for LLP 0313:** this is evidence for §10's recommendation. Two lanes independently
demonstrating live forgery routes — one of them a route LLP 0291 already enumerated — is the
pattern that document predicts, and it is not something more row lanes can fix.

## Resolved — 2026-08-26: F097 is OPEN, and so is F127

An independent review of `f127` (HEAD `6eb0a14fd`), run in a checkout that could build, settled the
disagreement in `rowfam`'s favour:

> **DO NOT LAND.** The 14/14 current refusals and 14/14 historical compilations are genuine, and the
> legitimate publication test passes. However, **F097/F127 are not closed: alternate public
> split-and-publish compositions compile, and the new stream wrapper lacks producer-instance
> identity.** F128 also genuinely remains, correctly blocking F215.

Three things follow.

**The witnesses were never the problem.** 14 of 14 compiled historically and 14 of 14 refuse now.
`f127`'s evidence was real; it simply did not cover the surviving route. This is LLP 0303 revision (s)
once more: a compile-fail witness proves a *spelling* is gone.

**`f127` was right to decline what it declined.** Its refusal to claim F210/F212/F213 and F215 was
correct, and the review independently confirmed F128 still blocks F215.

**The missing property is named.** The new stream wrapper "lacks producer-instance identity" — the
LLP 0303 requirement that a carrier be tied to the *instance* that produced it, not merely to a type.
That is the same defect the whole programme is chasing, reappearing inside a fix for it.

## The pattern this completes

Counting every row claim that has been independently reviewed in this programme, essentially all of
them have been rejected for a **surviving alternate composition** rather than for bad evidence:

| Lane | Claimed | Outcome |
|---|---|---|
| `askfull` | 7 rows | All rejected — public enum variant rebuildable field-by-field |
| `q03r4` | 3 rows | F102 closed; F100/F101 rejected — caller-shadowable SQL clock |
| `q04` | rows + routes | Rejected — caller manifest laundered into the canonical registry |
| `commitrow` r1 | F220 | Rejected — public mint from caller-selected intent |
| `commitrow` r2 | F220 | **Closed** after rebuild as genuine derivation |
| `f127` | F097, F127 | Rejected — alternate split-and-publish compositions compile |
| `rowfam` | F097 | Self-reported open — fork composition succeeded |
| `addradm` | F063, F070 | Self-reported open — fork inheritance, rebuilt catalog plan |

One row survived review, and only after being rebuilt from verify-shaped into derive-shaped. Every
other rejection was a *different* route to the same effect — which is exactly what LLP 0291 recorded
when four consecutive review rounds each found a different forgery, and exactly why
`llp/0313-authority-creation-chokepoint.spec.md` §10 recommends converting the row inventory from a
staffing queue into an acceptance ledger.

**This is measured evidence, not inference:** the row programme's rejection mode is not lane quality
and not witness quality. It is the absence of a chokepoint.

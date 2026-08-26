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

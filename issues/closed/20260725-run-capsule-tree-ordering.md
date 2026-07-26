# Run-capsule tree ordering is host-locale-dependent and internally unsatisfiable

**Status:** Resolved (2026-07-26)
**Severity:** P1
**Systems:** Competitive checkpoint, Acceptance testing, Instruments
**Author:** Claude (Opus 5), directed by Charlie Cheever
**Date:** 2026-07-25
**Related:** LLP 0074, LLP 0075 (run capsule); PR #4 (`984b6a06`);
`demos/competitive-checkpoint/acceptance/instruments/run-capsule.v0.mjs`
**Program:** issues/20260723-llp0075-checkpoint-program.md (pre-timed-run program index)
**Marker:** competitive-checkpoint, run-capsule, reproducibility, llp-0075

The run capsule is the reproducibility root of the LLP 0075 timed run: its
`contentSha256` is what a dated amendment ratifies, and `verifyRunCapsule` is
what an independent party re-runs to confirm the two arms started from
identical bytes. Two defects in its tree-ordering rules break that guarantee.
Both are in `run-capsule.v0.mjs` and must be fixed together, because fixing
either alone leaves the other rejecting valid capsules.

## Defect 1 — path ordering is decided by the host's ICU locale

`assertSortedUnique` (line 80) and `walkClosedTree` (line 377) both order paths
with `String.prototype.localeCompare` and no explicit locale, so the accepted
ordering is whatever the host's default collation says. Meanwhile the module's
own `canonicalJson` (line 100) and `treeDigest` order by UTF-16 code unit, and
`verifyPackageClosure` (line 473) uses a plain `.sort()`. The instrument
therefore has two different orders inside one file.

Reproduced against the real `verifyRunCapsule`, using a scaffold containing
`App.tsx` and `app.json` — the exact pair of filenames the react-expo surface
added in this same tranche ships side by side:

    manifest sorted with .sort()        -> REJECTED:
      content.startingScaffolds.snapback.files must be strictly sorted
    manifest sorted with localeCompare  -> ACCEPTED

So a capsule assembled with the ordinary code-unit sort — the order the
module's own digest uses, and the order this repository's own
`run-capsule.test.mjs` helper produces (`[...paths].sort()`, line 119) — is
rejected as soon as any scaffold mixes case at a sort boundary.

The locale dependence is not theoretical. `localeCompare` with no argument
resolves through `Intl.Collator()`, which follows the process locale:

    LC_ALL=en_US.UTF-8  ->  ä.txt  ae.txt  z.txt
    LC_ALL=sv_SE.UTF-8  ->  ae.txt z.txt   ä.txt

The same capsule bytes verify on one machine and are refused on another purely
because of `LANG`. Node built with `small-icu` narrows the collation data
further. For an artifact whose entire purpose is cross-host reproducibility of
a competitive benchmark, the verifier must not consult host locale state.

## Defect 2 — a directory plus a sibling file extending its name is unverifiable

`validateTree` requires `tree.files` to be strictly ascending. `verifyTreeBytes`
separately requires `tree.files` to equal the `walkClosedTree` output
*index-for-index*. `walkClosedTree` recurses depth-first, so for a directory
`src/` and a sibling file `src.txt` it emits `src/x.txt` before `src.txt`
(the directory entry `src` sorts before `src.txt`). But as a flat path string
`src.txt` sorts before `src/x.txt` under every comparator. The two rules are
mutually unsatisfiable and no manifest exists that passes both:

    manifest sorted .sort()          -> REJECTED: file closure differs from its manifest
    manifest sorted localeCompare    -> REJECTED: file closure differs from its manifest
    manifest in depth-first order    -> REJECTED: files must be strictly sorted

Any starting scaffold or documentation corpus with that shape (e.g. `src/`
next to `src.txt`, `app/` next to `app.json`) simply cannot be capsuled.

## Why the tests did not catch either defect

`run-capsule.test.mjs` passes. Its fixture trees are flat, all-lowercase, and
two files deep (`package-lock.json`, `package.json`, `index.md`), which is the
one shape where code-unit and locale ordering agree and where no directory
shares a prefix with a sibling file.

## Proposed fix

1. Define one total order over the full relative path string — UTF-16 code
   unit (`(a, b) => (a < b ? -1 : a > b ? 1 : 0)`) — and use it in
   `assertSortedUnique`, `walkClosedTree`, and `verifyPackageClosure`. It must
   match the order `canonicalJson`/`treeDigest` already assume, and must not
   read host locale state.
2. Make `walkClosedTree` collect the flat relative-path list first and sort it
   with that same comparator, rather than emitting depth-first directory order,
   so `validateTree` and `verifyTreeBytes` agree by construction.
3. Extend `run-capsule.test.mjs` with fixtures that would have caught both:
   a scaffold containing `App.tsx` + `app.json`, and one containing `src/x.txt`
   + `src.txt`. Add a case asserting the verdict is unchanged under a non-en
   `LC_ALL`.
4. `run-capsule-verifier-lock.candidate.v0.json` pins the verifier bytes, so
   the lock digest must be regenerated with the fix.

## Ratification note

The capsule is still `candidate-unratified-blocks-timed-runs`, so no timed
sample has been taken against the broken ordering and no published result is
affected. This must land before any dated amendment ratifies a capsule digest.

## Resolution

The verifier now uses one explicit UTF-16 code-unit comparator for sorted
manifest assertions, canonical object keys, filesystem traversal, and npm
closure paths. `walkClosedTree` collects the complete flat path set before
sorting it, so directory traversal order cannot disagree with the manifest.

The fixed-vector test now puts `App.tsx` beside `app.json` and `src/x.txt`
beside `src.txt`, and re-verifies the same capsule in a child Node process with
`LC_ALL=sv_SE.UTF-8`. The candidate verifier lock was refreshed to sha256
`eacf4cf8fcc5d871736dcac38e34902e010dfde64c33aef30dfd02ccafa1fe95`.
The lock remains unratified and continues to block timed runs.

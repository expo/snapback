# Capability maturity A5 sole-parent merge bypass hardens exact-pin (guide-gap: gate hole)

**Status:** Open
**Filed:** 2026-08-16
**Systems:** Capability maturity, Claim snapshots, Testing, CI
**Related:** LLP 0134 §4 / A5, LLP 0269 (Decision — range relaxation shelved),
`scripts/capability-maturity.mjs`

## Summary

`validateTransitionRange` in `scripts/capability-maturity.mjs` skips every commit
with ≠1 parent unconditionally:

```js
// scripts/capability-maturity.mjs (~line 1033)
if (parents.length !== 1) continue;
```

This is a real hole in the *existing* exact-pin gate, independent of the shelved
D-4 range relaxation. A two-parent (merge) commit can change the maturity
projection with **no** transition classified, no receipt required, and neither
exact-pin nor any validation run — a maturity transition rides a merge commit
completely unchecked. Example: a merge that adopts an already-promoted parent's
`stable` projection while the other parent is `experimental` flips maturity at
the merge commit, which the loop silently `continue`s past.

Surfaced while designing LLP 0269's range relaxation. That relaxation is shelved
(LLP 0269 Decision), but this merge repair stands on its own and hardens
exact-pin, so it is worth landing independently.

## Fix (both review families rate this repair sound)

Replace the unconditional skip with a projection check against **every** parent:

- For a commit with ≠1 parent, compute `projectionAt(commit)` and
  `registryProjectionAt(commit)` and compare against each parent's projection.
- If the merge commit's maturity or registry projection differs from **any**
  parent's, refuse with a new diagnostic `MATURITY_MERGE_TRANSITION_UNSUPPORTED`
  — a maturity transition may not ride a merge commit; it must land as a
  sole-parent commit that exact-pin validates.
- A merge whose projections equal **all** parents' is benign and skipped.
- Fail closed on a missing/unparseable/absent projection source (root commit, or
  a parent whose projection cannot be read): refuse rather than compare as
  `null`. `projectionAt == null` versus a non-null parent must count as a
  difference. Explicitly refuse root commits.

Register `MATURITY_MERGE_TRANSITION_UNSUPPORTED` in the diagnostics registry
alongside the existing `MATURITY_*` codes.

### Fixture

Add an acceptance fixture (`tests/capability-maturity.test.mjs` family) that
builds a real throwaway git history where a two-parent commit flips the maturity
projection to `stable`, and asserts `MATURITY_MERGE_TRANSITION_UNSUPPORTED` —
refused, never skipped. Add a benign-merge control (projections equal all
parents') that passes.

## Secondary: transition-record accuracy points

Lower priority, same subsystem, also surfaced during the LLP 0269 exploration —
consider alongside the merge repair but not blocking it:

- **Orphan / voided receipt handling.** A schema-valid promotion receipt
  introduced with no maturity transition, or a voided receipt after a demotion,
  should never be mistakable as authority for a later transition. Confirm the
  record model already refuses or ignores these (the exact-pin path does not
  consult prior receipts); add a fixture asserting an orphan `*.promotion.json`
  contributes nothing to any transition verdict.
- **Transition-key uniqueness.** The transition key (`candidateSourceSha + ids`,
  ~line 914) can collide a re-promotion that reuses a prior `candidateSourceSha`.
  Confirm re-promotion after demotion keys distinctly; specify a replacement key
  if a collision is possible.

## Provenance

Findings from LLP 0269 round-2 dual-family super-refine review
(`REVIEW-R2-CODEX.md` "A5 merge bypass — substantively repaired";
`REVIEW-R2-GROK.md` §4 "A5 merge / exact-pin"). Both families agree the merge
repair is sound; it is decoupled here from the shelved range relaxation so
exact-pin gets hardened regardless.

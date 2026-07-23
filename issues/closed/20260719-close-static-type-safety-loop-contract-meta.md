# Close the static type-safety loop: generate contract-meta sidecars and type helper results

**Status:** In Progress (claimed 2026-07-23 by Claude session 1681e9d6, issues-sweep worktree; audit-and-complete pass)
**Severity:** P2
**Systems:** Codegen, Contract Adapter, DX
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-19
**Related:** diaries 0008, 0009, 0010
**Linear:** ENG-25268; related completed Exact work ENG-22419, ENG-22500,
ENG-25129, and ENG-22416
**Marker:** dx, type-safety, codegen, contract-meta

The red-team comparisons (diaries 0009/0010) identified exactly one error
class where "React is categorically safer": static type coverage of the
data seam. Two compounding gaps:

1. **Hand-mirrored contract-meta sidecars with no drift checker.** Every
   helper signature change in `data.ts` must be manually mirrored in
   `data.contract-meta.ts`'s `params:` lists. Diary 0010 hit this twice in
   one session; silent drift is the failure mode, and diary 0009 lists it as
   punch-list item #4 ("a duplicate with no checker I could see").
2. **Opaque helper-result types let typos ship to runtime.** Because
   contract-meta result types are opaque strings, `board.hero.headsgn`
   compiles clean and ships (diary 0010 P2). The identical bug in the React
   arm is caught by `tsc --noEmit` with
   `TS2551 … Did you mean 'headsign'?`. Related: function-typed props are
   decorative — `{ kind: 'function' }` keeps the signature as raw text, so
   nothing checks arity or parameter types (diary 0008, ENG-22417).

Direction: derive the sidecar from the helper source (or at minimum add a
drift checker that fails codegen when `params:` disagree with the exported
signatures), and carry real result types through contract-meta so member
access on helper results is checked with did-you-mean quality errors.

**Done when:**

- Sidecar `params:` lists are generated from, or checked against, the helper
  module's actual exported signatures; drift fails codegen with a stable
  diagnostic.
- A misspelled member access on a helper result fails at compile/typecheck
  time rather than shipping to runtime, demonstrated by a regression test
  reproducing the diary 0010 `headsgn` case.
- The guide's Contract client page documents the checked seam (and the
  remaining unchecked residue, if any, as explicit caveats).

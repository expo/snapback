**CHANGES_REQUIRED**

1. **Auxiliary scans can still supply the returned page’s cursor.** [certificate/page.rs:309](/Users/ccheever/clique-improvement/reviews/cursors/snapback2/crates/snapback2-core/src/certificate/page.rs:309) counts occurrences using a traversal that skips `Get`/`Exists` keys and scan operands.

   Static reproduction: use public `posts` with `byAuthorAt(author, at, id)` and unique `byAt(at)`. Define identical opaque scan expressions `S`: site `P`, prefix `[Variable("who")]`, ascending, take 2, after `c`. Execute:
   ```text
   Let who = a
   Const page = Scan(S)
   Assign who = b
   Const auxiliary = Get(posts.byAt, [Len(Scan(S))])
   Return page
   ```
   Seed author A at positions 1, 2, 3 and B at 100, 101, 102; pass `a=A`, `b=B`, `c=null`. Identical scan expressions pass the existing duplicate-shape check. The provenance traversal sees only the first occurrence, so it certifies return→`P`. Execution returns A1/A2, but both engine and twin select the **last** trace entry for `P`, minting `(101, B2)`. Reusing that cursor skips A3.

   **Fix:** traverse every evaluated expression when proving site uniqueness, including point keys, scan prefixes/bounds, and merge-source operands. Reject this duplicate or bind continuation provenance to an execution occurrence. Add the nested-auxiliary regression in both engines.

2. **Automatic provenance derivation can panic on malformed scan prefixes.** [certificate/page.rs:284](/Users/ccheever/clique-improvement/reviews/cursors/snapback2/crates/snapback2-core/src/certificate/page.rs:284) slices the index without checking prefix length. [certificate.rs:245](/Users/ccheever/clique-improvement/reviews/cursors/snapback2/crates/snapback2-core/src/certificate.rs:245) still invokes analysis after collecting structural errors.

   Static reproduction: take `opaque-cursor-complete-next-null.json`, give its returned scan three literal prefix components for the two-column `posts.byAt` index, and call `Checker::check_all`. Structural validation records `E_ARGS_TYPE`; automatic page resolution then evaluates `columns[3..]` and panics instead of returning diagnostics.

   **Fix:** check the prefix length before slicing and return a typed error while preserving accumulated diagnostics.

Optional coverage: explicit successful cross-operation reuse and incompatible-cursor refusal before empty merge discovery would strengthen the evidence.

These are source-derived reproductions, **not executed verification**. I ran no tests. The supplied passing results remain unverified here, and the consolidated green Rust run remains outstanding.
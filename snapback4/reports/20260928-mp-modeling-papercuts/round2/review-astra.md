The three blocking round 0 findings are fixed. One **Medium coverage gap still blocks landing**, and one Low source-site error remains. I found no caller-visible disclosure regression.

1. **Medium — query authorization refusals have no developer cause.** [serve.rs:1139](/home/ccheever/sb4-intent/review-mp-r1-astra/snapback4/crates/snapback4/src/serve.rs:1139).

   Reproduced over HTTP: `parents` has `read <- exists grants[parent = .id]`, backed by 8,193 expiring grants. A point query exhausts the authorization allowance and returns `E_RULE`. Neither query execution branch attaches a refusal collector, so no developer record appears; `why recent` still shows an earlier, unrelated mutation refusal.

   This is an authorization failure, not an ordinary filtered read or an authored `require`. The round 1 audit missed it.

   **Smallest fix:** attach the dev-only collector to both query execution branches, bind source coordinates to the reader’s generation, and enqueue evidence after responding. Add this real-process regression. **Blocks landing.**

2. **Low — authorization exhaustion can point at an unevaluated rule.** [dev_refusals.rs:74](/home/ccheever/sb4-intent/review-mp-r1-astra/snapback4/crates/snapback4/src/dev_refusals.rs:74).

   Reproduced with the same expensive parent rule and a child declaring `read through .parent` plus `insert <- allow`. Capture exhausts its allowance before evaluating the insert rule. The trace correctly says `authorization allowance (insert)`, but the mapper resolves its primary source site to **`insert <- allow`**, rather than the read-through declaration. My source-coordinate assertion fails.

   **Smallest fix:** retain the actual authorization phase in developer evidence and map that phase to its declaration; do not infer the refusing source clause solely from the enclosing write effect. **Does not independently block landing:** the exhaustion cause is still recorded, and caller behavior is unchanged.

What is sound:

- Two simultaneous `dev --fresh` processes have isolated streams. Selection, empty streams, stopped producers, and mismatched identities pass.
- Missing, physically stored expired, and unreadable parents now produce capture causes at the read-through declaration.
- The cross-group `access = .parent` witness successfully authorizes insertion without a note. The builder’s first-member trap still receives one. The rewrite names the declared sequence column.
- Persistence runs after engine-lock release and response sending. Blocked stderr does not stall the tested mutations. Forty refusals retain exactly `add8`–`add39`.
- Preview advice is conditional. The expiring membership witness controls the aggregate deadline before source expiry.
- Tested refusal serialization remains byte-identical, with logical meters unchanged. The writer adds no HTTP channel or production collection path.
- Parent authorization still precedes aggregate enumeration. My twice-nested shape probe produced identical data, meters, cursors, deadlines, dependencies, and completeness for missing, hidden, and expired parents. A readable control returned its groups.

I ran **123 submitted tests successfully**, plus the nested-shape probe. Restoring round 0 product files in the copy made **10 submitted regressions fail**. The two additional probes above reproduce the remaining defects. The initial guide failure was my incomplete copy; after copying its required LLP, all 93 guide tests passed.

A confirmed surviving mutation: replace the persisted dropped-record count with constant `0` at [dev_refusals.rs:38](/home/ccheever/sb4-intent/review-mp-r1-astra/snapback4/crates/snapback4/src/dev_refusals.rs:38). **All four process tests still pass**, including queue saturation. Add a recovery assertion that observes a positive dropped count.

The merge resolution preserves both journal histories. Tests ran only on temporary copies; the review worktree is unchanged. I did not rebuild wasm; the reported inherited 106-byte overrun remains a qualification failure.

**Verdict: NOT READY.**
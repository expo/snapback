# SEC5 refutation implementation

Scope: item 3 (wave-20 S3/S4), governed by LLP 3000.036.004 §14. Source reproductions copied read-only from `~/sb4-loop/wave20-repro/q1/{036,050}/snapback/schema.q` into dedicated tests. The copies contain the bakeoff investigator’s specification-shaped intent, not the original builders’ mirrored declarations.

- `analyze_rules` preserves the independent proof pass. `analyze` additionally attempts bounded real replay; `analyze_with_campaign` lets CLI check share its existing 512 reservations and 1500 ms deadline. Explicit authored fixtures retain selection; invalid or cached selections do not silently substitute generated assumptions.
- Direct column replay prioritizes an actor actually admitted by the effective row/cell gate whose policy is definitely false, then compares repeatable authored query observations in independently valid column worlds. It stops after the first witness for that invariant to share the budget. Creator/guard/copy coupling exclusions remain enforced.
- Column-world equality uses production `schema::row_image`, so filling sparse optional/literal-default columns during seed replay does not falsely invalidate an otherwise unchanged logical image. Captures, unrelated base columns and populations remain checked.
- Presence/absence media experiments hydrate once, copy one verified asset ledger to both independently seeded worlds, validate both, and repeat observations. Synthetic generated column worlds use the original hydrated ledger and explicitly retain synthetic, non-failing provenance.
- Generated fixture initialization avoids cloning/uploading for definitely denied actors. The authored-creator prefilter applies only to a sole target with a row-free insert gate whose dependencies cannot change through explicit or implicit writes. Successful initialization still requires real ordinary insertion/creator execution and final validation.
- Lifecycle search applies only to still-unrefuted read intent with non-role enum conditions. It explores actual admitted mutations, never replacing creator constants with invented states, with three-step, 16-world frontier and 256-attempt limits. Counterexamples preserve the executed mutation history and generated/authored fixture origin.

Evidence: 050’s specification-shaped contact invariants now produce a failing generated-fixture refutation in bounded analysis and both contact fields are caught by full fixture observers. 036 now produces a real lifecycle trace to collected-state disclosure. Negative controls cover impossible simultaneous unique roles, authored projections excluding the field, exhausted work, repaired contact rules, and image/file/image-list ledger coupling. No kernel theorem or runtime authorization rule changed.

Focused test invocations use `timeout` and `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0` in the same command:

- First baseline `cargo test -p snapback4-lang --test security_sec5_refutations`: both actual wave-20 reproductions failed, establishing the missing behavior.
- After repairs, 050 focused test passed (30.11 s including the full unbounded fixture campaign); 036 passed in the five-test focused run, along with media-pair, impossible-role/projection and work-exhaustion negative controls. That run’s only remaining failure was the then-unoptimized 1500 ms static fixture initialization, subsequently repaired by denied-actor prefilters; the dedicated 050 rerun passed.
- Broad eight-file security regression run is recorded separately by the coordinator. An old synthetic-only assertion in `security_histories` and a work-exhaustion assertion in `security_sec4` now explicitly use `analyze_rules`, preserving what they test while allowing public `analyze` to find real generated-fixture observations.

No scratch databases are created by the added tests. The ordinary in-memory Store owns and drops its temporary verified asset directory. No version bump, push, publication or production access-rule change is part of this implementation. Integrated commits and final qualification are coordinated in root `WORKSTREAM-REPORT.md`.

## Final focused results

- `cargo test -p snapback4-lang --test security_sec5_refutations --test security_sec4 -- --nocapture`: **26 passed** (20 SEC4 in 120.57 s; six SEC5 tests in 115.76 s on the busy shared host). The static regression retains 512 reservations and uses 10 s wall headroom for qualification; production remains 1500 ms. Both 050 contact declarations refute.
- `cargo test -p snapback4 --test security_wave19 check_refutes_excluded_contact_roles_before_any_full_test -- --nocapture`: **passed**, 3.32 s for both ordinary bounded CLI checks (absent and empty fixture directory). No full-test record is present or needed.
- The earlier broad invocation passed 46 `security` tests, one `security_custody` test and 27 of 28 `security_histories` tests. Its only failure was the migrated proof-only assertion at `security_histories.rs:281`; the production replay and history assertions passed. The exact corrected test is rerun separately, and the coordinator owns the final full workspace qualification.
- `git diff --check` on the affected implementation/tests passed. No owned asset scratch remained for the completed broad test PID 711871.
- Exact corrected regression: `cargo test -p snapback4-lang --test security_histories an_empty_trusted_store_can_reach_authored_disclosure -- --nocapture`: **passed**, 3.89 s after waiting for the shared build directory and compiling. This resolves the broad run’s sole stale-assertion failure.

# Charter — diagnose and fix the settlement re-entry test failure

**You do not commit.** Use apply_patch. Never run git commit/push/rebase.

Failing: `cargo test --locked --test mutation_settlement_identity_v0
settlement_identity_is_stable_across_a_genuine_re_entry` — panics at
tests/mutation_settlement_identity_v0.rs:249 "handler failure carries the
extracted error message": `error.diagnostic.details["message"]` is no longer
a string for a deliberately-throwing mutation that carries a
client_mutation_id. The test file is unchanged from base 9a8edc949 (it could
not COMPILE between the authority_profile field addition and now, so this is
its first run against the current tree).

Diagnose: instrument locally (temporary eprintln/dbg in a scratch copy is
fine — REMOVE before reporting) to capture the actual diagnostic JSON the
probe receives. Compare the relevant error-construction paths at base vs
HEAD: `git diff 9a8edc949..HEAD -- src/local.rs src/runtime.rs
src/storage.rs src/storage/settlement.rs src/storage/mutation_writes.rs`
(the run's commits 5190b7cce and fc31cf716 touched settlement/failure
paths). Determine whether (a) a run commit dropped/renamed the extracted
message detail for failed handlers — fix the CODE to restore the base
contract; or (b) the detail contract changed deliberately per an accepted
decision — then fix the TEST and cite the exact accepted text authorizing
it. Default presumption: the base contract stands; LLP 0236 P11 makes
handler-failure detail quality a product property — do not weaken it.

Verify: the full mutation_settlement_identity_v0 target 6/6; plus
cargo test --locked --lib settlement (17 expected) and
media_ref_projection_acceptance_tests (10 expected) still green; ref-check.
Report (REPORT-msifix.md): root cause with the exact diff hunk, the fix,
classification (a) or (b), verbatim results.

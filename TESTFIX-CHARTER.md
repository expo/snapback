# Charter — add the missing authority_profile field to four integration-test initializers

Tiny mechanical task. **You do not commit.** Use apply_patch. Touch ONLY:
tests/mutation_settlement_identity_v0.rs, tests/membership_authoring_v0.rs,
tests/structural_validation_v0.rs, tests/network_profile_v1.rs.

Lane A added `authority_profile` to TableManifest and updated the 30 src/
literal call sites but missed these four integration-test files; they no
longer compile. Add `authority_profile: None,` to every TableManifest
literal in the four files (match the existing field-order style used in
src/bench_fixture.rs).

Verify each target compiles and passes:
cargo test --locked --test mutation_settlement_identity_v0 2>&1 | tail;
same for membership_authoring_v0, structural_validation_v0,
network_profile_v1. Report (REPORT-testfix.md): initializer counts per file
and the four verbatim test-result lines.

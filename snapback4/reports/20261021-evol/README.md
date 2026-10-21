# EVOL verification evidence, 2026-10-21

The workstream report at the repository root explains outcomes, exact qualification scopes and limitations. No file here is a publication receipt.

- `consumer.json`: complete consumer-only Linux qualification at db62d60459.
- `affected-consumer.json`: fresh packed affected qualification at c88e594b07 after the final human preview wording correction; binds the full record by SHA256.
- `artifacts.json`: exact tarball hashes. Qualified tarballs remain locally in ignored `artifacts/`; historical directory fields in proof metadata refer to scratch that has been removed.
- `verification.json` and `logs/*.log.gz`: test execution results and hashed retained logs. Overlapping/nested execution totals are not unique-test counts. Credential-shaped fields are redacted and oversized SQLite byte dumps omitted where indicated. Model reviews remain verbatim under `llp/reviews/`.
- `adoption-before-after.json`: isolated public adoption regressions, three baseline refusals and zero candidate refusals.
- `wave21-release-flows.json`: coherent copied-store strict release-1 flows and generated bridge activation, including hidden-count samples.
- `wave21-authored-stages.json`: untouched authored backend scripts, 90/96 stages on both binaries.
- `wave21-authored-stages-aligned.json`: all 24 lanes rerun afresh with explicit setup-only copied credential alignment in 034 and 044, 96/96 on both binaries. This does not replace the untouched result or claim a credential defect was fixed.
- `difftest-*.json`: 20k ordinary/Lean and device 0–999 results. Lean's known classified signatures and unsupported cases are recorded without treating them as passes.

The Python/JavaScript sources retain the historical reproduction logic. Run them from the repository root with bounded outer execution and their explicit binary/output arguments, after installing the normal product dependencies. The stage runners additionally used tsx 4.20.6 installed in an owned root `evol-replay-tools` directory, removed after the run. Their evidence paths intentionally point to the original read-only wave-21 corpus. `copy-credential-setup/` is the isolated, pinned helper used by the aligned runner: it accepts secrets over stdin, refuses stores outside the owned `evol-stage-` copy, and emits only match counts. Build it with incremental/debug output disabled and remove its build output after use. No saved passwords, account hashes or session values are retained here.

`affected-packed.mjs` requires a fresh musl build, the exact retained full client tarball, and a nonexistent root `evol-affected-qualified` output directory. It invokes the actual packed proof helpers and cleans its package scratch. Its saved location/imports were adjusted from the root execution script; its assertions and proof calls are unchanged. The native residency baseline runner reconstructs the pre-EVOL source, executes the unchanged failing regression test in isolation, and removes its temporary tree. These are historical reproduction tools, not new public authoring recipes.

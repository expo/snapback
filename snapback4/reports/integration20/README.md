# Integration 20 verification evidence

Final Snapback 4 source: `49ff4203cec98c268d571075d5dc6418f36ef41a`.
The repository-root [workstream report](../../../WORKSTREAM-REPORT.md) records
scope, commits, commands, failed attempts, cleanup and limitations.

- `rust-tests.json`: complete five-crate command started after the final runtime/test fix; parent summaries exclude nested child probes.
- `client-tests.json`: one complete 425-file pool, followed by both full-count seeded models.
- `prepare.json` and `packed-consumer.json`: fresh final packs and complete supported consumer qualification. Consumer-only deliberately records `suite: not-run` and `publicationQualified: false`; independent Rust/client proofs supply the requested test scope. These are local verification records.
- `survey.json`: all 350 schemas / 358 modules, matched source hashes and per-code before/after counts. Its executed native binary is byte-identical to final source.
- `difftest.json`: core/device zero disagreements; Lean reproduces exactly four baseline signatures. Per-oracle exclusions remain explicit.
- `upgrades.json`: real installed old CLIs, native version checks, dev/production persistence, warning delivery and Expo typecheck/export.
- `exact.json`: fresh Exact2 SDK/apps, resolved package/binary identities, synced/offline and online web proofs. Owned backend cleanup is recorded separately.
- `mac/`: complete platform/lane pool, both fixture follow-ups, affected Rust targets, native release witness, final source hashes and owned cleanup. Native/client/core inputs are bound independently of documentation/test-only follow-up commits.
- `wasm.json` and `censuses.json`: measured sizes, exact 500-byte allowance and regenerated census checks.

Logs named `*-final36*` are the final complete repeat. Earlier snapshot logs
remain historical evidence; failed or interrupted commands are not promoted to
success. `CONTEXT.md` is the original orientation context. Full raw consumer
projects, baseline binaries, packs and native build records remain in owned
scratch paths named in the report.

# Snapback 4: inherited Expo starter audit blocks packed consumer qualification

**Status:** Resolved (AUDIT2, 2026-10-31)
**Date:** 2026-10-31
**Scope:** Expo starter dependency/audit qualification

MUSE3's packed `qualify-linux.mjs --consumer-only` reaches starter qualification
and refuses `@expo/cli: a fix is available; update the starter toolchain`.
The live audit returns fixAvailable=true on a metadata chain. This ticket does
not assert which package update is the correct remediation.

Baseline proof: f557cdfa08's initializer, audit evaluator and allowlist are
unchanged by MUSE3. The baseline 0.4.50 CLI emits identical dependency,
devDependency and override declarations after normalizing the qualifier's exact
file-tarball references to their verified 0.4.50 versions. Its unchanged audit
evaluator reproduces the same refusal against the captured live audit report.
See `snapback4/reports/20261031-muse3/inherited-audit.json` for hashes and input
identity; private full report is under `/tmp/muse3-evidence/consumer-qualified/`.

Re-evaluate the Expo toolchain and advisory chain under the existing audit
policy, fix the dependency pins where needed, then rerun packed starter and
Ubuntu/Alpine qualification. Do not waive a fixable advisory or broaden an
exception merely to pass. MUSE3 leaves the audit enforced and records the
consumer run as failed; it creates no publication receipt.


## Resolution — AUDIT2, 2026-10-31

The metadata chain resolves Expo 57.0.30, @expo/cli 57.0.32 and
@expo/fingerprint 0.20.14 to glob 13.0.6 / minimatch 10.2.6.
[GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
affects glob >=9.0.0 <=14.0.1; 14.0.2 is patched.
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
affects minimatch <11.0.1; 11.0.1 is patched. The CLI/configuration chain and
fingerprint use these dependencies; glob also pulls minimatch.

The shared Expo initializer manifest now overrides glob to exactly 14.0.2 and
minimatch to exactly 11.0.1, keeping Expo SDK 57, its Babel preset and Node 24.
Both retain the named CommonJS/ESM APIs the toolchain uses. Expo fingerprint
generation succeeds. The evaluator and empty allowlist are unchanged; the old
captured report still refuses and the patched graph passes with no warnings.
Existing authored override custody stays unchanged: existing apps explicitly add
these two pins and reinstall. No package version bump.

Fresh packed `qualify-linux.mjs --consumer-only` completed successfully at
source 9a8ddfaf7a: all six host starters have zero audit findings and pass their
build/typecheck/frontend/adaptation proofs. All 12 generated frontend proofs
pass. Both Ubuntu 24.04 (Node 24.13.1) and Alpine (Node 24.18.1), through proot,
pass their complete web/Expo/adapted/template groups. No unrelated packed red
appeared. This is consumer qualification, not a publication receipt.

The 0.4.51 Guide changes entry and generated starter audit notes describe the
pins. Public evidence: [advisory chain](../../snapback4/reports/20261031-audit2/advisory-chain.json)
and [packed summary](../../snapback4/reports/20261031-audit2/packed-consumer-summary.json).
Private full logs and the consumer receipt remain in `/tmp/audit2-evidence/`;
completed dependency trees were removed to reclaim disk.

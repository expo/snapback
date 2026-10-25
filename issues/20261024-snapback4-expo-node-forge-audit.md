# Expo starter audit: dated exception for unpatched node-forge

Status: Open
Scope: Snapback 4 pinned Expo development toolchain
Found: DX9 wave-26 packed starter qualification, 2026-10-24

All twelve starter variants typecheck/build. All seven web variants have a clean
npm audit after pinning Vite 8.3.5 and SDK undici 8.12.2. The five Expo variants
still report one underlying high advisory, GHSA-86w9-cpqp-85rv, in node-forge
(range `*` in the current npm audit). npm reports five affected packages through
Expo's code-signing dependency chain. The current latest node-forge is 1.4.0;
no patched release was available during qualification.

DX9 pins patched zod 4.6.7 and decode-uri-component 0.5.1 overrides; they remove
the other observed Expo advisories and pass the installed builds. Qualification includes development dependencies. The coordinator's 2026-10-25
ruling supersedes the original no-waiver instruction: fail on every advisory
with a fixed version available. An unavoidable advisory with no fix may pass
with a printed warning only under a checked-in, dated exception.

FIX41 implements that ruling in `snapback4/scripts/starter-audit-allowlist.json`:
GHSA-86w9-cpqp-85rv / node-forge 1.4.0, for Expo, Expo chat and Expo social.
Recheck **2026-11-08** (14 days). The gate includes dev dependencies, resolves
every transitive advisory, refuses unknown findings and fixable ancestors,
and fails on or after that date. It also queries npm's latest node-forge
version and fails on any new release, requiring the exception to be reviewed
even when Expo's pinned graph cannot yet adopt it. No forced Expo downgrade.
A passing qualification retains the warning; it does not claim a clean audit.

Runtime reachability, inspected 2026-10-25: node-forge is installed as part of
Expo's dependency graph, but its callers are **development/code-signing
tooling**, not the generated application's runtime. `@expo/cli` imports it in
`build/src/run/ios/codeSigning/Security.js`; its
`build/src/utils/codesigning.js` imports `@expo/code-signing-certificates`,
which also depends on node-forge. Expo's `src/` and `build/` app entrypoints
contain no imports of either package. Generated starter application code and
Snapback's client have no node-forge import. This is a source/dependency-path
inspection, not a claim that npm omits the package from installed apps.

Upstream still lists no patched version:
[GitHub advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
Keep this issue open until a patch can be adopted; rerun packed starter audits
and builds at that point.

Evidence: [packed starter results](../snapback4/reports/20261024-dx9/starters.json).

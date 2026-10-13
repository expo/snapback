# GATE — Exact device gate follows device consumers

Date: 2026-10-13. Worktree: /home/ccheever/projects/sb4-w10-gate.
Branch: sb4-w10-gate. Baseline: d814b279d0. Initial `git status --short`
and `git log sb4-loop..HEAD` were empty; no existing changes were displaced.
No push, publication, or edits in another worktree were performed. Exact2
sb4-loop-fixes was read-only input (EX5 f343fe96d, d9445e22c and adapter
repair 93a2e23ef). HS's report and governing handshake LLP were read first.

## Changes

1. `exact_device::inspect` retains the backend-root/immediate-child scope and
   mount-to-this-backend requirement, then discovers actual device declarations.
   A declared Exact snapback4/ts adapter gates its default artifact even if its
   readable entry forwards imports elsewhere. Relocated adapters are recognized
   through web-device module imports. Online/generated-only mounts impose no
   device requirement, including with unused leftover default artifacts.
2. Static custom artifact declarations in app.json, app.ts, and the mounted
   adapter entry are identified by embedded section content, regardless of
   filename extension. Canonical stamp parsing and public-projection
   floor/capability admission remain unchanged. Pinned Oxc 0.154.0 parses TypeScript runtime expressions and value imports,
   excludes erased types, decodes static literals, ignores comments/regex bodies, and resolve /assets/ URLs after query/fragment
   stripping and filename URL decoding. The Rust regression covers custom
   incompatibility, corrupt identity, unrelated artifacts/backends, missing
   canonical device, and every first-round material review counterexample.
3. An Exact fixture with zero synced tables declares snapback4/online and the
   generated backend, with no wasm. Its adapter is copied from Exact2
   93a2e23efabbec2c9788017ac781fdf194d52264; only the @ref is rebound to the
   local handshake LLP. The client test materializes Exact's virtual mounts and
   semantically typechecks the adapter/generated operations, transforms TS in
   its temporary tree, then proves check, authoritative query,
   write result and reread in dev and serve. Serve uses real guest authentication.
4. Handshake LLP, shipped `guide wire`, check documentation and append-only
   JOURNAL explain the scoped gate. Historical device fixtures now declare
   their actual adapter instead of relying on the generated backend alone.

## Verification

Every Cargo command used CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
CARGO_PROFILE_TEST_DEBUG=0 in the same invocation. No full scripts/test.sh ran.
Node 24.13.1 and requested Bun 1.4.2 were used.

- Setup: frozen Bun install; cargo build -p snapback4; scripts/build-wasm.sh;
  bun run --cwd packages/snapback4 build — passed. Wasm 2,294,137 raw /
  698,731 gzip bytes, under unchanged 699,231-byte budget.
- cargo test -p snapback4 --test cli_friction -- --test-threads=4 — 28 passed.
  Final repaired run: snapback4/target/gate-rust-cli-url.log.
- cargo test -p snapback4 exact_device::tests — canonical stamp test passed;
  final AST source rerun used --bin snapback4, also passed.
- cargo test -p snapback4-core device_protocol::tests — protocol test passed.
- cargo test -p snapback4 --bin snapback4 device_handshake_tests — 3 passed.
- cargo test -p snapback4-lang --test guide — 120 passed (latest guide text and
  exact application-file allowlist: target/gate-rust-guide-final.log).
- node --test packages/snapback4/test/exact-online.test.mjs
  packages/snapback4/test/device-version.test.mjs — 13 passed (both named
  online dev/serve cases included). Final run: target/gate-client-url.log.
- node --test packages/snapback4/test/external-device.test.mjs — 1 passed:
  independent crate producer, bindgen/optimizer preservation, compatible check,
  unstamped refusal, real schema/sync/changes.
- ./ref-check — passed; final review-inclusive result recorded below.
- git diff --check — passed.

Early test attempts used the pre-change binary or incomplete test harness
(TypeScript strip-only parameter properties, nested guest session, doctor
without a store); those were corrected. Final passing evidence is named above.
Logs are retained in snapback4/target/gate-*.log (ignored local evidence).

## Reviews

Prescribed Muse contributor/high and fresh Codex gpt-6.1-sol/high sessions
ran mutually blind. Every response is saved verbatim with command, worktree,
date and scope under llp/reviews/3000.001.000-gate-rN.{muse,codex}.md.
Muse's wrapper hit plan quota, then used its configured fallback without any
key file being read or printed by this workstream.

Round 1: Muse READY with provenance correction; Codex NOT READY with explicit
adapter suppression, regex/escaped-literal discovery, URL suffix counterexamples
and a cleanup-order minor finding. All repaired, with regressions. Relocated
adapter detection was also restricted to module imports rather than ordinary
string references. Round 2: Muse READY; Codex NOT READY with postfix/control-regex discovery
and erased type-import counterexamples. All repaired. New regressions cover
both examples, object division, type-only imports/exports, and relative cache
URLs. Custom negative cases assert E_DEVICE_VERSION on check and doctor.
Round 3: Muse READY; Codex NOT READY with TS postfix non-null, ASI after
import type, and erased aliased type import counterexamples. Replaced the
handwritten lexer with pinned Oxc's TypeScript AST parser, limited to the CLI.
All counterexamples remain regressions. This adds CLI build dependencies and
removes the manual lexer; it does not alter core/device/wasm. A strict semantic
fixture typecheck addresses the runtime-only test finding. Explicitly
allowlisting the two Exact application filenames in the published-guide test
preserves its exact-path policy while documenting discovery boundaries.
Round 4: both NOT READY. Muse found runtime namespace/default imports and
re-exports omitted; Codex found erased interface and ambient declarations
traversed, plus the fixture ancestry wording was wrong. AST discovery now
supports all runtime import/export forms and skips erased declarations/members
and declaration files, with check/doctor regressions for both families' cases.
Ancestry is corrected: f343 introduced the adapter, 93a repaired failure parity,
and the later d944 preserved wiring. The exact dependency pin carries an update
policy comment. Round 5: Muse READY; Codex NOT READY with erased abstract auto-accessors
and empty named value imports evaluated by Exact's Rolldown. Both repaired,
with check/doctor regressions for the erased accessor and both empty-import
hops. Added a direct missing-default-asset assertion for Muse's minor finding.
Round 6: both READY for the complete implementation. Codex supplied one
non-blocking double-percent-decode finding; fixed it by keeping resolved source
candidates as PathBufs. Round 7: both READY for that focused follow-up against
0150a11c26, with independent positive/negative check/doctor probes.
All 14 responses are retained byte-for-byte, plus all seven briefs.
Draft implementation readiness does not assert author acceptance.

## Deferrals and judgments

- Root node scripts/check-inventories.mjs was run and failed on inherited
  Snapback1 checkout prerequisites: missing root TypeScript/Ajv dependencies,
  absent generated competitive-checkpoint and todo-v2 Contract artifacts.
  See target/gate-inventories.log, consistent with HS's documented deferral.
  No unrelated root dependencies, inventories or generated artifacts were edited.
- Discovery is static, not TypeScript evaluation or remote artifact acquisition.
  Computed/remote URLs and transitive-only module declarations remain runtime admission. A custom file with no readable
  engine-section framing cannot be positively identified as a Snapback device;
  unlike the known Exact device declaration, its missing/wholly unrecognizable
  bytes do not establish a consumer. This follows the content-identification
  requirement. Runtime handshake still checks every real replica.
- The fixture qualifies Exact's actual online adapter and mount shape against
  Snapback; no Exact presenter/browser rebuild was performed in the read-only
  Exact checkout. EX5 already supplies that browser proof.

## Final commits and state

- 0150a11c26 — changes 1–4: scoped device discovery, all AST/import/erasure
  regressions, zero-synced Exact online fixture, semantic typecheck plus dev/serve
  proof, handshake amendment, shipped guide/check docs and JOURNAL.
- 41fd74995d — item 2 follow-up: resolve custom asset URLs once; preserve PathBuf
  candidates and prove unrelated custom.bin cannot substitute for %63ustom.bin.
  Both independent focused reviews READY.
- e4097aa12d — all 14 independent responses verbatim with provenance and all
  seven briefs; full-gate round 6 READY/READY, URL follow-up round 7 READY/READY.

Final qualification: 153 affected Rust tests and 14 client tests passed (13 in
online/device-version plus 1 external producer), zero failures. Final CLI and
client URL-fix logs are gate-rust-cli-url.log and gate-client-url.log; canonical
stamp, server handshake, core protocol and 120 guide tests are recorded above.
Final ./ref-check passed: 543 LLPs, 11122 refs, zero errors or unchecked refs.
No full suite, push or publication. Branch remains sb4-w10-gate; only this
intentionally uncommitted WORKSTREAM-REPORT.md remains modified after commits.

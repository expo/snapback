# HS — shared device handshake and portable declarations

Date: 2026-10-13. Snapback worktree sb4-w10-hs, baseline f9e40ef515;
Exact harness worktree sb4-loop-fixes. Both initial statuses and histories were
inspected. Snapback had no existing delta; Exact had only the previous untracked
EX4 report. Exact has no sb4-loop ref; available history was read instead.
No push, publication, or other worktree edit was performed.

## Contract and verified defects

1. Missing x-snapback-device caused every Exact /sync to refuse. Exact Fetch
   constructors now attach snapback4_device::engine::headers(); TypeScript and
   Rust transports forward those headers after credentials and remove a caller
   override. Native and web hosts answer engine_info and engine_headers before
   partition open, including without native storage configuration.
2. Exact's producer did not emit the custom section that check requires.
   snapback4-device now emits snapback4.engine itself via its build.rs and a used
   wasm link section. Independent producers inherit it. Snapback's packaging
   script verifies preservation/runtime agreement instead of appending a stamp.
3. HAND and EX4 had different facts (custom section vs Cargo-lock sidecar,
   snapback4.engine vs snapback4.build). Embedded identity is authoritative.
   Exact derives .wasm.json solely for diagnostics and ignores it for admission.
   Both readers require the crate's canonical compact UTF-8 JSON representation,
   exactly format/version/capabilities in order; malformed JSON, duplicate keys,
   alternate numeric spellings, invalid UTF-8, and invalid Unicode scalar strings
   refuse. Versions are decimal u32 triples. Both preflights compare the server's
   public-projection floor/capabilities; GET / exposes that record on dev/serve.
   Compatible version skew is allowed. Recovery says snapback --rebuild and the
   regression executes it on an intentionally unstamped artifact.
4. DOM Storage leaked through auth.d.ts and session-authority.d.ts. Both now use
   structural StorageLike. All 140 published declarations, including wasm, compile
   using only ES2022/WebWorker and types:[], skipLibCheck:false. No DOM or Node
   globals are loaded. Bindgen's optional ESNext disposal declaration is omitted;
   free() remains the device disposal API. The source compiler-host cwd is fixed
   so testing from the repository root resolves the package's types correctly.
5. Web templates now explicitly install @types/node and include Node types for
   Vite configuration; every init variant typechecks including vite.config.mts.
   The current baseline Vite configs do not themselves name process, but the
   package/config types lacked an explicit Node dependency and excluded its types.

Governing docs: LLP 3000.001.000 and Exact LLP 1086 D12; both public docs and
Snapback's append-only JOURNAL updated. These revisions do not assert author
acceptance of the existing Draft RFCs.

## Source pin and implementation decisions

The requested SB4=... repin-exact2.sh command ran. Its existing 0.4.25 snapshot
cache prevented it from copying changed source, so the harness Cargo paths were
then pointed directly to this commissioned branch. No shared snapshot or other
worktree was modified. This becomes a separate harness commit.

A cargo fmt --all in Exact's independent adapter workspace followed its path
subdependencies and reformatted unrelated Snapback Rust. That formatting churn
was fully removed; only the intended HS semantic edits were reapplied. Exact's
root fmt check subsequently passed. No stash was used.

## Verification

Every cargo command used CARGO_INCREMENTAL=0, CARGO_PROFILE_DEV_DEBUG=0,
CARGO_PROFILE_TEST_DEBUG=0. Bun 1.4.2 and the requested cached Chromium were used.
The Snapback setup (frozen install, CLI build, wasm build, package build) passed.
The wasm is 698727 B gzip against the unchanged 698886 B budget.

Snapback:
- Core protocol unit: 1 passed, including overflow/version grammar.
- Device library: 64 passed.
- Server handshake tests: 3 passed (auth-first/predecode admission included).
- Init Rust integration: 46 passed.
- Mounted Exact check/doctor regression: 1 passed.
- Canonical stamp/duplicate/corrupt parser regression: 1 passed.
- Device-version + declarations + external producer client files: 14 passed.
- All seven init variants + external producer: 8 passed; external producer was
  rerun against final canonical admission and passed after bindgen/wasm-opt,
  runtime header agreement, check, schema, sync and changes.
- Final declaration-only qualification: 2 passed.
- ref-check: 543 LLPs / 11119 refs, zero errors or unchecked refs.

Exact:
- Root build, test, clippy, fmt, caps and boot gates passed. Root Rust test gate:
  3676 passed, 32 existing ignored, zero failed. Caps: working set 15/15,
  foundation 8/10; all six categories within cap.
- Affected adapter Rust: 23 passed (16 native client integration, 6 partition,
  1 driver round); native/client and wasm clippy passed.
- bun test snapback4/ts: 26 passed / 297 assertions against the branch server,
  including pre-open runtime-vs-embedded identity and header agreement.
- Preflight/CLI tests: 15 passed, 4 platform skips, 64 assertions.
- New fresh-app browser regression: 2 passed, one dev and one serve. exact new
  creates a guestbook, imports generated backend/api.ts, exact.mjs snapback
  --rebuild repairs an unstamped device, and exact.mjs test web runs against the
  branch binary. Both modes sync, queue an offline write and reconnect. Positive
  UI assertions and a server read prove delivery rather than merely an empty
  queue. Serve uses real guest authentication, not development personas.

Durable local logs: Snapback snapback4/target/hs-verification and Exact
 target/hs-verification. Historical failed/superseded attempts remain in /tmp;
 qualification lists above describe final affected results only.

## Deferrals / limits

The required root node scripts/check-inventories.mjs and check-guide.mjs were
run. They do not pass in this fresh Snapback1 checkout: root node_modules is
absent, TypeScript/Ajv are unavailable, and ignored generated competitive-checkpoint
and todo-v2 Contract demo artifacts are absent. Those are documented fresh-tree
prerequisites unrelated to the fenced Snapback4 change. No inventories, generated
Snapback1 artifacts, or capability claims were changed to bypass them. Their
actual failure logs are retained. No full scripts/test.sh was run.

## Reviews and commits

Both independent high-effort reviewers ran the prescribed Muse and fresh Codex
commands; each response is retained verbatim with provenance in llp/reviews in
both repositories. Rounds 1 and 2 findings were repaired (details in LLP
3000.001.000). Final readiness and commit hashes are recorded below.

The final browser run is attributable by command/cwd/server binary and JUnit per-case records: hs-ex-web-attributed.log and guestbook.junit.xml, dev and serve each passed (exit 0). The BOM regression also passed after the final decoder change.

## Final commit mapping and readiness

Snapback (sb4-w10-hs):
- 74d2dbceb5 — defects 1–3: crate-owned stamp/header API, canonical admission,
  public compatibility metadata, rebuild advice, external producer regression,
  governing LLP/public docs/journal.
- 1d189bf6de — defects 4–5: structural DOM-free declarations, full declaration
  audit, Node types and all-init-template typecheck regression.
- 8df20592a1 — all four independent review rounds, verbatim with provenance.

Exact2 (sb4-loop-fixes):
- f54368c4e — harness pin to the commissioned Snapback branch source.
- 65457c1fe — defects 1–3 integration: pre-open APIs, crate helper headers on
  both transports, shared embedded identity/preflight, derived diagnostic sidecar,
  malformed-carrier tests and fresh dev/serve browser/backend regression.
- b4b08ef62 — all four independent review rounds, verbatim with provenance.

Final Muse and fresh Codex round 4 verdicts: READY / READY. The earlier findings
were repaired and reverified; neither model's output was fabricated or shared
with the other. Final ref-check and Exact caps/fmt passed. Worktree status
after commits contains only this intentionally uncommitted report (modified
tracked report in Snapback; untracked report in Exact). Nothing was pushed.

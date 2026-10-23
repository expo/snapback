# Integration 23 — snapback4 0.4.39

**In progress: qualified rollback snapshot; final RT3 integration and landing pending.**

Worktree `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`. No publication
worktree or `target/publication/` was used. This integration's report wins report
conflicts; journal histories from both sides were preserved.

## Changes and commits

- Landed fully qualified 0.4.38 first: merges `7b051e5f3f`, `c3f23ff2c2`, then PG
  lock alignment `2281138019`; pushed `sb4-loop:main` through that commit without
  force. Step-0 evidence: 452 five-crate result scopes, 7,348 passes/266 declared
  ignores/zero failures; incoming affected core 653, CLI 520/9 after the known
  stopping-admission flake passed alone, Postgres 364 plus unchanged public S1,
  clients 78/78 and root checks. These counts describe their recorded scopes,
  rather than a claim of a full rerun after every later Step-0 merge.
- ROLL `cd20d7ebc9` merged as `2fa38c3b21`; subsequent main integrations include
  `4df0fc0ce1`, `bacbbb29cd`, `121107c574` and `152ba573c8` (main through
  `06a9d2c47f`). Qualified 0.4.38 publication evidence (`b31795e07d`) merged
  without product/test changes as `15676078d3`. `1dc8696f1e` repairs the combined parent-RFC revision header.
- Standalone ten-file bump `8550d12b65` follows `bd2ca8da8b` exactly. One coherent
  0.4.39 guide-changes entry describes upgrade behavior, visible rollback,
  acknowledged hiding, migrations, readable deploys and admitted Postgres sync.
- Wave-25 blocker: ordinary evolution uses widening and old-row risks, rather
  than any invariant plus any executable change. Executable-only repair remains
  protected behind unchanged data/intent. A needed view selects complete current
  closure or a truthful current-guarded bridge, preserving current authority,
  domains, defaults, lifetimes and independent intent. It never revives an old
  unguarded executable. Unsupported truthful representation gets an actionable
  refusal; legacy rollback names both `rollback --to N --exact` and redeploy with
  0.4.39 to register a view.
- Corrective commits `33ab430e29`, `4f9335bb65`, `7e06f1fb36`, `dbf2e5600f`,
  `55b40c6cd2`, `6ccc707b4e`, `eb26f0eb75`, `0d44753e5b`, `f64ece5896` and
  `62e33ec093` cover old wire aliases/distinct positions, qualified/transitive
  helper and named-shape repairs, typed table/column identities, current field
  authority, complete expression trees including merge lanes, engine-owned
  timeline metadata and compiled final-existence obligations. `5e6a5f9fcc` fixes
  the last regression fixture's index syntax. No display printer is a security
  or constraint equality signature.
- Nine blind corrective review rounds are saved verbatim with pinned briefs,
  commands and SHA-256 provenance under `llp/reviews/3000.000.000-integ23-wave25-r*`.
  Muse and fresh Codex both returned READY at `5e6a5f9fcc`; receipt commit
  `9739d90cd3`. Muse's plan quota failed and its prescribed helper fallback
  produced actual reviews; no key was read or printed. Earlier current-intent
  and legacy-store design reviews remain separately retained.
- Legacy store repair `1daadaf4aa` aligns previous deterministic layout indexes
  only when the executable program map is unchanged and the candidate matches;
  malformed/forged changes still refuse. Asset-free writes avoid an impossible
  child SQL probe (`4532c039c8`). Schema fixtures rebuild derived receipt facts
  without relaxing production validation. K0 HTTP fixtures assert reservation
  consumption on aborted/truncated responses; migration examples have a real
  widening trigger and an authored truthful reverse.
- Generated test-store census `be20568b65` records the incoming K0 worker test's
  four fixture database accesses and lowers serve tests 11→10. The generator
  confirms zero production database-access sites; no production allowance was
  added. Research §20.8 is corrected in `4d61619f1d`.

The packed proof found one stale guide fixture: adding only a required defaulted
field correctly needs no view, so original queries omit it on rollback.
`fe77ed9d02` adds a genuine title widening and a real 105-character team, retaining
all business/authorization assertions and proving that team stays usable through
default rollback. The corrected literal case passes alone. This changes embedded
guide text only; runtime and client implementation inputs remain unchanged.

## Compatibility and actual stores

Wave-25 production copies replay all 15 previously refused lanes plus the six
ROLL widening lanes. Before: 15 deploy refusals, 10 false. After: two real deploy
refusals, zero false; all six ROLL lanes deploy/rollback/forward successfully with
zero hidden v1 rows. Lanes 004/024 lack truthful required/default/media reverse
representations; 030's absent preimage has the named exact/redeploy escape.
Every legacy preview either succeeds or names both next steps. The harness uses
read-only originals, SQLite backups under `/tmp/integ23/w25replay/`, and deletes
all copied stores on exit. Coordinator repro originals were not modified.

All 50 copied wave-23 histories have published-0.4.37 provenance and upgrade to
format 9, then complete 1/latest/1/latest with zero hidden v1 rows. Forty-eight
use unchanged source. Two explicit copy-only adaptations are disclosed: 010
retains nullable intermediate audience fields while keeping current live-parent
guards; 032 supplies the truthful child-table embargo reverse. No invented values
or old authorization are restored. Original app/store directories stay unchanged.

The 450-project survey covers wave 15's 100 final schemas plus 50 Snapback apps
from each of waves 16 and 18–23. Original and invariant-stripped copies each run
human and JSON checks (900 records/1,800 calls), with matching verdicts and zero
false refusals. SEC7 gates 15 projects on 36 `N_RETAINED_ROLE_GRANT` findings;
each is individually acknowledged on disposable copies, leaving zero pending.
Acknowledgment grants no runtime authority or independent-intent certificate.

## Qualification

The final proof set is `snapback4/reports/integration23/qualification-0.4.39/`.

Linux full five-crate `cargo test ... --no-fail-fast` passes after the census correction: exit zero, 453 reported result scopes, 7,472 reported passes, zero failures and 295 declared ignores. These totals include explicitly reported nested subprocess scopes. No-default-features check also passes.

Linux client pool: **430 files in one complete pass, 7,923 passed, 56 declared skips, zero failures**. Both ordinary and model groups exit zero. `git status --porcelain` is empty immediately after the pool. Frozen native/SDK provenance and all 312 distribution leaf hashes are retained.

Fresh `publish.mjs --prepare-client` pack and `qualify-linux.mjs` consumer qualification **pass every case**, including all ROLL witnesses, frontends/starters, security, staging, migrations, production/proof-kit recipes, Ubuntu 24.04 and Alpine via proot. Receipt source is `f07884e368`. This is consumer-only qualification (`publicationQualified: false`); the complete source suites are executed separately, respecting the prohibition on `scripts/test.sh`.

The qualified production native SHA-256 is
`94d3bec462d9d97d2a067c3e7d6165553f81b17a7337a978fdb257c341c7c6b4`; the client
SHA-256 is `0db7dfee7482d0d62be8ed1f6f84af3b8126c3304411b10eb65c9034c0fda96f`.
The real-store, survey, acceptance and Exact checks below use those exact bytes.
After `02cb35b7a8`, `f07884e368` changes only the codec census tests and journal;
the fresh pack retains all 312 shipping SDK leaves and both artifact hashes.

Difftest passes its no-new-signature qualification: engine 20,000 seeds/1,222,111 executions; devices 0–999/27,922 executions; Lean 20,000 seeds/56,917 executions. Lean exits 1 for 130 known mismatches in four baseline signatures (3/35/67/25). The fresh 0.4.38 base reproduces the same oracle/coverage report and all 76 per-worker JSON/Quarry artifacts byte for byte; only timing fields are ignored. Raw exits and counterexamples are retained.

The complete private-PG16 script passes after the RT1/RT2 merge, including
commit-publication/query-snapshot witnesses, certified changes and SDK sync,
retained/pruned unknown tails, public serving and recount. Both owned clusters
are independently confirmed stopped (`pg_ctl` status 3, no PID file). Earlier
disk-guard stops are diagnostic attempts, not qualification passes.

Black M5, scratch clone `~/projects/snapback-integ23`: the full selected pool of
89 platform-sensitive client files passes (2,148 passed/14 skips), along with
the affected Rust core/language/device/simulator/CLI targets. The known
security-wave19 case passes alone and in its second complete 11-case target.
After the guide correction, the Mac native/platform pack and full packed proof
kit pass again. After the incoming serving changes, core passes 687 cases
(three ignores); the complete CLI binary passes 540 (12 named ignores), plus
clock 45, HTTP 11, replay 24 and rollback-view 14. Guide 127 and native build pass;
18 affected HTTP/client files pass (267 tests/two skips). Full init 51 and
store-port ratchet seven pass. Finally the corrected codec census passes all
28 tests on Mac and Linux. The final manifest covers 3,207 files with zero
mismatches and no extra Rust source. Archives retain logs, commands and source
manifests; final post-check journal/measurement updates change no executable
input.

All 50 wave-23 acceptance scripts pass with original bytes and assertions.
Three copied support helpers (007/026/029) explicitly expire sessions after
clock jumps; the implicit-expiry assumptions also fail on qualified 0.4.38.
The copied headless tsconfig removes the Expo-only extends. Original lanes stay
unchanged; helper diffs and original script hashes are retained.

Root setup completed: frozen install, workspace hoist and generated-artifact bootstrap. A forced frozen reinstall repaired missing TypeScript/Ajv links. Diagnostics/symbol/guide/flat generators and authoring (875), delivery (215) and zero-production-access store censuses pass. Earlier root inventory/guide/docs/ref checks pass without skips; final root checks will be repeated after the last main integration.

Exact uses a fresh clean clone of Exact2 origin/main
`14c091f205f62c32ed9d585ae75148cffc12dfa2`, including EX10 `contract migrate`,
under `~/sb4-loop/prewave23/exact2-postfix`. Private setup binds three Rust crates
and the packed SDK to this build; its setup patch is retained. Fresh synced and
online apps are at `synced-r6/app` and `online-r6/app` (ports 27406/27407); the
online app has a minimal authored contract/binding over its fresh online-only
backend. Both literal commands pass in each app:

```sh
timeout 1800s bun exact.mjs snapback
timeout 2400s bun exact.mjs test web
```

Synced: two web tests pass; online: one passes. Full scaffold, prebuild, command,
working-directory and artifact records are in `exact-commands-r6.md`; owned
servers are stopped and reaped.

The earlier full Rust attempt's sole failure was route-handler TypeScript
resolution of `#fetch` while a concurrent prepare-client removed SDK `dist`.
That overlap is the inferred cause. With stable distribution files the complete
nine-case route target passes alone. Later interrupted runs are superseded by
the final complete run; no interrupted attempt is relabeled green. The first
full pool after the RT1 merge exposes only the stale codec exception; it finishes
with a clean source tree. The corrected complete pool is recorded above.

Wasm measured after merged K0/shared-core changes: **2,407,070 raw / 735,469 gzip /
553,849 Brotli bytes**. Budget **735,969 B**, exactly gzip +500 B; reason records
merged shared-core/error/layout costs, without inventing isolated attribution.
This is +581 gzip B over qualified 0.4.38. Subsequent fixes affect CLI/language or
test census inputs, not the measured web core. Family/absence audits and client
build pass.

## Commands and limitations

Every shell command has an outer timeout; every Cargo invocation inherits
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
Linux full tests use dev opt-level 1, 12 build jobs and eight test threads;
Mac uses four jobs/threads. Assertions, seeds and product deadlines are retained.
Never ran forbidden `scripts/test.sh`; packed consumer-only qualification runs
all installed-consumer/Ubuntu/Alpine cases separately from the complete source
suites, and does not issue an npm publication receipt. No npm publish is requested.

The exact command record is `qualification-0.4.39/exact-commands-r6.md`. Final main integration and landing are recorded in the closing receipt after all required checks complete.


The final main merge `7cb3b67759` integrates RT1/RT2 through `a044e8d606` without
textual conflicts. `f3c917ee54` preserves the existing `complete: false` query
refusal marker when two generation handoffs are exhausted, keeping the original
refusal and attempted generation without another metadata read. Its strengthened
witness also forbids an invented head or evaluation cut. The case passes alone
on Linux/Mac and in the complete affected Mac target. `02cb35b7a8` records the
unchanged clean wasm measurement. `f07884e368` refreshes the codec census for the
SQLite-gated mutation extraction, removing the obsolete exception and adding a
mutant that must expose/refuse the serializer if that module gate is lifted.
No shipping Rust, SDK or wasm code changes in this final census correction.

Release has not yet been pushed. The completed snapshot is preserved under `snapback4/reports/integration23/qualification-f078/`. Main advanced to `ea0ea07e8f` with RT3 authority facts; its only textual conflict is the journal append. The integration preserves both histories. The incoming shared resolver constructs a native SQLite error above the store port; the prepared correction retains its exact error and shared cardinality decision while relocating only construction below the port. Final merged qualification and non-force landing remain in progress.

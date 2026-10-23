# Integration 23 — verification after the final main merge

This evidence supplements the complete rollback-fix qualification snapshot in
`../qualification-0.4.39/` (source a34a9192bc, report commit d848af3dc9). Main
merge 0d17e223d3 integrates a025d67cd3: P1-EV-2 Postgres admission/parity and
RT3c projected authority for account/OIDC/service sessions. There was no code
conflict; the parent RFC revision header preserves both histories. Source
4e3b52f1b3bf3c78055834d3d00decc732fc3f5c records the unchanged clean wasm.

The last authored rollback fix remains f6922d049f. The complete five-crate run
AFTER that fix passes 454 reported scopes, 7,562 reported passes and 360 declared
ignores, zero failures. This late integration reruns the changed semantic
inputs: full Core with Postgres enabled, affected CLI and language targets,
private Postgres including all 60 EV-2 evolution cases and public EV-2 witness,
three differential campaigns, a fresh prepared client pack and all consumer
proofs, the complete client pool in one pass, current production store/survey/
acceptance/Exact checks, Mac affected Cargo targets and all 103 platform client
files plus the two model files. It does not claim a second complete five-crate
run merely because main moved. Unchanged rollback source files and all 312 SDK
leaves are hash-bound in artifact-bindings.json. The Mac manifest binds the
current executable inputs, allowing only the explicitly regenerated test census;
its production allowance is zero.

The collector writes this directory only after all actual status guards pass.
manifest.json hashes each compressed raw file; .gz files preserve actual bytes.
artifact-bindings.json binds the current qualified musl binary to every replay
and Exact run, and the installed client pack to the current Mac and Linux SDK.
No npm publication is claimed: packed qualification is consumer-only and the
receipt says publicationQualified=false. The forbidden full scripts/test.sh is
not run; separately requested source suites execute directly.

Difftest engine 20k and devices 0–999 pass. Lean 20k retains only the known
0.4.38 baseline mismatches (raw exit 1): complete oracle verdicts, coverage and
case counts match apart from three timing fields. All 38 representative Quarry
inputs match byte-for-byte. Of 76 representative files, 52 are byte-identical;
24 query JSONs add only finding.left.value.pending_opening=null, the stronger
S10e-2a host diagnostic. Every other field/data/meter/canonical continuation is
identical. A nonnull dependency or any other difference blocks verification.
The original fresh-base counterexamples archive remains in qualification-f078.

Wave25 replays cover all 15 original refusals plus six ROLL controls: two genuine
deploy refusals (004/024), zero false refusals and zero hidden v1 rows in all six
ROLL controls. Lane030 deploys but default rollback genuinely refuses two rows
without a truthful retained preimage/down; its named recovery is recorded, not
claimed as a successful rollback. Replay stores are deleted; originals remain
read-only. Published 0.4.37 histories pass all 50 cycles, comprising 48 unchanged
copies plus two disclosed authored compatibility cases (010/032). Schema survey
covers 450 projects/900 records/1,800 human+JSON calls: zero false refusals,
15 SEC7-gated projects and all 36 original role-grant findings individually
acknowledged on copies. All 50 original acceptance script bytes pass; three
copy-only expiry helpers (007/026/029) reproduce baseline 0.4.38 assumptions,
and a headless tsconfig removes the unavailable Expo base.

Exact uses fresh synced/online apps under ~/sb4-loop/prewave23, clean Exact2
origin/main clone base14c091f205f62c32ed9d585ae75148cffc12dfa2 (EX10), only private
merged Snapback crate/client bindings, literal bun exact.mjs snapback and
bun exact.mjs test web, and explicit owned-server cleanup. exact-commands-r11.md
records every command, cwd, environment, artifact hash and ports27416/27417.
Mac uses only /Users/ccheever/projects/snapback-integ23 on the black M5.

The stock Postgres script retains its three explicit inherited ticketed
exclusions; the original two-writer stress still runs. Incoming EV-2 leaves an
open residual dev-adoption diagnostic-text ticket; no universal diagnostic-text
parity or full 3MiB active-row restoration is claimed. The shared active-row
bound remains in place. Both owned private clusters are independently stopped
(pg_ctl status3/no PID). Performance benchmark tails are not a release claim.

Clean wasm is unchanged: 2,407,070 B raw /735,469 B gzip /553,849 B Brotli;
budget735,969 B is exactly measurement+500 B. Strict family/absence audits pass.
Every shell command has a timeout and Cargo disables incremental/dev/test debug.
Publication worktrees and target/publication are never used.

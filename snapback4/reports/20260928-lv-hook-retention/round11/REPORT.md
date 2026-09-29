# LV round 11 — keep local evidence local

Fix-forward after LV landed, branch `sb4-intent/lv-hook-retention`. The required
`git fetch origin && git merge origin/main` fast-forwarded `c3ab7b37e` to
`ee514de11`. Read all rounds 0–10 prompts/reports/journal entries, LLP 3000.029,
the Snapback 4 fence and rules, client/reads guide, and Astra's full round-10
NOT READY review. Applied llp-orient. No push or publication.

## Changes

Local data and evaluated denials retain their provenance through final
reconciliation. Their attempt tickets enter the same publication order at the
last synchronous gate, after all intervening continuations and scope, remote
fence and deadline checks. Accepted local results reconcile matching peers;
other arguments remain runnable on the already-acquired replica. They neither
create an unapplied remote fence nor discharge existing remote evidence.
Success advances order without caching replica data as a server answer; denial
retires that key's remembered answer. An older result cannot replace a newer
accepted local success or denial.

Both internal `search_state` forwarding sites attach SDK admission origin.
An actual E_BOUND after successful HTTP decoding therefore preserves retained
rows and their original device/server deadlines. Evaluated query E_BOUND remains
authority. Existing checkpoints process explicit terminal boundaries before
forwarding the metadata diagnostic. No code-string exclusion, meter charge,
allowance, dependency, retry policy or wasm source changed. No production await
was added or moved; the 166 delivery-matrix classifications remain unchanged.

LLP 3000.029 §13 and Revised correct the prior rounds' overbroad fence language.
Client/reads guide cards, their existing text snapshot and the client operations
manual now distinguish local evaluation from remote evidence. The LLP remains
Implemented and archived. No new LLP or workflow gate was added.

## Reproductions and properties

All nine new real-host cases fail at the intended assertions on the unchanged
round-10 SDK, and pass on both round 11 and the isolated pre-LV SDK from
`ee514de11^1`. The comparison uses the same server/device implementation to
isolate the SDK regression. See before.log.gz and pre-lv-regressions.log.gz.

- Process and wasm: repeated acquired `doc(id) held` reads, alternating present
  and NOT_FOUND, keep the mounted present document with zero HTTP queries and
  no further sync.
- Process and wasm: buffer an early clock-dependent Quarry denial, accept a
  newer mounted and direct local success, then release the denial. A third
  case executes the actual Rust native guest's `ctx.now()` on process. No HTTP
  query or extra sync occurs. This is native-process evidence, not Expo UI;
  wasm uses the equivalent Quarry evaluation.
- Process and wasm, both metadata sites: real Rust `search_state` refuses its
  budget. The after-decode case pads a valid real HTTP 200 with JSON whitespace
  to leave 4,096–4,127 heap bytes; decoding succeeds, then Rust's 8 KB metadata
  reservation refuses. Opening cases inject the spent ledger into the real
  call. Retained rows and both deadlines survive, while direct/opt-out reads
  expose E_BOUND.

Thirty independent seeds schedule 120 local events each, plus draining, across
two argument keys, default/keep:true owners and direct reads. The oracle owns
request order and answers, while evaluation completion and final publication
are separately scheduled. It checks no loading after an accepted answer and
no older answer over a newer one, with no remote evidence and no remembered
local data. Removing success registration in an isolated SDK copy fails all
30 seeds with the ordering assertion (controls.json). Both sites also have
origin-by-call-site and explicit terminal-checkpoint controls; a real native
E_BOUND case guards against code-based exclusion.

Final targeted run on the freshly rebuilt canonical wasm: **45/45**. Includes
the nine host regressions, six metadata origin/terminal controls and 30 new
property seeds. Existing remote disclosure models and boundaries remain in the
affected and full suites. Overlapping test counts must not be added.

## Verification

- Affected suite: **1,453/1,453**, zero failed/cancelled/skipped, 151.5 seconds.
  Includes all retention/fencing/footprint/ephemeral suites and models, FU
  overload/transports, browser witnesses and all **333** delivery-matrix checks.
  Command: affected-command.json; log: affected.log.gz.
- FU server overload: **3/3**, server-overload.log.gz.
- Whole guide: **98/98**, guide-final.log.gz. The first stale-snapshot
  failure is retained in guide.log.gz and FAILURES.md.
- Pre-LV regression census: 1,007/1,007 on pre-LV; identical 788 pass / 219
  old-contract failures on both round 10 and round 11, detailed below.
- `scripts/test.sh` ran **once**, exit 0. Exact summary:
  `== 0 failure(s) in 1322 s`. All stages passed, including Rust, canonical
  wasm, both app typechecks, fixtures, **4,848 client tests** (ten skips) and
  **79 models**. No full-suite failures: ours 0 / baseline 0 / environmental 0.
  Log: test-sh.log.gz; stages/counts: full-suite.json. The ten declared platform
  or opt-in compatibility skips are listed in full-suite-skips.json; no Expo
  native UI or missing historical-binary qualification is claimed.
- Package build/typecheck, reference and whitespace checks are also recorded.

## Historical regression census

The isolated pre-LV SDK passes **1,007/1,007** unchanged pre-LV tests across
42 files. The same originals give **788 pass / 219 fail** on both round 10 and
round 11, with exactly the same failing names and zero cancellations/skips.
[CENSUS.md](CENSUS.md) lists every failure, its original location and the
specific previously authorized behavior/fixture change. All are attributed to
LV. This is not a green historical comparison or a baseline exemption.

The old failures cover retention through actual dependency evidence, the
removed one-second deadline, unavailable loading/transport retention, direct
peer publication order, facade replacement approval and bounded expiry retries.
The original retained-row helper delivers remote changes while holding sync;
current plain provenance tests park both and pass unchanged assertions. There
is no newly failing round-11 plain-read expectation. The nine requested
real-host regressions pass on pre-LV and round 11, failing on round 10.

The selection includes retention, keep/authority/expiry, read/query/presence,
ephemeral/fencing and property suites; mock/type/adoption/docs-only files are
outside this runtime comparison. The 1,453-test affected suite additionally
covers LV-only footprint/fence/history modules absent from the pre-LV SDK.
Census inputs/commands are in census-files.json, census-results.json and
census-round10-result.json; census.py preserves the original assertions in
isolated copies. All controls use this round's server to isolate SDK behavior.
The old presence-refresh assertion leaks a timer on failure; its sole remaining
child was stopped on each LV control and its unchanged file independently
rerun with --test-force-exit: 9 pass / 1 fail each. Full details and the initial
round-10 import-setup failures are retained in CENSUS.md and FAILURES.md.

## Wasm and custody

The canonical build in this round's `scripts/test.sh` produces **2,042,203 B raw
/ 593,573 B GNU file-input gzip-9**, matching main's reported 593,573 B. Unchanged
cap **593,719 B**, headroom **146 B**, delta **0 B**. SHA-256:
`75104fe4882479ef2bfd8796df9d655853739084640c11457cffbb50309a6e2c`.
Node 24.13.1, Rust 1.97.0, wasm-bindgen 0.2.127. No wasm-opt or budget change.
See wasm-measurement.json.

No tools were installed. Generated SDK/wasm, native guest builds and isolated
comparison clients remain ignored under this worktree. The local commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing pushed or published.

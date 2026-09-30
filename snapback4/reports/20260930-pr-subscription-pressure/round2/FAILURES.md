# Failure ledger

Final qualification is in REPORT.md. This ledger includes development failures and intentional detecting controls. Logs are retained as gzip files with the original names below.

## Setup and measurement failures

- **Ours:** the first main SDK control used a repository-relative path from the Snapback 4 subdirectory and selected no source files. Its four apparent passes in `main-remount.log` used copied current bytes and are invalid. The helper now requires a nonempty source inventory containing local.ts.
- **Ours:** the next main build omitted TypeScript file names and interpreted generics as TSX. `main-remount-corrected.log` is an invalid control, not behavioral evidence. The final main control transpiles every original path correctly and fails all four revocation assertions.
- **Ours:** initial guide text linked a GitHub source file outside the package; the published-reference test rejected it twice. The relative packaged reference passes the whole guide.
- **Ours:** live SDK rebuilds overlapped one LL rerun. `ll-verified-process-0.log` ends with `page.evaluate: Execution context was destroyed, most likely because of a navigation`. The process/3 cell was not run; this partial matrix is excluded from successful-trial claims. Later matrices run without modifying the SDK.
- **Ours:** incidental commands used an extra `snapback4/` prefix while already in that directory, looked for a summary before generating it, used a stale patch context, or initially treated flat pressure samples as nested totals. Corrected paths were used; these inspection/setup errors supplied no test evidence.
- **Ours:** ref-check was once invoked from snapback4 instead of the repository root and reported zero LLP documents / 1,289 missing refs. `ref-check-wrong-cwd.log` preserves that invocation error. The root invocation passes.
- **Environmental:** the affected native `/changes` timing test measured total 1000.269 ms, engine 449.281 ms, wait 13.315 ms, CPU 55.831 ms; it expected at least 600 ms outside engine/wait. This unchanged route/test passed alone in 1.02 s and in the full suite. The failure occurred while wasm compilation and affected tests were also running. This is a timing-contention inference supported by the isolated rerun, not a reproduced baseline product failure.

## Failed tests by run

### affected.log

- **ours — contaminated development run; SDK rebuild overlapped browser acquisition; isolated final run passed** — wasm: 1,000 per-row hooks retain through a relevant write with the real clock
- **ours — unfinished dormant-refusal fix still reset the refusal to loading in scheduleRead** — wasm: a dormant local handle checks terminal refusal before reuse
- **ours — unfinished dormant-refusal fix still reset the refusal to loading in scheduleRead** — process: a dormant local handle checks terminal refusal before reuse

### approval-control.log

- **ours — deliberate single-fence revert; expected stale-approval rejection** — wasm: a dormant local handle checks terminal refusal before reuse
- **ours — deliberate single-fence revert; expected stale-approval rejection** — process: a dormant local handle checks terminal refusal before reuse

### before.log

- **baseline — deliberate pre-fix detecting control** — closed facade deadline cannot follow later queue pauses; closeBeforeReload=true
- **baseline — deliberate pre-fix detecting control** — wasm: reuse closed handle after published revocation
- **baseline — deliberate pre-fix detecting control** — wasm: reuse closed handle after staged revocation
- **baseline — deliberate pre-fix detecting control** — process: reuse closed handle after published revocation
- **baseline — deliberate pre-fix detecting control** — process: reuse closed handle after staged revocation

### closed-metadata-before.log

- **ours — frozen deadline copy missed same-identity existence metadata; source-object tracking fixes it** — closed deadline copy follows same-identity existence changes

### corrected-affected.log

- **ours — new assertion expected a loading notification before the subscriber was attached; final assertions prove immediate withdrawal and later authorized replacement delivery** — wasm: raw resubscription validates revocation before starting a bounded episode
- **ours — new assertion expected a loading notification before the subscriber was attached; final assertions prove immediate withdrawal and later authorized replacement delivery** — wasm: raw resubscription validates revocation before rearming its original episode
- **ours — new assertion expected a loading notification before the subscriber was attached; final assertions prove immediate withdrawal and later authorized replacement delivery** — process: raw resubscription validates revocation before starting a bounded episode
- **ours — new assertion expected a loading notification before the subscriber was attached; final assertions prove immediate withdrawal and later authorized replacement delivery** — process: raw resubscription validates revocation before rearming its original episode

### focused-final.log

- **ours — unfinished dormant-refusal fix still reset the refusal to loading in scheduleRead** — wasm: a dormant local handle checks terminal refusal before reuse
- **ours — unfinished dormant-refusal fix still reset the refusal to loading in scheduleRead** — process: a dormant local handle checks terminal refusal before reuse

### focused-qualified.log

- **ours — introduced recursive close notification; stable refusal-code comparison fixes it** — wasm: reuse closed handle after published revocation, keep=undefined
- **ours — introduced recursive close notification; stable refusal-code comparison fixes it** — wasm: reuse closed handle after published revocation, keep=true
- **ours — introduced recursive close notification; stable refusal-code comparison fixes it** — wasm: reuse closed handle after published revocation, keep=false
- **ours — introduced recursive close notification; stable refusal-code comparison fixes it** — wasm: reuse closed handle after staged revocation, keep=undefined
- **ours — introduced recursive close notification; stable refusal-code comparison fixes it** — wasm: reuse closed handle after staged revocation, keep=true
- **ours — introduced recursive close notification; stable refusal-code comparison fixes it** — wasm: reuse closed handle after staged revocation, keep=false
- **ours — introduced recursive close notification; stable refusal-code comparison fixes it** — process: reuse closed handle after published revocation, keep=undefined
- **ours — introduced recursive close notification; stable refusal-code comparison fixes it** — process: reuse closed handle after published revocation, keep=true
- **ours — introduced recursive close notification; stable refusal-code comparison fixes it** — process: reuse closed handle after published revocation, keep=false
- **ours — introduced recursive close notification; stable refusal-code comparison fixes it** — process: reuse closed handle after staged revocation, keep=undefined
- **ours — introduced recursive close notification; stable refusal-code comparison fixes it** — process: reuse closed handle after staged revocation, keep=true
- **ours — introduced recursive close notification; stable refusal-code comparison fixes it** — process: reuse closed handle after staged revocation, keep=false

### full-suite.log

- **ours — old cross-handle object-alias assertion conflicts with independent closed deadline; replaced by answer identity, equal facts and per-handle stability, 54 affected tests pass** — closed facade follows same identity's revalidation (close before=false), keep=undefined, bounded=true
- **ours — old cross-handle object-alias assertion conflicts with independent closed deadline; replaced by answer identity, equal facts and per-handle stability, 54 affected tests pass** — closed facade follows same identity's revalidation (close before=true), keep=undefined, bounded=true
- **ours — old cross-handle object-alias assertion conflicts with independent closed deadline; replaced by answer identity, equal facts and per-handle stability, 54 affected tests pass** — closed facade follows same identity's revalidation (close before=false), keep=true, bounded=true
- **ours — old cross-handle object-alias assertion conflicts with independent closed deadline; replaced by answer identity, equal facts and per-handle stability, 54 affected tests pass** — closed facade follows same identity's revalidation (close before=true), keep=true, bounded=true
- **ours — existing assertion explicitly expected revoked rows until the episode deadline; updated to immediate pre-resubscription withdrawal and no stale callback** — wasm: resubscribing a raw local handle starts a bounded episode
- **ours — existing assertion explicitly expected revoked rows until the episode deadline; updated to immediate pre-resubscription withdrawal and no stale callback** — wasm: resubscribing a raw local handle rearms its original episode
- **ours — existing assertion explicitly expected revoked rows until the episode deadline; updated to immediate pre-resubscription withdrawal and no stale callback** — process: resubscribing a raw local handle starts a bounded episode
- **ours — existing assertion explicitly expected revoked rows until the episode deadline; updated to immediate pre-resubscription withdrawal and no stale callback** — process: resubscribing a raw local handle rearms its original episode

### guide-final.log

- **ours — client guide linked an unshipped reference; changed to packaged relative reference** — client::published::published_file_references_resolve_against_package_contents

### guide.log

- **ours — client guide linked an unshipped reference; changed to packaged relative reference** — client::published::published_file_references_resolve_against_package_contents

### main-remount-corrected.log

- **ours — invalid control build parsed .ts as TSX; corrected before main conclusion** — packages/snapback4/test/subscription-pressure-round2.test.mjs

### main-remount-final.log

- **baseline — deliberate pre-fix detecting control** — wasm: reuse closed handle after published revocation
- **baseline — deliberate pre-fix detecting control** — wasm: reuse closed handle after staged revocation
- **baseline — deliberate pre-fix detecting control** — process: reuse closed handle after published revocation
- **baseline — deliberate pre-fix detecting control** — process: reuse closed handle after staged revocation

### round1-negative-complete.log

- **baseline — deliberate pre-fix detecting control** — closed facade deadline cannot follow later queue pauses; closeBeforeReload=false
- **baseline — deliberate pre-fix detecting control** — closed facade deadline cannot follow later queue pauses; closeBeforeReload=true
- **baseline — deliberate pre-fix detecting control** — online authorized sibling re-read jumps ordinary queued work after evidence
- **baseline — deliberate pre-fix detecting control** — evidence priority survives an active attempt retiring into the queue
- **baseline — deliberate pre-fix detecting control** — ObserveOptions documents plain retention and bounded change evidence for omitted and true
- **baseline — deliberate pre-fix detecting control** — wasm: reuse closed handle after published revocation, keep=undefined
- **baseline — deliberate pre-fix detecting control** — wasm: reuse closed handle after staged revocation, keep=undefined
- **baseline — deliberate pre-fix detecting control** — process: reuse closed handle after published revocation, keep=undefined
- **baseline — deliberate pre-fix detecting control** — process: reuse closed handle after staged revocation, keep=undefined
- **baseline — deliberate pre-fix detecting control** — scope loss fences remembered server answers without a mounted owner
- **baseline — deliberate pre-fix detecting control** — wasm: a dormant local handle checks terminal refusal before reuse
- **baseline — deliberate pre-fix detecting control** — process: a dormant local handle checks terminal refusal before reuse
- **baseline — deliberate pre-fix detecting control** — wasm: published removal preserves server-backed sibling
- **baseline — deliberate pre-fix detecting control** — wasm: staged removal preserves server-backed sibling
- **baseline — deliberate pre-fix detecting control** — process: published removal preserves server-backed sibling
- **baseline — deliberate pre-fix detecting control** — process: staged removal preserves server-backed sibling
- **baseline — deliberate pre-fix detecting control** — wasm: combined retained/server scopes preserve the authorized room
- **baseline — deliberate pre-fix detecting control** — process: combined retained/server scopes preserve the authorized room

### round1-negative-final.log

- **baseline — deliberate pre-fix detecting control** — closed facade deadline cannot follow later queue pauses; closeBeforeReload=false
- **baseline — deliberate pre-fix detecting control** — closed facade deadline cannot follow later queue pauses; closeBeforeReload=true
- **baseline — deliberate pre-fix detecting control** — online authorized sibling re-read jumps ordinary queued work after evidence
- **baseline — deliberate pre-fix detecting control** — evidence priority survives an active attempt retiring into the queue
- **baseline — deliberate pre-fix detecting control** — ObserveOptions documents plain retention and bounded change evidence for omitted and true
- **baseline — deliberate pre-fix detecting control** — wasm: reuse closed handle after published revocation, keep=undefined
- **baseline — deliberate pre-fix detecting control** — wasm: reuse closed handle after staged revocation, keep=undefined
- **baseline — deliberate pre-fix detecting control** — process: reuse closed handle after published revocation, keep=undefined
- **baseline — deliberate pre-fix detecting control** — process: reuse closed handle after staged revocation, keep=undefined
- **baseline — deliberate pre-fix detecting control** — scope loss fences remembered server answers without a mounted owner
- **baseline — deliberate pre-fix detecting control** — wasm: a dormant local handle checks terminal refusal before reuse
- **baseline — deliberate pre-fix detecting control** — process: a dormant local handle checks terminal refusal before reuse
- **baseline — deliberate pre-fix detecting control** — wasm: published removal preserves server-backed sibling
- **baseline — deliberate pre-fix detecting control** — wasm: staged removal preserves server-backed sibling
- **baseline — deliberate pre-fix detecting control** — process: published removal preserves server-backed sibling
- **baseline — deliberate pre-fix detecting control** — process: staged removal preserves server-backed sibling
- **baseline — deliberate pre-fix detecting control** — wasm: combined retained/server scopes preserve the authorized room
- **baseline — deliberate pre-fix detecting control** — process: combined retained/server scopes preserve the authorized room

### round1-negative.log

- **baseline — deliberate pre-fix detecting control** — closed facade deadline cannot follow later queue pauses; closeBeforeReload=false
- **baseline — deliberate pre-fix detecting control** — closed facade deadline cannot follow later queue pauses; closeBeforeReload=true
- **baseline — deliberate pre-fix detecting control** — online authorized sibling re-read jumps ordinary queued work after evidence
- **baseline — deliberate pre-fix detecting control** — ObserveOptions documents plain retention and bounded change evidence for omitted and true
- **baseline — deliberate pre-fix detecting control** — wasm: reuse closed handle after published revocation
- **baseline — deliberate pre-fix detecting control** — wasm: reuse closed handle after staged revocation
- **baseline — deliberate pre-fix detecting control** — process: reuse closed handle after published revocation
- **baseline — deliberate pre-fix detecting control** — process: reuse closed handle after staged revocation
- **baseline — deliberate pre-fix detecting control** — scope loss fences remembered server answers without a mounted owner
- **baseline — deliberate pre-fix detecting control** — wasm: two-room server-result control under capacity pressure
- **baseline — deliberate pre-fix detecting control** — process: two-room server-result control under capacity pressure
- **baseline — deliberate pre-fix detecting control** — wasm: combined retained/server scopes preserve the authorized room
- **baseline — deliberate pre-fix detecting control** — process: combined retained/server scopes preserve the authorized room

### server-affected.log

- **environmental — wall-clock attribution under concurrent load; isolated rerun passed** — serve::tests::latency_tests::headers::changes_refresh_is_engine_work_but_poll_sleep_is_not

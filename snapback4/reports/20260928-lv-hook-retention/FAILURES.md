# Failure inventory — Lane LV

Every named failing test/build marker captured in the lane logs is listed below,
including repeated runs. Duplicate reporter summaries of the same case in one
log are represented by `occurrences` in [failures.json](./failures.json).
The complete diagnostics remain in the corresponding compressed logs. Entries
retain the original test name, including assertions subsequently renamed to
state the new contract. A file named “qualified” is not evidence of passing;
read its result. The report selects only verified passing runs.

**Attribution:** all implementation, assertion, fixture and scheduling failures
are **ours**. No baseline failure was established. The only environmental failure
is the absent dedicated iOS simulator. Two stuck test children in the complete
run (asset-lists and presence-refresh) were terminated after their failures;
cleanup registration was fixed, and final affected runs complete normally.

The first implementation exposed dependencies after revalidation instead of
withdrawing them, renewed expiry on unavailable replies, dropped offline data,
and allowed newer one-shot refusal evidence to miss a mounted observation.
The final affected run also caught synthetic direct-query `E_OFFLINE` being
broadcast as authority evidence; the guard now excludes transport failures,
with retention and genuine denial/null/empty regressions. Those are product
defects fixed in this lane. Other failures asserted the
superseded one-second timeout or retention across revocation; their assertions
now require indefinite plain retention and immediate withdrawal on evidence.
The independent approval oracle retains its 120 seeds × 240 steps × 3 policies.
Paging tests explicitly account for a renewed read after input invalidation.

Harness corrections: browser generated-module syntax/readiness/favicon checks;
mock asset fetches now distinguish the new `/changes` poll; malformed rule and
immutable-field fixtures fixed; held requests always released on cleanup;
permanent `E_INPUT` no longer retries on every sync; asset grant sequences
prevent historical sync from withdrawing a newer grant. A wasm ENOENT in
`final-boundaries.log` was our scheduling interference while the complete suite
rebuilt its generated wasm directory. Source types initially needed boolean
cache-admission returns and an explicit optional server sequence type.

Operational mistakes without a persisted test log: two edit invocations used
repository-relative paths from the Snapback 4 subdirectory and stopped at
FileNotFoundError before editing; rerun with the correct base.
An initial Rust `serve_assets` name filter selected zero cases; the corrected
`image_list_http` filter ran all three asset-serving cases. The initial browser
and build iterations are also retained where logged. No failed invocation is
represented as a passing qualification.

## [additional-disclosure.log.gz](./additional-disclosure.log.gz) — 1 distinct markers

- **ours**, line 49: online: a rule change withdraws a displayed row and asset before its held replacement

## [affected-initial.log.gz](./affected-initial.log.gz) — 199 distinct markers

- **ours**, line 1: wasm: apply revocation, keep=undefined, held
- **ours**, line 2: wasm: admit revocation, keep=undefined, held
- **ours**, line 3: wasm: transfer revocation, keep=undefined, held
- **ours**, line 5: wasm: apply revocation, keep=undefined, throw
- **ours**, line 6: wasm: admit revocation, keep=undefined, throw
- **ours**, line 7: wasm: transfer revocation, keep=undefined, throw
- **ours**, line 8: wasm: apply revocation, keep=undefined, unavailable
- **ours**, line 9: wasm: admit revocation, keep=undefined, unavailable
- **ours**, line 10: wasm: transfer revocation, keep=undefined, unavailable
- **ours**, line 11: wasm: apply revocation, keep=undefined, retryExhausted
- **ours**, line 12: wasm: admit revocation, keep=undefined, retryExhausted
- **ours**, line 13: wasm: transfer revocation, keep=undefined, retryExhausted
- **ours**, line 18: process: apply revocation, keep=undefined, held
- **ours**, line 19: process: admit revocation, keep=undefined, held
- **ours**, line 20: process: transfer revocation, keep=undefined, held
- **ours**, line 22: process: apply revocation, keep=undefined, throw
- **ours**, line 23: process: admit revocation, keep=undefined, throw
- **ours**, line 24: process: transfer revocation, keep=undefined, throw
- **ours**, line 25: process: apply revocation, keep=undefined, unavailable
- **ours**, line 26: process: admit revocation, keep=undefined, unavailable
- **ours**, line 27: process: transfer revocation, keep=undefined, unavailable
- **ours**, line 28: process: apply revocation, keep=undefined, retryExhausted
- **ours**, line 29: process: admit revocation, keep=undefined, retryExhausted
- **ours**, line 30: process: transfer revocation, keep=undefined, retryExhausted
- **ours**, line 35: online: revoked data, keep=undefined, held
- **ours**, line 36: online: revoked data, keep=undefined, retryExhausted
- **ours**, line 37: online: revoked data, keep=undefined, unavailable
- **ours**, line 38: online: revoked data, keep=undefined, throw
- **ours**, line 63: createApp wasm keep=undefined: held expiry fences late HTTP memory before rollback, preserving newer B
- **ours**, line 64: createApp wasm keep=true: held expiry fences late HTTP memory before rollback, preserving newer B
- **ours**, line 65: createApp keep=undefined property: online, seed 23, 50ms authority
- **ours**, line 66: createApp keep=undefined property: online, seed 44, 50ms authority
- **ours**, line 67: createApp keep=undefined property: online, seed 445, 50ms authority
- **ours**, line 68: createApp keep=undefined property: wasm, seed 23, 50ms authority
- **ours**, line 69: createApp keep=undefined property: wasm, seed 44, 50ms authority
- **ours**, line 70: createApp keep=undefined property: wasm, seed 445, 50ms authority
- **ours**, line 71: createApp keep=undefined property: process, seed 23, 50ms authority
- **ours**, line 72: createApp keep=undefined property: process, seed 44, 50ms authority
- **ours**, line 73: createApp keep=undefined property: process, seed 445, 50ms authority
- **ours**, line 74: createApp keep=true property: online, seed 23, 50ms authority
- **ours**, line 75: createApp keep=true property: online, seed 44, 50ms authority
- **ours**, line 76: createApp keep=true property: online, seed 445, 50ms authority
- **ours**, line 77: createApp keep=true property: wasm, seed 23, 50ms authority
- **ours**, line 78: createApp keep=true property: wasm, seed 44, 50ms authority
- **ours**, line 79: createApp keep=true property: wasm, seed 445, 50ms authority
- **ours**, line 80: createApp keep=true property: process, seed 23, 50ms authority
- **ours**, line 81: createApp keep=true property: process, seed 44, 50ms authority
- **ours**, line 82: createApp keep=true property: process, seed 445, 50ms authority
- **ours**, line 83: createApp keep=undefined: useQuery and usePage preserve inputs through 20 replacements, loaded cursors and removal
- **ours**, line 84: createApp keep=true: useQuery and usePage preserve inputs through 20 replacements, loaded cursors and removal
- **ours**, line 96: opening remount getter and notifications follow shared replacements, keep=undefined
- **ours**, line 98: a live waiting facade holds A until its peer approves shared B, keep=undefined
- **ours**, line 105: opening remount getter and notifications follow shared replacements, keep=true
- **ours**, line 107: a live waiting facade holds A until its peer approves shared B, keep=true
- **ours**, line 110: opening remount receives the revalidating mark during replacement, keep=undefined
- **ours**, line 112: opening remount receives the revalidating mark during replacement, keep=true
- **ours**, line 113: facade holds A until its device deadline (timer), including a lingering remount
- **ours**, line 114: facade holds A until its device deadline (correction), including a lingering remount
- **ours**, line 115: facade holds A until its server deadline (timer), including a lingering remount
- **ours**, line 116: facade holds A until its server deadline (correction), including a lingering remount
- **ours**, line 117: held server data ignores a device reobservation wakeup, even when device time is ahead
- **ours**, line 119: all facade deadlines withdraw before a subscriber rolls the clock back
- **ours**, line 120: held approval ends on scope
- **ours**, line 121: held approval ends on denied
- **ours**, line 122: held approval ends on authority
- **ours**, line 123: held approval ends on fence
- **ours**, line 124: held approval ends on linger
- **ours**, line 127: held device deadline is latched by peek before timer delivery
- **ours**, line 128: held server deadline is latched by snapshot before timer delivery
- **ours**, line 129: held server deadline is latched by peek before timer delivery
- **ours**, line 130: opening remount is notified on reset
- **ours**, line 131: opening remount is notified on denied
- **ours**, line 132: opening remount is notified on retire
- **ours**, line 133: independent authority completions preserve the newest check: B-first
- **ours**, line 177: wasm: keep=undefined across apply publishes no loading and replaces the old answer
- **ours**, line 178: wasm: keep=undefined across admit publishes no loading and replaces the old answer
- **ours**, line 179: wasm: keep=undefined across settle publishes no loading and replaces the old answer
- **ours**, line 180: wasm: keep=undefined across revoke publishes no loading and replaces the old answer
- **ours**, line 181: wasm: keep=undefined across leave publishes no loading and replaces the old answer
- **ours**, line 182: wasm: keep=undefined across refusal publishes no loading and replaces the old answer
- **ours**, line 183: process: keep=undefined across apply publishes no loading and replaces the old answer
- **ours**, line 184: process: keep=undefined across admit publishes no loading and replaces the old answer
- **ours**, line 185: process: keep=undefined across settle publishes no loading and replaces the old answer
- **ours**, line 186: process: keep=undefined across revoke publishes no loading and replaces the old answer
- **ours**, line 187: process: keep=undefined across leave publishes no loading and replaces the old answer
- **ours**, line 188: process: keep=undefined across refusal publishes no loading and replaces the old answer
- **ours**, line 189: wasm: keep=true across apply publishes no loading and replaces the old answer
- **ours**, line 190: wasm: keep=true across admit publishes no loading and replaces the old answer
- **ours**, line 191: wasm: keep=true across settle publishes no loading and replaces the old answer
- **ours**, line 192: wasm: keep=true across revoke publishes no loading and replaces the old answer
- **ours**, line 193: wasm: keep=true across leave publishes no loading and replaces the old answer
- **ours**, line 194: wasm: keep=true across refusal publishes no loading and replaces the old answer
- **ours**, line 195: process: keep=true across apply publishes no loading and replaces the old answer
- **ours**, line 196: process: keep=true across admit publishes no loading and replaces the old answer
- **ours**, line 197: process: keep=true across settle publishes no loading and replaces the old answer
- **ours**, line 198: process: keep=true across revoke publishes no loading and replaces the old answer
- **ours**, line 199: process: keep=true across leave publishes no loading and replaces the old answer
- **ours**, line 200: process: keep=true across refusal publishes no loading and replaces the old answer
- **ours**, line 204: wasm: keep=undefined never publishes an evaluation captured before a newer commit
- **ours**, line 205: process: keep=undefined never publishes an evaluation captured before a newer commit
- **ours**, line 206: wasm: keep=true never publishes an evaluation captured before a newer commit
- **ours**, line 207: process: keep=true never publishes an evaluation captured before a newer commit
- **ours**, line 209: wasm: a closed raw local observation still latches its episode deadline
- **ours**, line 211: process: a closed raw local observation still latches its episode deadline
- **ours**, line 212: wasm keep=undefined: expiry withdraws across apply with the replacement held
- **ours**, line 213: wasm keep=undefined: expiry withdraws across admit with the replacement held
- **ours**, line 214: wasm keep=undefined: expiry withdraws across settle with the replacement held
- **ours**, line 215: wasm keep=true: expiry withdraws across apply with the replacement held
- **ours**, line 216: wasm keep=true: expiry withdraws across admit with the replacement held
- **ours**, line 217: wasm keep=true: expiry withdraws across settle with the replacement held
- **ours**, line 221: process keep=undefined: expiry withdraws across apply with the replacement held
- **ours**, line 222: process keep=undefined: expiry withdraws across admit with the replacement held
- **ours**, line 223: process keep=undefined: expiry withdraws across settle with the replacement held
- **ours**, line 224: process keep=true: expiry withdraws across apply with the replacement held
- **ours**, line 225: process keep=true: expiry withdraws across admit with the replacement held
- **ours**, line 226: process keep=true: expiry withdraws across settle with the replacement held
- **ours**, line 230: online keep=undefined: expiry withdraws across notification with the replacement held
- **ours**, line 231: online keep=true: expiry withdraws across notification with the replacement held
- **ours**, line 258: local keep: apply fences in-flight answers and keeps active and lingering data
- **ours**, line 259: local keep: admit fences in-flight answers and keeps active and lingering data
- **ours**, line 260: local keep: settle fences in-flight answers and keeps active and lingering data
- **ours**, line 265: keep carries original freshness through reload, and every published result replaces it
- **ours**, line 268: online keep: mutation waits without loading, then publishes next
- **ours**, line 269: online keep: mutation waits without loading, then publishes denied
- **ours**, line 270: online keep: notification waits without loading, then publishes next
- **ours**, line 271: online keep: notification waits without loading, then publishes denied
- **ours**, line 279: online keep: an in-flight answer read before a newer commit never replaces the kept answer
- **ours**, line 280: the app client forwards keep while its lifetime fence still withdraws data
- **ours**, line 282: createApp keeps a superseded answer while replacement authority is held
- **ours**, line 324: replacement completes and clears revalidation: keep=undefined, "B"
- **ours**, line 325: replacement completes and clears revalidation: keep=undefined, null
- **ours**, line 326: replacement completes and clears revalidation: keep=undefined, []
- **ours**, line 327: replacement completes and clears revalidation: keep=undefined, {"denied":{"code":"HIDDEN","family":"rule","message":"hidden"}}
- **ours**, line 328: hard withdrawals replace retained data: keep=undefined, throw
- **ours**, line 329: hard withdrawals replace retained data: keep=undefined, transportOffline
- **ours**, line 330: hard withdrawals replace retained data: keep=undefined, retryExhausted
- **ours**, line 332: hard withdrawals replace retained data: keep=undefined, loading
- **ours**, line 337: hard withdrawals replace retained data: keep=true, throw
- **ours**, line 338: hard withdrawals replace retained data: keep=true, transportOffline
- **ours**, line 339: hard withdrawals replace retained data: keep=true, retryExhausted
- **ours**, line 341: hard withdrawals replace retained data: keep=true, loading
- **ours**, line 351: one stable episode withdrawal at the deadline via snapshot, late success still lands
- **ours**, line 352: one stable episode withdrawal at the deadline via peek, late success still lands
- **ours**, line 353: one stable episode withdrawal at the deadline via timer, late success still lands
- **ours**, line 354: successful fallback and held composition keep the same episode: keep=undefined
- **ours**, line 362: facade and opening remount share source expiry, keep=undefined
- **ours**, line 363: facade and opening remount share source loading, keep=undefined
- **ours**, line 364: facade and opening remount share source transportOffline, keep=undefined
- **ours**, line 365: facade and opening remount share source retain:false, keep=undefined
- **ours**, line 366: facade and opening remount share source reset, keep=undefined
- **ours**, line 367: facade and opening remount share source denied, keep=undefined
- **ours**, line 368: facade and opening remount share source expiry, keep=true
- **ours**, line 369: facade and opening remount share source loading, keep=true
- **ours**, line 370: facade and opening remount share source transportOffline, keep=true
- **ours**, line 371: facade and opening remount share source retain:false, keep=true
- **ours**, line 372: facade and opening remount share source reset, keep=true
- **ours**, line 373: facade and opening remount share source denied, keep=true
- **ours**, line 374: facade inherits A's episode timestamp from the invalidation, through B and C authority
- **ours**, line 375: an early episode timer rearms to the original deadline without accessor help
- **ours**, line 376: facade withdrawal notifies once, including an opening remount, keep=undefined
- **ours**, line 380: an episode due inside a grouped commit waits until the settled peer is revalidating
- **ours**, line 465: online raw: offline withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- **ours**, line 467: online raw: offline withdraws both peers before every callback, keep=true, peerKeep=true
- **ours**, line 468: online raw: offline withdraws both peers before every callback, keep=false, peerKeep=undefined
- **ours**, line 469: online raw: offline withdraws both peers before every callback, keep=undefined, peerKeep=false
- **ours**, line 470: online raw: offline withdraws both peers before every callback, keep=false, peerKeep=true
- **ours**, line 471: online raw: offline withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 472: online guard: offline withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- **ours**, line 474: online guard: offline withdraws both peers before every callback, keep=true, peerKeep=true
- **ours**, line 475: online guard: offline withdraws both peers before every callback, keep=false, peerKeep=undefined
- **ours**, line 476: online guard: offline withdraws both peers before every callback, keep=undefined, peerKeep=false
- **ours**, line 477: online guard: offline withdraws both peers before every callback, keep=false, peerKeep=true
- **ours**, line 478: online guard: offline withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 479: online opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=undefined
- **ours**, line 480: online opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 481: online opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=true
- **ours**, line 516: wasm raw: offline withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- **ours**, line 518: wasm raw: offline withdraws both peers before every callback, keep=true, peerKeep=true
- **ours**, line 519: wasm raw: offline withdraws both peers before every callback, keep=false, peerKeep=undefined
- **ours**, line 520: wasm raw: offline withdraws both peers before every callback, keep=undefined, peerKeep=false
- **ours**, line 521: wasm raw: offline withdraws both peers before every callback, keep=false, peerKeep=true
- **ours**, line 522: wasm raw: offline withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 523: wasm guard: offline withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- **ours**, line 525: wasm guard: offline withdraws both peers before every callback, keep=true, peerKeep=true
- **ours**, line 526: wasm guard: offline withdraws both peers before every callback, keep=false, peerKeep=undefined
- **ours**, line 527: wasm guard: offline withdraws both peers before every callback, keep=undefined, peerKeep=false
- **ours**, line 528: wasm guard: offline withdraws both peers before every callback, keep=false, peerKeep=true
- **ours**, line 529: wasm guard: offline withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 530: wasm opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=undefined
- **ours**, line 531: wasm opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 532: wasm opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=true
- **ours**, line 567: schema discovery withdraws an overlapping invalidation: keep=undefined
- **ours**, line 568: schema discovery withdraws an overlapping invalidation: keep=true
- **ours**, line 569: online link loss withdraws a live settled answer immediately, keep=undefined
- **ours**, line 570: online link loss withdraws a live invalidated answer immediately, keep=undefined
- **ours**, line 573: online link loss withdraws a live settled answer immediately, keep=true
- **ours**, line 574: online link loss withdraws a live invalidated answer immediately, keep=true
- **ours**, line 575: usePage checks first page deadline before cached return without timer delivery
- **ours**, line 576: usePage checks second page deadline before cached return without timer delivery

## [affected-second.log.gz](./affected-second.log.gz) — 9 distinct markers

- **ours**, line 131: createApp keep=undefined: useQuery and usePage preserve inputs through 20 replacements, loaded cursors and removal
- **ours**, line 132: createApp keep=true: useQuery and usePage preserve inputs through 20 replacements, loaded cursors and removal
- **ours**, line 229: wasm: keep=undefined across leave withdraws changed inputs and replaces the old answer
- **ours**, line 235: process: keep=undefined across leave withdraws changed inputs and replaces the old answer
- **ours**, line 241: wasm: keep=true across leave withdraws changed inputs and replaces the old answer
- **ours**, line 247: process: keep=true across leave withdraws changed inputs and replaces the old answer
- **ours**, line 330: createApp keeps a superseded answer while replacement authority is held
- **ours**, line 420: facade inherits A's episode timestamp from the invalidation, through B and C authority
- **ours**, line 426: an episode due inside a grouped commit waits until the settled peer is revalidating

## [affected-third.log.gz](./affected-third.log.gz) — 1 distinct markers

- **ours**, line 77: createApp withdraws a superseded answer while replacement authority is held

## [assets.log.gz](./assets.log.gz) — 9 distinct markers

- **ours**, line 20: a delayed transient conversion cannot publish an obsolete session's asset
- **ours**, line 51: native: a download delayed across store replacement cannot retain legacy bytes, even after reopen
- **ours**, line 52: native: a download delayed across store replacement preserves the newer download, even after reopen
- **ours**, line 53: native: a once download delayed across store replacement preserves the newer download, even after reopen
- **ours**, line 54: wasm: a download delayed across store replacement cannot retain legacy bytes, even after reopen
- **ours**, line 55: wasm: a download delayed across store replacement preserves the newer download, even after reopen
- **ours**, line 56: wasm: a once download delayed across store replacement preserves the newer download, even after reopen
- **ours**, line 59: wasm: list cache retires on expiry and stays retired after offline reopen
- **ours**, line 75: live online asset handle withdraws on membership

## [browser-expiry-followup.log.gz](./browser-expiry-followup.log.gz) — 2 distinct markers

- **ours**, line 2: expiry retry server pagination watch wasm
- **ours**, line 4: expiry retry server pagination watch process

## [browser-fifth.log.gz](./browser-fifth.log.gz) — 1 distinct markers

- **ours**, line 1: browser: EnsureProfile preserves /conversation/bob through a held plain revalidation

## [browser-fourth.log.gz](./browser-fourth.log.gz) — 1 distinct markers

- **ours**, line 82: browser: EnsureProfile preserves /conversation/bob through a held plain revalidation

## [browser-third.log.gz](./browser-third.log.gz) — 1 distinct markers

- **ours**, line 61: browser: EnsureProfile preserves /conversation/bob through a held plain revalidation

## [deadline-followup.log.gz](./deadline-followup.log.gz) — 2 distinct markers

- **ours**, line 5: expiry retry server pagination watch wasm
- **ours**, line 7: expiry retry server pagination watch process

## [evidence-followup.log.gz](./evidence-followup.log.gz) — 8 distinct markers

- **ours**, line 4: expiry retry server pagination watch wasm
- **ours**, line 11: expiry retry server pagination watch process
- **ours**, line 46: wasm: an accepted loading is published, and recovery never brings back the answer it replaced
- **ours**, line 49: wasm: an accepted background reply does not replace a newer answer another read remembered
- **ours**, line 57: wasm: an accepted background reply does not undo a newer read's deletion of an absent answer
- **ours**, line 59: process: an accepted loading is published, and recovery never brings back the answer it replaced
- **ours**, line 62: process: an accepted background reply does not replace a newer answer another read remembered
- **ours**, line 70: process: an accepted background reply does not undo a newer read's deletion of an absent answer

## [expiry-qualified.log.gz](./expiry-qualified.log.gz) — 2 distinct markers

- **ours**, line 4: expiry retry server pagination watch wasm
- **ours**, line 11: expiry retry server pagination watch process

## [final-affected.log.gz](./final-affected.log.gz) — 1 distinct markers

- **ours**, line 266: W8R1a online opted-out server-run observations retain nothing during a replacing fetch

## [final-boundaries.log.gz](./final-boundaries.log.gz) — 149 distinct markers

- **ours**, line 1: wasm: apply revocation, keep=undefined, held
- **ours**, line 2: wasm: admit revocation, keep=undefined, held
- **ours**, line 3: wasm: transfer revocation, keep=undefined, held
- **ours**, line 4: wasm: remount revocation, keep=undefined, held
- **ours**, line 5: wasm: apply revocation, keep=undefined, throw
- **ours**, line 6: wasm: admit revocation, keep=undefined, throw
- **ours**, line 7: wasm: transfer revocation, keep=undefined, throw
- **ours**, line 8: wasm: apply revocation, keep=undefined, unavailable
- **ours**, line 9: wasm: admit revocation, keep=undefined, unavailable
- **ours**, line 10: wasm: transfer revocation, keep=undefined, unavailable
- **ours**, line 11: wasm: apply revocation, keep=undefined, retryExhausted
- **ours**, line 12: wasm: admit revocation, keep=undefined, retryExhausted
- **ours**, line 13: wasm: transfer revocation, keep=undefined, retryExhausted
- **ours**, line 14: wasm: apply revocation, keep=false, held
- **ours**, line 15: wasm: admit revocation, keep=false, held
- **ours**, line 16: wasm: transfer revocation, keep=false, held
- **ours**, line 17: wasm: remount revocation, keep=false, held
- **ours**, line 18: wasm: apply revocation, keep=true, held
- **ours**, line 19: wasm: admit revocation, keep=true, held
- **ours**, line 20: wasm: transfer revocation, keep=true, held
- **ours**, line 21: wasm: remount revocation, keep=true, held
- **ours**, line 22: wasm: apply revocation, keep=true, throw
- **ours**, line 23: wasm: admit revocation, keep=true, throw
- **ours**, line 24: wasm: transfer revocation, keep=true, throw
- **ours**, line 25: wasm: apply revocation, keep=true, unavailable
- **ours**, line 26: wasm: admit revocation, keep=true, unavailable
- **ours**, line 27: wasm: transfer revocation, keep=true, unavailable
- **ours**, line 28: wasm: apply revocation, keep=true, retryExhausted
- **ours**, line 29: wasm: admit revocation, keep=true, retryExhausted
- **ours**, line 30: wasm: transfer revocation, keep=true, retryExhausted
- **ours**, line 31: process: apply revocation, keep=undefined, held
- **ours**, line 32: process: admit revocation, keep=undefined, held
- **ours**, line 33: process: transfer revocation, keep=undefined, held
- **ours**, line 34: process: remount revocation, keep=undefined, held
- **ours**, line 35: process: apply revocation, keep=undefined, throw
- **ours**, line 36: process: admit revocation, keep=undefined, throw
- **ours**, line 37: process: transfer revocation, keep=undefined, throw
- **ours**, line 38: process: apply revocation, keep=undefined, unavailable
- **ours**, line 39: process: admit revocation, keep=undefined, unavailable
- **ours**, line 40: process: transfer revocation, keep=undefined, unavailable
- **ours**, line 41: process: apply revocation, keep=undefined, retryExhausted
- **ours**, line 42: process: admit revocation, keep=undefined, retryExhausted
- **ours**, line 43: process: transfer revocation, keep=undefined, retryExhausted
- **ours**, line 44: process: apply revocation, keep=false, held
- **ours**, line 45: process: admit revocation, keep=false, held
- **ours**, line 46: process: transfer revocation, keep=false, held
- **ours**, line 47: process: remount revocation, keep=false, held
- **ours**, line 48: process: apply revocation, keep=true, held
- **ours**, line 49: process: admit revocation, keep=true, held
- **ours**, line 50: process: transfer revocation, keep=true, held
- **ours**, line 51: process: remount revocation, keep=true, held
- **ours**, line 52: process: apply revocation, keep=true, throw
- **ours**, line 53: process: admit revocation, keep=true, throw
- **ours**, line 54: process: transfer revocation, keep=true, throw
- **ours**, line 55: process: apply revocation, keep=true, unavailable
- **ours**, line 56: process: admit revocation, keep=true, unavailable
- **ours**, line 57: process: transfer revocation, keep=true, unavailable
- **ours**, line 58: process: apply revocation, keep=true, retryExhausted
- **ours**, line 59: process: admit revocation, keep=true, retryExhausted
- **ours**, line 60: process: transfer revocation, keep=true, retryExhausted
- **ours**, line 61: online: revoked data, keep=undefined, held
- **ours**, line 83: browser: EnsureProfile preserves /conversation/bob through a held plain revalidation
- **ours**, line 196: wasm guard: closed facade honors row expiry, live peer=false, keep=undefined
- **ours**, line 197: wasm guard: closed facade honors row expiry, live peer=false, keep=false
- **ours**, line 198: wasm guard: closed facade honors row expiry, live peer=false, keep=true
- **ours**, line 199: wasm guard: closed facade honors row expiry, live peer=true, keep=undefined
- **ours**, line 200: wasm guard: closed facade honors row expiry, live peer=true, keep=false
- **ours**, line 201: wasm guard: closed facade honors row expiry, live peer=true, keep=true
- **ours**, line 202: wasm createApp: closed facade honors row expiry, live peer=false, keep=undefined
- **ours**, line 203: wasm createApp: closed facade honors row expiry, live peer=false, keep=false
- **ours**, line 204: wasm createApp: closed facade honors row expiry, live peer=false, keep=true
- **ours**, line 205: wasm createApp: closed facade honors row expiry, live peer=true, keep=undefined
- **ours**, line 206: wasm createApp: closed facade honors row expiry, live peer=true, keep=false
- **ours**, line 207: wasm createApp: closed facade honors row expiry, live peer=true, keep=true
- **ours**, line 220: wasm guard: closed facade withdraws when peer republishes private B, keep=false
- **ours**, line 221: wasm guard: closed facade withdraws when peer republishes private A, keep=false
- **ours**, line 222: wasm guard: closed facade withdraws when peer republishes private B, keep=undefined
- **ours**, line 223: wasm guard: closed facade withdraws when peer republishes private A, keep=undefined
- **ours**, line 224: wasm guard: closed facade withdraws when peer republishes private B, keep=true
- **ours**, line 225: wasm guard: closed facade withdraws when peer republishes private A, keep=true
- **ours**, line 226: wasm createApp: closed facade withdraws when peer republishes private B, keep=false
- **ours**, line 227: wasm createApp: closed facade withdraws when peer republishes private A, keep=false
- **ours**, line 228: wasm createApp: closed facade withdraws when peer republishes private B, keep=undefined
- **ours**, line 229: wasm createApp: closed facade withdraws when peer republishes private A, keep=undefined
- **ours**, line 230: wasm createApp: closed facade withdraws when peer republishes private B, keep=true
- **ours**, line 231: wasm createApp: closed facade withdraws when peer republishes private A, keep=true
- **ours**, line 233: wasm: closing a standalone withdrawing facade releases its raw owner and callbacks
- **ours**, line 240: wasm: client close keeps one denial past its row deadline, keep=undefined
- **ours**, line 241: wasm detached handle: client close keeps one denial past its row deadline, keep=undefined
- **ours**, line 242: wasm: client close keeps one denial past its row deadline, keep=false
- **ours**, line 243: wasm detached handle: client close keeps one denial past its row deadline, keep=false
- **ours**, line 244: wasm: client close keeps one denial past its row deadline, keep=true
- **ours**, line 245: wasm detached handle: client close keeps one denial past its row deadline, keep=true
- **ours**, line 246: wasm: resubscription delivers saved row expiry without an accessor, keep=undefined
- **ours**, line 247: wasm: resubscription delivers saved row expiry without an accessor, keep=false
- **ours**, line 248: wasm: closed handle expiry fences memory across rollback
- **ours**, line 249: wasm: live handle expiry fences memory across rollback
- **ours**, line 250: wasm: closed A expiry preserves newer unexpired B in memory across rollback
- **ours**, line 319: wasm raw: offline withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- **ours**, line 320: wasm raw: offline withdraws both peers before every callback, keep=false, peerKeep=false
- **ours**, line 321: wasm raw: offline withdraws both peers before every callback, keep=true, peerKeep=true
- **ours**, line 322: wasm raw: offline withdraws both peers before every callback, keep=false, peerKeep=undefined
- **ours**, line 323: wasm raw: offline withdraws both peers before every callback, keep=undefined, peerKeep=false
- **ours**, line 324: wasm raw: offline withdraws both peers before every callback, keep=false, peerKeep=true
- **ours**, line 325: wasm raw: offline withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 326: wasm guard: offline withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- **ours**, line 327: wasm guard: offline withdraws both peers before every callback, keep=false, peerKeep=false
- **ours**, line 328: wasm guard: offline withdraws both peers before every callback, keep=true, peerKeep=true
- **ours**, line 329: wasm guard: offline withdraws both peers before every callback, keep=false, peerKeep=undefined
- **ours**, line 330: wasm guard: offline withdraws both peers before every callback, keep=undefined, peerKeep=false
- **ours**, line 331: wasm guard: offline withdraws both peers before every callback, keep=false, peerKeep=true
- **ours**, line 332: wasm guard: offline withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 333: wasm opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=undefined
- **ours**, line 334: wasm opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 335: wasm opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=true
- **ours**, line 336: wasm raw: close withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- **ours**, line 337: wasm raw: close withdraws both peers before every callback, keep=false, peerKeep=false
- **ours**, line 338: wasm raw: close withdraws both peers before every callback, keep=true, peerKeep=true
- **ours**, line 339: wasm raw: close withdraws both peers before every callback, keep=false, peerKeep=undefined
- **ours**, line 340: wasm raw: close withdraws both peers before every callback, keep=undefined, peerKeep=false
- **ours**, line 341: wasm raw: close withdraws both peers before every callback, keep=false, peerKeep=true
- **ours**, line 342: wasm raw: close withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 343: wasm guard: close withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- **ours**, line 344: wasm guard: close withdraws both peers before every callback, keep=false, peerKeep=false
- **ours**, line 345: wasm guard: close withdraws both peers before every callback, keep=true, peerKeep=true
- **ours**, line 346: wasm guard: close withdraws both peers before every callback, keep=false, peerKeep=undefined
- **ours**, line 347: wasm guard: close withdraws both peers before every callback, keep=undefined, peerKeep=false
- **ours**, line 348: wasm guard: close withdraws both peers before every callback, keep=false, peerKeep=true
- **ours**, line 349: wasm guard: close withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 350: wasm opening remount: close withdraws both peers before every callback, keep=true, peerKeep=undefined
- **ours**, line 351: wasm opening remount: close withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 352: wasm opening remount: close withdraws both peers before every callback, keep=true, peerKeep=true
- **ours**, line 353: wasm raw: sign-out withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- **ours**, line 354: wasm raw: sign-out withdraws both peers before every callback, keep=false, peerKeep=false
- **ours**, line 355: wasm raw: sign-out withdraws both peers before every callback, keep=true, peerKeep=true
- **ours**, line 356: wasm raw: sign-out withdraws both peers before every callback, keep=false, peerKeep=undefined
- **ours**, line 357: wasm raw: sign-out withdraws both peers before every callback, keep=undefined, peerKeep=false
- **ours**, line 358: wasm raw: sign-out withdraws both peers before every callback, keep=false, peerKeep=true
- **ours**, line 359: wasm raw: sign-out withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 360: wasm guard: sign-out withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- **ours**, line 361: wasm guard: sign-out withdraws both peers before every callback, keep=false, peerKeep=false
- **ours**, line 362: wasm guard: sign-out withdraws both peers before every callback, keep=true, peerKeep=true
- **ours**, line 363: wasm guard: sign-out withdraws both peers before every callback, keep=false, peerKeep=undefined
- **ours**, line 364: wasm guard: sign-out withdraws both peers before every callback, keep=undefined, peerKeep=false
- **ours**, line 365: wasm guard: sign-out withdraws both peers before every callback, keep=false, peerKeep=true
- **ours**, line 366: wasm guard: sign-out withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 367: wasm opening remount: sign-out withdraws both peers before every callback, keep=true, peerKeep=undefined
- **ours**, line 368: wasm opening remount: sign-out withdraws both peers before every callback, keep=true, peerKeep=false
- **ours**, line 369: wasm opening remount: sign-out withdraws both peers before every callback, keep=true, peerKeep=true

## [final-witnesses.log.gz](./final-witnesses.log.gz) — 1 distinct markers

- **ours**, line 51: an asset's readable rule witness expires offline at its original deadline

## [guide-final.log.gz](./guide-final.log.gz) — 1 distinct markers

- **ours**, line 33: test familiar::every_moved_fact_has_its_why_or_details_home ... FAILED

## [native-expo.log.gz](./native-expo.log.gz) — 1 distinct markers

- **environmental**, line 5: Error: WITNESS_UDID must name your dedicated booted iOS simulator

## [new-tests-second.log.gz](./new-tests-second.log.gz) — 1 distinct markers

- **ours**, line 61: browser: EnsureProfile preserves /conversation/bob through a held plain revalidation

## [new-tests.log.gz](./new-tests.log.gz) — 1 distinct markers

- **ours**, line 61: browser: EnsureProfile preserves /conversation/bob through a held plain revalidation

## [optout-diagnosis-2.log.gz](./optout-diagnosis-2.log.gz) — 1 distinct markers

- **ours**, line 1: W8R1a online opted-out server-run observations retain nothing during a replacing fetch

## [optout-diagnosis.log.gz](./optout-diagnosis.log.gz) — 1 distinct markers

- **ours**, line 1: W8R1a online opted-out server-run observations retain nothing during a replacing fetch

## [optout-followup.log.gz](./optout-followup.log.gz) — 1 distinct markers

- **ours**, line 1: W8R1a online opted-out server-run observations retain nothing during a replacing fetch

## [remaining-affected.log.gz](./remaining-affected.log.gz) — 4 distinct markers

- **ours**, line 39: expiry retry server pagination wasm
- **ours**, line 40: expiry retry server pagination watch wasm
- **ours**, line 46: expiry retry server pagination process
- **ours**, line 47: expiry retry server pagination watch process

## [rule-change-qualified.log.gz](./rule-change-qualified.log.gz) — 2 distinct markers

- **ours**, line 3: online: a rule change withdraws a displayed row and asset before its held replacement
- **ours**, line 4: wasm: a rule change withdraws a displayed row and asset before its held replacement

## [rule-change-retry.log.gz](./rule-change-retry.log.gz) — 2 distinct markers

- **ours**, line 3: online: a rule change withdraws a displayed row and asset before its held replacement
- **ours**, line 4: wasm: a rule change withdraws a displayed row and asset before its held replacement

## [test-sh.log.gz](./test-sh.log.gz) — 208 distinct markers

- **ours**, line 1972: closed facade follows same identity's revalidation (close before=false), keep=undefined
- **ours**, line 1973: closed facade follows same identity's revalidation (close before=true), keep=undefined
- **ours**, line 1976: release fences pending authority before raw callback delivery, keep=undefined
- **ours**, line 1977: release fences pending authority before raw callback delivery, keep=true
- **ours**, line 1978: closed captured episode enforces its deadline even when the source copy has none (close before=false)
- **ours**, line 1979: closed captured episode enforces its deadline even when the source copy has none (close before=true)
- **ours**, line 1980: oracle preserves captured episode after source omits it (close before=false)
- **ours**, line 1981: oracle preserves captured episode after source omits it (close before=true)
- **ours**, line 1982: oracle fences opening refusal after closed peer restores raw denial (throws=false), keep=undefined
- **ours**, line 1983: oracle fences opening refusal after closed peer restores raw denial (throws=true), keep=undefined
- **ours**, line 1986: oracle checks raw expiry from an opening getter before its sourced peer, keep=undefined
- **ours**, line 1987: oracle requires same-answer recovery for every live facade, keep=undefined
- **ours**, line 1988: oracle rejects an older success after a closed opening succeeds, keep=undefined
- **ours**, line 1991: oracle fences pending approval before completion, keep=undefined
- **ours**, line 1992: oracle separates retired and recreated raw owners, keep=undefined
- **ours**, line 1993: oracle validates every callback in batched completions, keep=undefined
- **ours**, line 1994: oracle ignores superseded refusal (newest first=false), keep=undefined
- **ours**, line 1995: oracle ignores superseded refusal (newest first=true), keep=undefined
- **ours**, line 1996: oracle preserves recovery across duplicate opening denial, keep=undefined
- **ours**, line 2001: oracle preserves closed loading across raw denial, keep=undefined
- **ours**, line 2003: seed 1
- **ours**, line 2004: seed 2
- **ours**, line 2005: seed 3
- **ours**, line 2006: seed 4
- **ours**, line 2007: seed 5
- **ours**, line 2008: seed 6
- **ours**, line 2009: seed 7
- **ours**, line 2010: seed 8
- **ours**, line 2011: seed 9
- **ours**, line 2012: seed 10
- **ours**, line 2013: seed 11
- **ours**, line 2014: seed 12
- **ours**, line 2015: seed 13
- **ours**, line 2016: seed 14
- **ours**, line 2017: seed 15
- **ours**, line 2018: seed 16
- **ours**, line 2019: seed 17
- **ours**, line 2020: seed 18
- **ours**, line 2021: seed 19
- **ours**, line 2022: seed 20
- **ours**, line 2023: seed 21
- **ours**, line 2024: seed 22
- **ours**, line 2025: seed 23
- **ours**, line 2026: seed 24
- **ours**, line 2027: seed 25
- **ours**, line 2028: seed 26
- **ours**, line 2029: seed 27
- **ours**, line 2030: seed 28
- **ours**, line 2031: seed 29
- **ours**, line 2032: seed 30
- **ours**, line 2033: seed 31
- **ours**, line 2034: seed 32
- **ours**, line 2035: seed 33
- **ours**, line 2036: seed 34
- **ours**, line 2037: seed 35
- **ours**, line 2038: seed 36
- **ours**, line 2039: seed 37
- **ours**, line 2040: seed 38
- **ours**, line 2041: seed 39
- **ours**, line 2042: seed 40
- **ours**, line 2043: seed 41
- **ours**, line 2044: seed 42
- **ours**, line 2045: seed 43
- **ours**, line 2046: seed 44
- **ours**, line 2047: seed 45
- **ours**, line 2048: seed 46
- **ours**, line 2049: seed 47
- **ours**, line 2050: seed 48
- **ours**, line 2051: seed 49
- **ours**, line 2052: seed 50
- **ours**, line 2053: seed 51
- **ours**, line 2054: seed 52
- **ours**, line 2055: seed 53
- **ours**, line 2056: seed 54
- **ours**, line 2057: seed 55
- **ours**, line 2058: seed 56
- **ours**, line 2059: seed 57
- **ours**, line 2060: seed 58
- **ours**, line 2061: seed 59
- **ours**, line 2062: seed 60
- **ours**, line 2063: seed 61
- **ours**, line 2064: seed 62
- **ours**, line 2065: seed 63
- **ours**, line 2066: seed 64
- **ours**, line 2067: seed 65
- **ours**, line 2068: seed 66
- **ours**, line 2069: seed 67
- **ours**, line 2070: seed 68
- **ours**, line 2071: seed 69
- **ours**, line 2072: seed 70
- **ours**, line 2073: seed 71
- **ours**, line 2074: seed 72
- **ours**, line 2075: seed 73
- **ours**, line 2076: seed 74
- **ours**, line 2077: seed 75
- **ours**, line 2078: seed 76
- **ours**, line 2079: seed 77
- **ours**, line 2080: seed 78
- **ours**, line 2081: seed 79
- **ours**, line 2082: seed 80
- **ours**, line 2083: seed 81
- **ours**, line 2084: seed 82
- **ours**, line 2085: seed 83
- **ours**, line 2086: seed 84
- **ours**, line 2087: seed 85
- **ours**, line 2088: seed 86
- **ours**, line 2089: seed 87
- **ours**, line 2090: seed 88
- **ours**, line 2091: seed 89
- **ours**, line 2092: seed 90
- **ours**, line 2093: seed 91
- **ours**, line 2094: seed 92
- **ours**, line 2095: seed 93
- **ours**, line 2096: seed 94
- **ours**, line 2097: seed 95
- **ours**, line 2098: seed 96
- **ours**, line 2099: seed 97
- **ours**, line 2100: seed 98
- **ours**, line 2101: seed 99
- **ours**, line 2102: seed 100
- **ours**, line 2103: seed 101
- **ours**, line 2104: seed 102
- **ours**, line 2105: seed 103
- **ours**, line 2106: seed 104
- **ours**, line 2107: seed 105
- **ours**, line 2108: seed 106
- **ours**, line 2109: seed 107
- **ours**, line 2110: seed 108
- **ours**, line 2111: seed 109
- **ours**, line 2112: seed 110
- **ours**, line 2113: seed 111
- **ours**, line 2114: seed 112
- **ours**, line 2115: seed 113
- **ours**, line 2116: seed 114
- **ours**, line 2117: seed 115
- **ours**, line 2118: seed 116
- **ours**, line 2119: seed 117
- **ours**, line 2120: seed 118
- **ours**, line 2121: seed 119
- **ours**, line 2122: seed 120
- **ours**, line 2123: seeded independent shared approval oracle, keep=undefined
- **ours**, line 2266: oracle fences opening refusal after closed peer restores raw denial (throws=false), keep=true
- **ours**, line 2267: oracle fences opening refusal after closed peer restores raw denial (throws=true), keep=true
- **ours**, line 2270: oracle checks raw expiry from an opening getter before its sourced peer, keep=true
- **ours**, line 2271: oracle requires same-answer recovery for every live facade, keep=true
- **ours**, line 2272: oracle rejects an older success after a closed opening succeeds, keep=true
- **ours**, line 2275: oracle fences pending approval before completion, keep=true
- **ours**, line 2276: oracle separates retired and recreated raw owners, keep=true
- **ours**, line 2277: oracle validates every callback in batched completions, keep=true
- **ours**, line 2278: oracle ignores superseded refusal (newest first=false), keep=true
- **ours**, line 2279: oracle ignores superseded refusal (newest first=true), keep=true
- **ours**, line 2280: oracle preserves recovery across duplicate opening denial, keep=true
- **ours**, line 2285: oracle preserves closed loading across raw denial, keep=true
- **ours**, line 2407: seeded independent shared approval oracle, keep=true
- **ours**, line 2539: online: a rule change withdraws a displayed row and asset before its held replacement
- **ours**, line 2744: W8R1a online server-run observations retain nothing during a replacing fetch
- **ours**, line 2745: W8R1a native server-run observations retain nothing during a replacing fetch
- **ours**, line 2746: W8R1a web server-run observations retain nothing during a replacing fetch
- **ours**, line 2870: createApp online: superseded answer never reports; approved successor reports exactly once
- **ours**, line 2871: createApp online: episode expiry before approval never collects
- **ours**, line 2881: createApp online: background-only delivery waits for facade approval with changes held
- **ours**, line 2884: createApp local: superseded answer never reports; approved successor reports exactly once
- **ours**, line 2885: createApp local: episode expiry before approval never collects
- **ours**, line 2895: createApp local: background-only delivery waits for facade approval with changes held
- **ours**, line 2918: every delivery await is explicitly classified
- **ours**, line 3397: online: kept typing survives member commits and expires during a held re-read
- **ours**, line 3398: wasm: kept typing survives member commits and expires during a held re-read
- **ours**, line 3399: process: kept typing survives member commits and expires during a held re-read
- **ours**, line 3491: expiry retry server pagination wasm
- **ours**, line 3492: expiry retry server pagination watch wasm
- **ours**, line 3498: expiry retry server pagination process
- **ours**, line 3499: expiry retry server pagination watch process
- **ours**, line 3831: createApp keep=true: useQuery and usePage preserve owned inputs through 20 invalidations, loaded cursors and removal
- **ours**, line 4304: online assets revoke late credential-bound URLs across rotation, sign-out and close
- **ours**, line 4327: probe: replacement is terminal for all reads and writes
- **ours**, line 4328: probe: regression is terminal for all reads and writes
- **ours**, line 5085: ordinary search generated oracle process: 300 seeds
- **ours**, line 5947: ordinary search generated oracle wasm: 300 seeds
- **ours**, line 5979: mounted React ordinary search follows departure, offline and rejoin without switching queries
- **ours**, line 6289: wasm: an accepted loading is published, and recovery never brings back the answer it replaced
- **ours**, line 6292: wasm: an accepted background reply does not replace a newer answer another read remembered
- **ours**, line 6296: wasm: a refusal read at a later store cut outranks an answer remembered before it landed
- **ours**, line 6297: wasm: a read retried after its store changed takes a new place in the order
- **ours**, line 6300: wasm: an accepted background reply does not undo a newer read's deletion of an absent answer
- **ours**, line 6302: process: an accepted loading is published, and recovery never brings back the answer it replaced
- **ours**, line 6305: process: an accepted background reply does not replace a newer answer another read remembered
- **ours**, line 6309: process: a refusal read at a later store cut outranks an answer remembered before it landed
- **ours**, line 6310: process: a read retried after its store changed takes a new place in the order
- **ours**, line 6313: process: an accepted background reply does not undo a newer read's deletion of an absent answer
- **ours**, line 6321: an accepted loading answer is published, and a background failure keeps the answer and the link
- **ours**, line 6440: closing a raw local handle stops its episode timer but keeps the deadline
- **ours**, line 6441: resubscribing a raw local handle rearms its original episode deadline
- **ours**, line 6474: keep hooks preserve loaded pages and an editor during re-reads, then accept refusal and reset
- **ours**, line 6486: useQuery createApp remount first commits the lingering answer during a held re-read
- **ours**, line 6487: usePage createApp remount first commits the lingering answer during a held re-read
- **ours**, line 6585: React hooks and reference-app lifetimes
- **ours**, line 6587: one replacing fetch ends retention: loading
- **ours**, line 6589: one replacing fetch ends retention: failure
- **ours**, line 7373: typing expires, drops on disconnect, needs a fresh keystroke and never queues
- **ours**, line 7374: one handle survives list remount, closes, rejects second open and cleans a late result
- **ours**, line 7375: the viewer's own read keeps the handle through loading and revokes on withdrawal, including in flight
- **ours**, line 7377: observations make retention explicit
- **ours**, line 7379: social recipes in React/browser: real online signals and media, controlled read interleavings
- **ours**, line 7384: social starter runs through the public client: feed, likes, receipts, typing, media and retained history
- **ours**, line 7568: an unpublished 503 refresh keeps acquisition polling alive
- **ours**, line 7569: an unpublished prediction refresh keeps acquisition polling alive
- **ours**, line 7570: an unpublished expiry refresh keeps acquisition polling alive
- **ours**, line 15288: -- FAIL: client tests (747 s)


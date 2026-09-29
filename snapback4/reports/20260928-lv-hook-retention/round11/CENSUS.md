# Historical SDK regression census

The same **1,007 original tests in 42 files** ran with the pre-LV SDK,
round-10 SDK and round-11 SDK, using the same current server/device build.
No original test assertion or helper was changed for these runs.

| SDK | Passed | Failed | Cancelled / skipped |
|---|---:|---:|---:|
| Pre-LV (`ee514de11^1`) | 1,007 | 0 | 0 / 0 |
| Round 10 (`c3ab7b37e`) | 788 | 219 | 0 / 0 |
| Round 11 | 788 | 219 | 0 / 0 |

The **219 failing names are identical** in rounds 10 and 11. All are ours
from prior LV behavior/fixture changes, listed individually below. They are
not baseline/environmental exemptions and this comparison is not called green.
They exercise deliberate retention, replacement-order, dependency-invalidation
or removed host-deadline behavior. The current expectations are governed by
LLP 3000.029 §§2–10 and 12, not newly relaxed for this round. None is a newly
failing round-11 plain local read.

Plain reads still use pre-LV behavior as the oracle. The nine new real-host
regressions pass unchanged on pre-LV and round 11, and fail on round 10.
The new 30-seed property additionally requires pure local evaluations to keep
answer order and never create loading after an accepted answer. The current
whole retention/fencing/footprint/ephemeral/property affected run passes 1,453
tests; LV-only internal modules cannot run on a pre-LV SDK that lacks them.
The unchanged retained-row provenance assertions pass in the current full
suite with their established helper that parks both sync and change evidence;
the original helper used here parks only sync, so those tests receive actual
remote invalidation and are not pure local histories.

## Reproduction and harness failures

`census.py`, `census-files.json`, `census-results.json` and
`census-round10-result.json` record the selection and commands. Controls live
under ignored `target/lv-round11/census-*/snapback4`. The round-10 package uses
the saved original dist and archived source, copied inside the package boundary.
An initial round-10 setup used an external dist symlink and failed package
`#fetch` resolution for 34 files; ten additional old-policy assertions failed in the
files that could load (90 total tests, 46 passed / 44 failed). See
`census-round10-setup.log.gz`. This is our harness failure, not SDK evidence.

After every other census child had exited, the original presence-refresh
test retained an interval because its failing assertion bypassed close.
Only that exact remaining child was terminated for each LV control; the
root runners reported all 1,007 results above with no cancellation. Cleanup
PID/cwd evidence is recorded in the two cleanup JSON files. Each original
presence-refresh file was separately rerun with `node --test --test-force-exit`,
yielding 9 passed / 1 failed on each SDK, the identical loading assertion.
No product assertion was altered to end the process.

## Every historical failure

Every item below passes on pre-LV and fails on both round 10 and round 11.
Locations refer to the original test file in the archived census copy; full
assertion diffs and stacks are preserved in both census logs.

### ephemeral-capability.test.mjs — 1

**Ours.** Same-key direct answers now reconcile the mounted peer before schema installation; the old collector included that permitted pre-installation publication. Current test clears the collector at installation.

- `224:1` — initial backend installation rejects a query already in flight

### ephemeral-keep.test.mjs — 3

**Ours.** Membership commits provide dependency evidence and withdraw affected typing views; the old assertion required retention across that evidence.

- `45:51` — online: kept typing survives member commits and expires during a held re-read
- `45:51` — wasm: kept typing survives member commits and expires during a held re-read
- `45:51` — process: kept typing survives member commits and expires during a held re-read

### expiry-retry-watch.test.mjs — 4

**Ours.** An expiry/evidence retry may repeat the same invocation. Old assertions demand exactly two total HTTP requests. Current tests require bounded retries, the original cursor per invocation, and exact returned rows, including delayed changes.

- `75:3` — expiry retry server pagination wasm
- `75:3` — expiry retry server pagination watch wasm
- `75:3` — expiry retry server pagination process
- `75:3` — expiry retry server pagination watch process

### keep-app-expiry.test.mjs — 2

**Ours.** A newer direct answer now replaces displayed peers as well as memory. The old assertion requires displayed A to survive accepted B; current test uses a newer same-image grant to isolate expiry.

- `10:39` — createApp wasm keep=undefined: held expiry fences late HTTP memory before rollback, preserving newer B
- `10:39` — createApp wasm keep=true: held expiry fences late HTTP memory before rollback, preserving newer B

### keep-app-model.test.mjs — 18

**Ours.** The old oracle marks dependency-changing local mutations as plain retention. They are invalidations under LLP 3000.029; the current oracle explicitly requires withdrawal.

- `33:3` — createApp keep=undefined property: online, seed 23, 50ms authority
- `33:3` — createApp keep=undefined property: online, seed 44, 50ms authority
- `33:3` — createApp keep=undefined property: online, seed 445, 50ms authority
- `33:3` — createApp keep=undefined property: wasm, seed 23, 50ms authority
- `33:3` — createApp keep=undefined property: wasm, seed 44, 50ms authority
- `33:3` — createApp keep=undefined property: wasm, seed 445, 50ms authority
- `33:3` — createApp keep=undefined property: process, seed 23, 50ms authority
- `33:3` — createApp keep=undefined property: process, seed 44, 50ms authority
- `33:3` — createApp keep=undefined property: process, seed 445, 50ms authority
- `33:3` — createApp keep=true property: online, seed 23, 50ms authority
- `33:3` — createApp keep=true property: online, seed 44, 50ms authority
- `33:3` — createApp keep=true property: online, seed 445, 50ms authority
- `33:3` — createApp keep=true property: wasm, seed 23, 50ms authority
- `33:3` — createApp keep=true property: wasm, seed 44, 50ms authority
- `33:3` — createApp keep=true property: wasm, seed 445, 50ms authority
- `33:3` — createApp keep=true property: process, seed 23, 50ms authority
- `33:3` — createApp keep=true property: process, seed 44, 50ms authority
- `33:3` — createApp keep=true property: process, seed 445, 50ms authority

### keep-authority-react.test.mjs — 2

**Ours.** The old React helper expects loaded pages and inputs to survive a mutation with unknown footprint. That mutation now invalidates its query dependencies.

- `11:39` — createApp keep=undefined: useQuery and usePage preserve inputs through 20 replacements, loaded cursors and removal
- `11:39` — createApp keep=true: useQuery and usePage preserve inputs through 20 replacements, loaded cursors and removal

### keep-authority.test.mjs — 24

**Ours.** The old fixture publishes a different raw image B while requiring the facade to display approval for A. Accepted replacements invalidate that approval; current same-image fixtures isolate deadline/authority behavior.

- `131:3` — opening remount getter and notifications follow shared replacements, keep=undefined
- `191:3` — a live waiting facade holds A until its peer approves shared B, keep=undefined
- `131:3` — opening remount getter and notifications follow shared replacements, keep=true
- `191:3` — a live waiting facade holds A until its peer approves shared B, keep=true
- `242:3` — opening remount receives the revalidating mark during replacement, keep=undefined
- `242:3` — opening remount receives the revalidating mark during replacement, keep=true
- `268:3` — facade holds A until its device deadline (timer), including a lingering remount
- `268:3` — facade holds A until its device deadline (correction), including a lingering remount
- `268:3` — facade holds A until its server deadline (timer), including a lingering remount
- `268:3` — facade holds A until its server deadline (correction), including a lingering remount
- `298:1` — held server data ignores a device reobservation wakeup, even when device time is ahead
- `325:1` — all facade deadlines withdraw before a subscriber rolls the clock back
- `342:74` — held approval ends on scope
- `342:74` — held approval ends on denied
- `342:74` — held approval ends on authority
- `342:74` — held approval ends on fence
- `342:74` — held approval ends on linger
- `377:3` — held device deadline is latched by peek before timer delivery
- `377:3` — held server deadline is latched by snapshot before timer delivery
- `377:3` — held server deadline is latched by peek before timer delivery
- `397:57` — opening remount is notified on reset
- `397:57` — opening remount is notified on denied
- `397:57` — opening remount is notified on retire
- `413:47` — independent authority completions preserve the newest check: B-first

### keep-clock.test.mjs — 8

**Ours.** The old fixture expects a newer direct answer to update memory without displayed peers. Peers now adopt the newer answer and its deadline; the former deadline cannot expire it.

- `132:3` — wasm keep=undefined: displayed expiry fences an older body while preserving newer memory (active)
- `132:3` — process keep=undefined: displayed expiry fences an older body while preserving newer memory (active)
- `132:3` — wasm keep=true: displayed expiry fences an older body while preserving newer memory (active)
- `132:3` — wasm keep=true: displayed expiry fences an older body while preserving newer memory (lingering)
- `132:3` — process keep=true: displayed expiry fences an older body while preserving newer memory (active)
- `132:3` — process keep=true: displayed expiry fences an older body while preserving newer memory (lingering)
- `327:41` — wasm keep: an older displayed deadline preserves a newer unexpired remembered answer
- `327:41` — process keep: an older displayed deadline preserves a newer unexpired remembered answer

### keep-device.test.mjs — 28

**Ours.** Apply/admit/settle/revoke/leave/refusal events change dependencies; the old keep assertions retain through that evidence. The closed raw-observation case instead expects the removed one-second host deadline.

- `72:3` — wasm: keep=undefined across apply publishes no loading and replaces the old answer
- `72:3` — wasm: keep=undefined across admit publishes no loading and replaces the old answer
- `72:3` — wasm: keep=undefined across settle publishes no loading and replaces the old answer
- `72:3` — wasm: keep=undefined across revoke publishes no loading and replaces the old answer
- `72:3` — wasm: keep=undefined across leave publishes no loading and replaces the old answer
- `72:3` — wasm: keep=undefined across refusal publishes no loading and replaces the old answer
- `72:3` — process: keep=undefined across apply publishes no loading and replaces the old answer
- `72:3` — process: keep=undefined across admit publishes no loading and replaces the old answer
- `72:3` — process: keep=undefined across settle publishes no loading and replaces the old answer
- `72:3` — process: keep=undefined across revoke publishes no loading and replaces the old answer
- `72:3` — process: keep=undefined across leave publishes no loading and replaces the old answer
- `72:3` — process: keep=undefined across refusal publishes no loading and replaces the old answer
- `72:3` — wasm: keep=true across apply publishes no loading and replaces the old answer
- `72:3` — wasm: keep=true across admit publishes no loading and replaces the old answer
- `72:3` — wasm: keep=true across settle publishes no loading and replaces the old answer
- `72:3` — wasm: keep=true across revoke publishes no loading and replaces the old answer
- `72:3` — wasm: keep=true across leave publishes no loading and replaces the old answer
- `72:3` — wasm: keep=true across refusal publishes no loading and replaces the old answer
- `72:3` — process: keep=true across apply publishes no loading and replaces the old answer
- `72:3` — process: keep=true across admit publishes no loading and replaces the old answer
- `72:3` — process: keep=true across settle publishes no loading and replaces the old answer
- `72:3` — process: keep=true across revoke publishes no loading and replaces the old answer
- `72:3` — process: keep=true across leave publishes no loading and replaces the old answer
- `72:3` — process: keep=true across refusal publishes no loading and replaces the old answer
- `193:79` — wasm: keep=undefined never publishes an evaluation captured before a newer commit
- `193:79` — process: keep=undefined never publishes an evaluation captured before a newer commit
- `193:79` — wasm: keep=true never publishes an evaluation captured before a newer commit
- `193:79` — process: keep=true never publishes an evaluation captured before a newer commit

### keep-expiry.test.mjs — 12

**Ours.** The old fixture expects data after an earlier dependency invalidation while waiting for row expiry; LV withdraws at that earlier evidence boundary.

- `36:3` — wasm: a closed raw local observation still latches its episode deadline
- `36:3` — process: a closed raw local observation still latches its episode deadline
- `122:5` — wasm keep=undefined: expiry withdraws across apply with the replacement held
- `122:5` — wasm keep=undefined: expiry withdraws across admit with the replacement held
- `122:5` — wasm keep=true: expiry withdraws across apply with the replacement held
- `122:5` — wasm keep=true: expiry withdraws across admit with the replacement held
- `122:5` — process keep=undefined: expiry withdraws across apply with the replacement held
- `122:5` — process keep=undefined: expiry withdraws across admit with the replacement held
- `122:5` — process keep=true: expiry withdraws across apply with the replacement held
- `122:5` — process keep=true: expiry withdraws across admit with the replacement held
- `122:5` — online keep=undefined: expiry withdraws across notification with the replacement held
- `122:5` — online keep=true: expiry withdraws across notification with the replacement held

### keep-observation.test.mjs — 12

**Ours.** Dependency commits with unknown footprints invalidate; accepted different facade images replace old approvals. Unavailable loading alone now retains a valid answer. The old assertions require the opposite policy in these cases.

- `121:3` — local keep: apply fences in-flight answers and keeps active and lingering data
- `121:3` — local keep: admit fences in-flight answers and keeps active and lingering data
- `121:3` — local keep: settle fences in-flight answers and keeps active and lingering data
- `149:1` — keep carries original freshness through reload, and every published result replaces it
- `265:95` — online keep: mutation waits without loading, then publishes next
- `265:95` — online keep: mutation waits without loading, then publishes denied
- `265:95` — online keep: notification waits without loading, then publishes next
- `265:95` — online keep: notification waits without loading, then publishes denied
- `309:1` — online keep: an in-flight answer read before a newer commit never replaces the kept answer
- `324:1` — the app client forwards keep while its lifetime fence still withdraws data
- `370:46` — createApp keeps a superseded answer while replacement authority is held
- `370:46` — createApp keeps a superseded answer while replacement authority is held

### page-ready.test.mjs — 1

**Ours.** A received mutation receipt fences the unapplied replica. The old fixture expects an empty partial scan from behind that cut; current test requires loading until apply.

- `31:1` — ready list reads survive account restoration, new chat acquisition and pending unread counts

### presence-local.test.mjs — 8

**Ours.** Unavailable loading now retains; newer same-key direct results reconcile mounted peers and fence older background/one-shot completions. The old assertions independently publish the older result or require loading to discard retained data.

- `90:6` — wasm: an accepted loading is published, and recovery never brings back the answer it replaced
- `134:3` — wasm: an accepted background reply does not replace a newer answer another read remembered
- `200:3` — wasm: an older read's refusal that lands after an accepted background reply does not erase it
- `319:3` — wasm: an accepted background reply does not undo a newer read's deletion of an absent answer
- `90:6` — process: an accepted loading is published, and recovery never brings back the answer it replaced
- `134:3` — process: an accepted background reply does not replace a newer answer another read remembered
- `200:3` — process: an older read's refusal that lands after an accepted background reply does not erase it
- `319:3` — process: an accepted background reply does not undo a newer read's deletion of an absent answer

### presence-refresh.test.mjs — 1

**Ours.** The old assertion requires unavailable loading to replace valid data; LV retains marked revalidating. Its missing early cleanup leaks an interval when the assertion fails.

- `156:1` — an accepted loading answer is published, and a background failure keeps the answer and the link

### raw-read-deadlines.test.mjs — 2

**Ours.** The old raw-handle tests expect the removed one-second host episode deadline, rather than a real device/server answer deadline.

- `35:1` — closing a raw local handle stops its episode timer but keeps the deadline
- `48:1` — resubscribing a raw local handle rearms its original episode deadline

### read-observation.test.mjs — 2

**Ours.** The old fixture requires loading or a failed replacement to discard valid data. LV retains unavailable/failed plain revalidation.

- `7:67` — one replacing fetch ends retention: loading
- `7:67` — one replacing fetch ends retention: failure

### read-through-provenance.test.mjs — 16

**Ours.** The original shared helper pauses /sync but continues delivering /changes. Those remote dependency cuts fence composition with an unapplied replica. The current helper parks both for these plain provenance controls; separate fence tests deliver changes while holding sync.

- `114:38` — wasm: retained nested rows follow source parents on reordered pages
- `114:38` — wasm: retained nested rows follow source parents on shifted pages
- `136:3` — wasm: composed tables sharing an ID keep independent retained rows
- `147:3` — wasm: projections without id replace a retained copy using its source envelope
- `114:38` — process: retained nested rows follow source parents on reordered pages
- `114:38` — process: retained nested rows follow source parents on shifted pages
- `136:3` — process: composed tables sharing an ID keep independent retained rows
- `147:3` — process: projections without id replace a retained copy using its source envelope
- `164:3` — wasm: an identityless object merges its identified child rows
- `180:3` — wasm: an unidentified sibling preserves paired parents and drops an unpaired current row
- `164:3` — process: an identityless object merges its identified child rows
- `180:3` — process: an unidentified sibling preserves paired parents and drops an unpaired current row
- `200:3` — wasm: an anonymous nested page appends only retained history after a partial rejoin
- `219:3` — wasm: an in-place edit under an anonymous nested page replaces its retained copy
- `200:3` — process: an anonymous nested page appends only retained history after a partial rejoin
- `219:3` — process: an in-place edit under an anonymous nested page replaces its retained copy

### read-through.test.mjs — 2

**Ours.** The original shared helper still delivers /changes after pausing /sync, so accepted remote dependency cuts fence retained composition. Current plain-read controls park both; explicit remote-fence controls cover the other schedule.

- `70:39` — wasm: an unheld parent falls back without losing retained rows
- `70:39` — process: an unheld parent falls back without losing retained rows

### remembered-answers.test.mjs — 2

**Ours.** The old assertion returns an older composed refusal even when a newer answer is remembered. The shared publication order now withholds the older completion; memory remains the newer answer.

- `112:1` — a composed read's refusal removes no answer a later read remembered
- `129:1` — an earlier read's answer at a higher cut, landing while a composed read is out, is remembered

### retention-episode.test.mjs — 32

**Ours.** Old assertions require the removed one-second host deadline, treat unavailable/transport/loading as hard withdrawal, or keep an approved facade image after a different source image replaces it. Current tests retain plain revalidation and preserve real expiry/authority boundaries.

- `17:56` — replacement completes and clears revalidation: keep=undefined, "B"
- `17:56` — replacement completes and clears revalidation: keep=undefined, null
- `17:56` — replacement completes and clears revalidation: keep=undefined, []
- `17:56` — replacement completes and clears revalidation: keep=undefined, {"denied":{"code":"HIDDEN","family":"rule","message":"hidden"}}
- `36:5` — hard withdrawals replace retained data: keep=undefined, throw
- `36:5` — hard withdrawals replace retained data: keep=undefined, transportOffline
- `36:5` — hard withdrawals replace retained data: keep=undefined, retryExhausted
- `36:5` — hard withdrawals replace retained data: keep=undefined, loading
- `36:5` — hard withdrawals replace retained data: keep=true, throw
- `36:5` — hard withdrawals replace retained data: keep=true, transportOffline
- `36:5` — hard withdrawals replace retained data: keep=true, retryExhausted
- `36:5` — hard withdrawals replace retained data: keep=true, loading
- `51:53` — one stable episode withdrawal at the deadline via snapshot, late success still lands
- `51:53` — one stable episode withdrawal at the deadline via peek, late success still lands
- `51:53` — one stable episode withdrawal at the deadline via timer, late success still lands
- `80:39` — successful fallback and held composition keep the same episode: keep=undefined
- `135:3` — facade and opening remount share source expiry, keep=undefined
- `135:3` — facade and opening remount share source loading, keep=undefined
- `135:3` — facade and opening remount share source transportOffline, keep=undefined
- `135:3` — facade and opening remount share source retain:false, keep=undefined
- `135:3` — facade and opening remount share source reset, keep=undefined
- `135:3` — facade and opening remount share source denied, keep=undefined
- `135:3` — facade and opening remount share source expiry, keep=true
- `135:3` — facade and opening remount share source loading, keep=true
- `135:3` — facade and opening remount share source transportOffline, keep=true
- `135:3` — facade and opening remount share source retain:false, keep=true
- `135:3` — facade and opening remount share source reset, keep=true
- `135:3` — facade and opening remount share source denied, keep=true
- `162:1` — facade inherits A's episode timestamp from the invalidation, through B and C authority
- `184:1` — an early episode timer rearms to the original deadline without accessor help
- `198:46` — facade withdrawal notifies once, including an opening remount, keep=undefined
- `245:1` — an episode due inside a grouped commit waits until the settled peer is revalidating

### retention-lifecycle.test.mjs — 31

**Ours.** Offline transport alone now retains default/keep:true peers with revalidating and fresh:false. The one keep:false resubscription case now honors explicit opt-out immediately.

- `206:40` — wasm: resubscription delivers saved row expiry without an accessor, keep=false
- `256:5` — online raw: offline withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- `256:5` — online raw: offline withdraws both peers before every callback, keep=true, peerKeep=true
- `256:5` — online raw: offline withdraws both peers before every callback, keep=false, peerKeep=undefined
- `256:5` — online raw: offline withdraws both peers before every callback, keep=undefined, peerKeep=false
- `256:5` — online raw: offline withdraws both peers before every callback, keep=false, peerKeep=true
- `256:5` — online raw: offline withdraws both peers before every callback, keep=true, peerKeep=false
- `256:5` — online guard: offline withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- `256:5` — online guard: offline withdraws both peers before every callback, keep=true, peerKeep=true
- `256:5` — online guard: offline withdraws both peers before every callback, keep=false, peerKeep=undefined
- `256:5` — online guard: offline withdraws both peers before every callback, keep=undefined, peerKeep=false
- `256:5` — online guard: offline withdraws both peers before every callback, keep=false, peerKeep=true
- `256:5` — online guard: offline withdraws both peers before every callback, keep=true, peerKeep=false
- `256:5` — online opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=undefined
- `256:5` — online opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=false
- `256:5` — online opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=true
- `256:5` — wasm raw: offline withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- `256:5` — wasm raw: offline withdraws both peers before every callback, keep=true, peerKeep=true
- `256:5` — wasm raw: offline withdraws both peers before every callback, keep=false, peerKeep=undefined
- `256:5` — wasm raw: offline withdraws both peers before every callback, keep=undefined, peerKeep=false
- `256:5` — wasm raw: offline withdraws both peers before every callback, keep=false, peerKeep=true
- `256:5` — wasm raw: offline withdraws both peers before every callback, keep=true, peerKeep=false
- `256:5` — wasm guard: offline withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- `256:5` — wasm guard: offline withdraws both peers before every callback, keep=true, peerKeep=true
- `256:5` — wasm guard: offline withdraws both peers before every callback, keep=false, peerKeep=undefined
- `256:5` — wasm guard: offline withdraws both peers before every callback, keep=undefined, peerKeep=false
- `256:5` — wasm guard: offline withdraws both peers before every callback, keep=false, peerKeep=true
- `256:5` — wasm guard: offline withdraws both peers before every callback, keep=true, peerKeep=false
- `256:5` — wasm opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=undefined
- `256:5` — wasm opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=false
- `256:5` — wasm opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=true

### retention-online-boundaries.test.mjs — 6

**Ours.** Unknown/overlapping schema dependencies withdraw on evidence; plain link loss now retains with stale freshness. The old assertions require the inverse policies.

- `19:39` — schema discovery withdraws an overlapping invalidation: keep=undefined
- `19:39` — schema discovery withdraws an overlapping invalidation: keep=true
- `54:3` — online link loss withdraws a live settled answer immediately, keep=undefined
- `54:3` — online link loss withdraws a live invalidated answer immediately, keep=undefined
- `54:3` — online link loss withdraws a live settled answer immediately, keep=true
- `54:3` — online link loss withdraws a live invalidated answer immediately, keep=true

### retention-pages.test.mjs — 2

**Ours.** The old assertion expects a plain revalidation host deadline at one second. That deadline is removed; current tests retain until an explicit source withdrawal.

- `23:38` — usePage checks first page deadline before cached return without timer delivery
- `23:38` — usePage checks second page deadline before cached return without timer delivery

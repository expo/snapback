# Test failure ledger

Every failed run is retained. Each entry below is one failed test result in the first reporter pass; repeated names under different parents remain distinct. The duplicated diagnostic tail is not counted again. Links name the complete logs; JSON records preserve source sites and dispositions.

**Full suite: ours 50; baseline 0; environmental 0.** These are 47 leaf/file failures plus three failed parent results. The full run remains failed evidence. Every full-run failure has a passing affected rerun; no second full suite was run.

“Baseline” below means the preserved main SDK failed a new contract assertion. “Ours” includes intended API migrations, new-code guide work and harness assumptions exposed by the change. No environmental failure was identified.

## Full-suite failures

See [the complete log](full-suite.log), [all 50 results](full-suite-results.json), [47 leaf/file diagnostics](full-suite-failures.json), [search model failed seeds](full-suite-search-seeds.json), and [the worker intervention](full-suite-worker-intervention.log).

| # | Classification | Failed result | Passing affected evidence |
|---|---|---|---|
| 1 | ours (leaf/file) | online keep=undefined: profile route gate > retry exhaustion | [react-offline-final.log](react-offline-final.log) |
| 2 | ours (failed parent) | online keep=undefined: profile route gate | [react-offline-final.log](react-offline-final.log) |
| 3 | ours (leaf/file) | online keep=true: profile route gate > retry exhaustion | [react-offline-final.log](react-offline-final.log) |
| 4 | ours (failed parent) | online keep=true: profile route gate | [react-offline-final.log](react-offline-final.log) |
| 5 | ours (leaf/file) | wasm: population growth cannot mint new IDs during prediction replay | [full-followups-final.log](full-followups-final.log) |
| 6 | ours (leaf/file) | native: population growth cannot mint new IDs during prediction replay | [full-followups-final.log](full-followups-final.log) |
| 7 | ours (leaf/file) | every delivery await is explicitly classified | [full-followups-final.log](full-followups-final.log) |
| 8 | ours (leaf/file) | local fallback rejects its manifest when expiry changes before acceptance | [full-followups-final.log](full-followups-final.log) |
| 9 | ours (leaf/file) | expired server replies: recover, keep=undefined | [full-followups-final.log](full-followups-final.log) |
| 10 | ours (leaf/file) | packages/snapback4/test/follow-window.test.mjs | [follow-window-corrected.log](follow-window-corrected.log) |
| 11 | ours (leaf/file) | review replacement query server invalidates old search continuation process | [integration-final-1.log](integration-final-1.log) |
| 12 | ours (leaf/file) | review replacement query server invalidates old search continuation wasm | [integration-final-1.log](integration-final-1.log) |
| 13 | ours (leaf/file) | review changed generation invalidates old search continuation process | [integration-final-1.log](integration-final-1.log) |
| 14 | ours (leaf/file) | review changed generation invalidates old search continuation wasm | [integration-final-1.log](integration-final-1.log) |
| 15 | ours (leaf/file) | wasm keep=undefined: pre-expiry HTTP body cannot restore memory (active, exact deadline) | [integration-final-1.log](integration-final-1.log) |
| 16 | ours (leaf/file) | process keep=undefined: pre-expiry HTTP body cannot restore memory (active, exact deadline) | [integration-final-1.log](integration-final-1.log) |
| 17 | ours (leaf/file) | wasm keep=true: pre-expiry HTTP body cannot restore memory (active, exact deadline) | [integration-final-1.log](integration-final-1.log) |
| 18 | ours (leaf/file) | wasm keep=true: pre-expiry HTTP body cannot restore memory (lingering, exact deadline) | [integration-final-1.log](integration-final-1.log) |
| 19 | ours (leaf/file) | process keep=true: pre-expiry HTTP body cannot restore memory (active, exact deadline) | [integration-final-1.log](integration-final-1.log) |
| 20 | ours (leaf/file) | process keep=true: pre-expiry HTTP body cannot restore memory (lingering, exact deadline) | [integration-final-1.log](integration-final-1.log) |
| 21 | ours (leaf/file) | mixed evidence schedule process: 300 independent histories | [models-final-1.log](models-final-1.log) |
| 22 | ours (leaf/file) | mixed evidence schedule wasm: 300 independent histories | [models-final-1.log](models-final-1.log) |
| 23 | ours (leaf/file) | direct stale-sequence reads back off and stop after four requests | [integration-final-1.log](integration-final-1.log) |
| 24 | ours (leaf/file) | ordinary search generated oracle process: 300 seeds | [models-final-1.log](models-final-1.log) |
| 25 | ours (leaf/file) | ordinary search generated oracle wasm: 300 seeds | [models-final-1.log](models-final-1.log) |
| 26 | ours (leaf/file) | expired current replacement keeps retained history process | [models-final-1.log](models-final-1.log) |
| 27 | ours (leaf/file) | expired current replacement keeps retained history wasm | [models-final-1.log](models-final-1.log) |
| 28 | ours (leaf/file) | ordinary mixed search: departure during delivery withdraws response without a second invocation | [integration-final-1.log](integration-final-1.log), [search-publication-final.log](search-publication-final.log) |
| 29 | ours (leaf/file) | ordinary mixed search: retained edits stay at the delivered image; expiry crossing delivery withdraws it | [integration-final-1.log](integration-final-1.log), [search-publication-final.log](search-publication-final.log) |
| 30 | ours (leaf/file) | ordinary mixed search: an unsynced rejoin cannot union a stale retained image with current data | [integration-final-1.log](integration-final-1.log), [search-publication-final.log](search-publication-final.log) |
| 31 | ours (leaf/file) | ordinary mixed search process: a real device reset withdraws delivery and restarts its cursor | [integration-final-1.log](integration-final-1.log), [search-publication-final.log](search-publication-final.log) |
| 32 | ours (leaf/file) | ordinary mixed search wasm: a real device reset withdraws delivery and restarts its cursor | [integration-final-1.log](integration-final-1.log), [search-publication-final.log](search-publication-final.log) |
| 33 | ours (leaf/file) | online: refusals remain HTTP, reads back off, same-ID writes recover | [integration-final-1.log](integration-final-1.log) |
| 34 | ours (leaf/file) | native process devices withdraw an expired inbox during fallback, offline and on account switch | [integration-final-1.log](integration-final-1.log) |
| 35 | ours (leaf/file) | web IndexedDB device withdraws expired inbox data in useQuery and usePage | [integration-final-1.log](integration-final-1.log) |
| 36 | ours (leaf/file) | wasm-memory: retained filters every watched read | [integration-final-1.log](integration-final-1.log) |
| 37 | ours (leaf/file) | native-sqlite: retained filters every watched read | [integration-final-1.log](integration-final-1.log) |
| 38 | ours (leaf/file) | profile screen waits for proven existence and uses each replacement | [integration-final-1.log](integration-final-1.log) |
| 39 | ours (leaf/file) | review: new unsynced membership invalidates continuation process | [integration-final-1.log](integration-final-1.log), [search-publication-final.log](search-publication-final.log) |
| 40 | ours (leaf/file) | review: new unsynced membership invalidates continuation wasm | [integration-final-1.log](integration-final-1.log), [search-publication-final.log](search-publication-final.log) |
| 41 | ours (leaf/file) | review: hidden sync during delivery withdraws the page process | [integration-final-1.log](integration-final-1.log), [search-publication-final.log](search-publication-final.log) |
| 42 | ours (leaf/file) | review: hidden sync during delivery withdraws the page wasm | [integration-final-1.log](integration-final-1.log), [search-publication-final.log](search-publication-final.log) |
| 43 | ours (leaf/file) | review: unsynced audience loss also withdraws the continuation process | [integration-final-1.log](integration-final-1.log), [search-publication-final.log](search-publication-final.log) |
| 44 | ours (leaf/file) | review: unsynced audience loss also withdraws the continuation wasm | [integration-final-1.log](integration-final-1.log), [search-publication-final.log](search-publication-final.log) |
| 45 | ours (leaf/file) | review: same-count audience swap withdraws the old continuation process | [integration-final-1.log](integration-final-1.log), [search-publication-final.log](search-publication-final.log) |
| 46 | ours (leaf/file) | review: same-count audience swap withdraws the old continuation wasm | [integration-final-1.log](integration-final-1.log), [search-publication-final.log](search-publication-final.log) |
| 47 | ours (leaf/file) | social recipes in React/browser: real online signals and media, controlled read interleavings > renewal, idle without blur, Send, route visibility/key and unmount stop before expiry | [social-renewal-final.log](social-renewal-final.log) |
| 48 | ours (failed parent) | social recipes in React/browser: real online signals and media, controlled read interleavings | [social-renewal-final.log](social-renewal-final.log) |
| 49 | ours (leaf/file) | social starter native: cold owner keys prove old likes and unqueried absence offline | [integration-final-1.log](integration-final-1.log) |
| 50 | ours (leaf/file) | social starter web: cold owner keys prove old likes and unqueried absence offline | [integration-final-1.log](integration-final-1.log) |

Full-size search and mixed-evidence reruns each retain 300 seeds/histories per host and report zero failed seeds. Original failing model traces and seed sets remain in the full log; changing the one-shot expectation does not weaken the independent observation/page oracle.

## Full-suite resolutions

- `answers-stay-react.test.mjs` — Wait for the existing reconnect probe before injecting observation retry faults.
- `client-lifecycle.test.mjs` — An unobserved write whose prediction was withdrawn now refuses E_QUERY_RETRY.
- `delivery-fault-matrix.test.mjs` — Classify the new read-only awaits in the census; retain delivery fault recipes.
- `delivery-publication.test.mjs` — Expired manifest is discarded; a fresh ready reread creates no delivery debt.
- `expired-server-watch.test.mjs` — Renew the short-lived fixture row before testing deletion after longer query priming.
- `follow-window.test.mjs` — Remove frozen positive timers from live fixtures; retain transport/application gates and observation checks. The original worker alone was terminated at 615.70 seconds.
- `identity-review.test.mjs` — Invalid old continuations refuse after four attempts; cursor/identity assertions remain.
- `keep-clock.test.mjs` — Held recovery reaches the real 30-second refusal; expired memory stays withdrawn.
- `mixed-evidence-oracle.test.mjs` — The scheduled failed adoption now expects E_OFFLINE from the one-shot; observation oracle is unchanged.
- `online-store-order.test.mjs` — Four stale-sequence requests still back off, then refuse E_QUERY_RETRY.
- `ordinary-search-oracle.test.mjs` — Allow four discarded publication attempts/refusal, preserving exact page, identity and coverage assertions.
- `ordinary-search.test.mjs` — Reread retired pages or refuse invalid continuations; preserve/strengthen exact settled data and cursor assertions.
- `overload.test.mjs` — Await the reconnect probe before the next injected HTTP refusal.
- `page-observation.test.mjs` — Pending direct total refuses E_QUERY_RETRY; observed/raw loading and withdrawal checks remain.
- `readauth.test.mjs` — Unavailable direct offline reads refuse E_OFFLINE; observed retention assertions remain.
- `readme-examples.test.mjs` — The settled profile example and mock use partial/refused results, never one-shot loading.
- `review-probes.test.mjs` — Audience-invalid continuations refuse after four attempts; hidden-sync rereads preserve epochs and exact rows.
- `social-browser.test.mjs` — Wait for the reconnect probe after priming the query; typing lifecycle assertions are unchanged.
- `social-starter.test.mjs` — Cold unacquired offline one-shots refuse E_OFFLINE; the ready key/absence cases remain.

## Other failed runs

### [affected-custody.log](affected-custody.log)

- **ours** — sequence by wasm: provisional rule refusal queues for the server
- **ours** — sequence by wasm: provisional require refusal queues for the server
- **ours** — sequence by wasm: provisional constraint refusal queues for the server
- **ours** — sequence by wasm: provisional named constraint refusal queues for the server
- **ours** — sequence by wasm: provisional postcondition refusal queues for the server
- **ours** — sequence by wasm: provisional sequence key refusal queues for the server
- **ours** — sequence by wasm: provisional old refusal queues for the server
- **ours** — sequence by wasm: provisional empty index refusal queues for the server
- **ours** — sequence by wasm: provisional cap group refusal queues for the server
- **ours** — sequence by wasm: provisional upsert index refusal queues for the server
- **ours** — sequence by wasm: provisional postcondition index refusal queues for the server
- **ours** — ready list reads survive account restoration, new chat acquisition and pending unread counts

### [affected-existing.log](affected-existing.log)

- **ours** — FF1: committed reset invalidates watches and acquisition before a denied sync_state read
- **ours** — finding 2: delayed server answer cannot escape its incarnation
- **ours** — finding 2: delayed watch answer cannot escape its incarnation
- **ours** — finding 2: changes observation drops freshness while a mutation holds the network queue

### [affected-migrated.log](affected-migrated.log)

- **ours** — bounded Following wasm: unknown conditions preserve static and helper dependencies
- **ours** — bounded Following wasm: a speculative profile withholds while a non-speculative page keeps predicted rows
- **ours** — bounded Following wasm: a response racing prediction admission is invalidated
- **ours** — bounded Following wasm: inbox floors use all routing branches and preserve meter prefixes
- **ours** — bounded Following native: unknown conditions preserve static and helper dependencies
- **ours** — bounded Following native: a speculative profile withholds while a non-speculative page keeps predicted rows
- **ours** — bounded Following native: a response racing prediction admission is invalidated
- **ours** — bounded Following native: inbox floors use all routing branches and preserve meter prefixes
- **ours** — ready list reads survive account restoration, new chat acquisition and pending unread counts

### [custody-final.log](custody-final.log)

- **ours** — ready list reads survive account restoration, new chat acquisition and pending unread counts

### [follow-nonedge-repro.log](follow-nonedge-repro.log)

- **ours** — wasm: post, like and remove do not gate mounted Following
- **ours** — process: post, like and remove do not gate mounted Following

### [follow-window-final.log](follow-window-final.log)

- **ours** — wasm: post, like and remove do not gate mounted Following
- **ours** — process: post, like and remove do not gate mounted Following
- **ours** — Chromium worker=false: mounted Following tracks adopted follow custody
- **ours** — Chromium worker=false: mounted Following tracks adopted unfollow custody
- **ours** — Chromium worker=true: mounted Following tracks adopted follow custody
- **ours** — Chromium worker=true: mounted Following tracks adopted unfollow custody

### [following-migration.log](following-migration.log)

- **ours** — bounded Following wasm: a response racing prediction admission is invalidated
- **ours** — bounded Following wasm: inbox floors use all routing branches and preserve meter prefixes

### [full-followups-2.log](full-followups-2.log)

- **ours** — expired server replies: recover, keep=undefined

### [full-followups-repro.log](full-followups-repro.log)

- **ours** — wasm: population growth cannot mint new IDs during prediction replay
- **ours** — native: population growth cannot mint new IDs during prediction replay
- **ours** — every delivery await is explicitly classified
- **ours** — local fallback rejects its manifest when expiry changes before acceptance
- **ours** — expired server replies: recover, keep=undefined
- **ours** — expired server replies: recover, keep=true

### [guide.log](guide.log)

- **ours** — client::published::client_teaches_sdk_delivery_and_screen_seen
- **ours** — client::existence_card_and_starters_teach_the_sdk_words
- **ours** — definitions::w11_every_registered_code_quotes_its_definition
- **ours** — w11_every_registered_code_has_a_dedicated_section

### [held-matrix-final.log](held-matrix-final.log)

- **ours** — online: held online-only view, both link states recorded
- **ours** — app-online: held online-only view, both link states recorded

### [integration-final-1.log](integration-final-1.log)

- **ours** — social recipes in React/browser: real online signals and media, controlled read interleavings > renewal, idle without blur, Send, route visibility/key and unmount stop before expiry
- **ours** — social recipes in React/browser: real online signals and media, controlled read interleavings

### [main-held-matrix.log](main-held-matrix.log)

- **ours (held-query harness expected data instead of E_QUERY_HELD)** — online: held online-only view, both link states recorded
- **baseline** — wasm: held online-only view, both link states recorded
- **baseline** — process: held online-only view, both link states recorded
- **ours (held-query harness expected data instead of E_QUERY_HELD)** — app-online: held online-only view, both link states recorded
- **baseline** — app-wasm: held online-only view, both link states recorded
- **baseline** — app-process: held online-only view, both link states recorded

### [main-reproduction-complete.log](main-reproduction-complete.log)

- **baseline** — online: concurrent write retires the final continuation and query rereads
- **baseline** — online: deadline crossed after evaluation rereads before return
- **baseline** — app-online: concurrent write retires the final continuation and query rereads
- **baseline** — app-online: deadline crossed after evaluation rereads before return
- **baseline** — wasm: online-only view with an admitted unobserved write, link up
- **baseline** — process: online-only view with an admitted unobserved write, link up
- **baseline** — app-wasm: online-only view with an admitted unobserved write, link up
- **baseline** — app-process: online-only view with an admitted unobserved write, link up
- **baseline** — online: a mounted answer's withdrawn deadline cannot return loading to a one-shot
- **baseline** — wasm: a mounted answer's withdrawn deadline cannot return loading to a one-shot
- **baseline** — process: a mounted answer's withdrawn deadline cannot return loading to a one-shot
- **baseline** — app-online: a mounted answer's withdrawn deadline cannot return loading to a one-shot
- **baseline** — app-wasm: a mounted answer's withdrawn deadline cannot return loading to a one-shot
- **baseline** — app-process: a mounted answer's withdrawn deadline cannot return loading to a one-shot
- **baseline** — app-online: a write during facade approval forces another read
- **baseline** — app-wasm: a write during facade approval forces another read
- **baseline** — app-process: a write during facade approval forces another read

### [main-reproduction.log](main-reproduction.log)

- **baseline** — online: concurrent write retires the final continuation and query rereads
- **baseline** — app-online: concurrent write retires the final continuation and query rereads
- **baseline** — app-online: a write during facade approval forces another read
- **baseline** — app-wasm: a write during facade approval forces another read
- **baseline** — app-process: a write during facade approval forces another read

### [main-unavailable.log](main-unavailable.log)

- **baseline** — wasm: an unavailable held online-only view refuses instead of returning loading
- **baseline** — process: an unavailable held online-only view refuses instead of returning loading
- **baseline** — app-wasm: an unavailable held online-only view refuses instead of returning loading
- **baseline** — app-process: an unavailable held online-only view refuses instead of returning loading

### [react-offline-repro.log](react-offline-repro.log)

- **ours** — online keep=undefined: profile route gate > retry exhaustion
- **ours** — online keep=undefined: profile route gate
- **ours** — online keep=true: profile route gate > retry exhaustion
- **ours** — online keep=true: profile route gate

### [social-renewal-diagnostic.log](social-renewal-diagnostic.log)

- **ours** — social recipes in React/browser: real online signals and media, controlled read interleavings > renewal, idle without blur, Send, route visibility/key and unmount stop before expiry
- **ours** — social recipes in React/browser: real online signals and media, controlled read interleavings

### [social-renewal-repro.log](social-renewal-repro.log)

- **ours** — social recipes in React/browser: real online signals and media, controlled read interleavings > renewal, idle without blur, Send, route visibility/key and unmount stop before expiry
- **ours** — social recipes in React/browser: real online signals and media, controlled read interleavings

## Other resolutions

- Baseline loading and stale aggregate failures are covered by the final causal suite (`affected-final-core.log`, 123/123 including causal, type and bound checks).
- Existing one-shot tests expecting loading now assert the appropriate refusal. Unobserved-write cases assert the custody barrier; raw evaluator and observation assertions remain.
- Guide failures were the client-card budget, pinned receipt prose, new-code definition census and missing default-card routing. The whole guide passes 105/105 in `guide-final.log`.
- The first held-matrix probe incorrectly expected online held queries to return data. Both online tiers correctly returned E_QUERY_HELD on main and final. `held-matrix-corrected.log` passes 6/6.
- The initial deadline reproduction set Date.now after client construction, so that clock control was ineffective. The complete reproduction installs the clock before construction and demonstrates the baseline failures.
- Page-ready migrations initially left data assertions behind an unobserved nonpredictable write. They now require refusal and independently preserve the observed server-total check; `page-ready-final.log` passes.
- Following migrations are corrected by `following-final.log` (8/8) and `follow-window-corrected.log` (24/24). The latter also removes browser fixture timer freezing and covers the two non-edge like recovery cases.
- `full-followups-final.log` passes 7/7 after the replay, census, manifest and short-lived row fixtures were corrected.
- `react-offline-final.log` passes 10/10 after waiting for actual reconnection.
- `integration-final-1.log` failed only the typing renewal child and its parent. Diagnostic output proved the arm was still offline after a priming one-shot returned immediately. `social-renewal-final.log` passes 12/12 after waiting for the existing reconnect probe; typing and observation behavior are unchanged.

Full scope, source-drift limits and wasm measurements are in [REPORT.md](REPORT.md).

## Evidence-helper correction

- **ours** — The final artifact-hash helper initially checked a headerless `gzip -n -9` size (593,200 B) against the canonical build size (593,225 B) and failed its assertion. It now uses the build script's `gzip -9 -c <filename>` convention; the assertion and manifest generation pass. This was a reporting-helper mistake, not a wasm build or budget failure.

# Clique — final report

Lane: astra-clique-snapback4-full-20260913. Model: gpt-6-astra, effort medium. Built alone from the pinned public packages in this lane. M7 was not attempted. The essay was written after M8 first went green and before this metric tally; later scale findings are explicitly qualified there.

Run start=1789721963; end=1789729295; wall=7332 seconds. Scale execution overlapped M8 and has its own clock below, so milestone and replay durations must not be added as a serial elapsed total. The machine-readable record is [final-record.json](evidence/final-record.json).

## Milestone clocks and status

| Milestone | Status | Start epoch | End epoch | Wall seconds | First-green epoch | Seconds to first green |
|---|---|---:|---:|---:|---:|---:|
| M1 | green | 1789721963 | 1789722429 | 466 | 1789722415 | 452 |
| M2 | green | 1789722429 | 1789723029 | 600 | 1789722918 | 489 |
| M3 | green | 1789723029 | 1789723343 | 314 | 1789723297 | 268 |
| M4 | green | 1789723343 | 1789723575 | 232 | 1789723531 | 188 |
| M5 | green | 1789723575 | 1789724426 | 851 | 1789724368 | 793 |
| M6 | green | 1789724427 | 1789724925 | 498 | 1789724892 | 465 |
| M8 | green | 1789724941 | 1789729286 | 4345 | 1789725446 | 505 |
| M7 | not-run | — | — | — | — | — |

First-green timestamps are the later of the first known successful frozen choreography summary and the initial successful Hermes export log's completion time, rounded up to seconds; the choreography receipt already binds a passing suite. They are evidence-derived completion times, distinct from the later diary/boundary logging epochs stored in the JSON record. M8 end includes the final source audit and affected M5 revalidation. Source changes after an earlier milestone's green are recorded as later integration corrections, not erased from the log. No milestone reached the four-hour safety limit or was relabeled from a failure to a skip.

## Suite, choreography and native evidence

| Milestone | Suite | Coverage evidence | Choreography | Receipt | Native artifact |
|---|---|---|---|---|---|
| M1 | pass; 7 assertions | [suite](evidence/m1-suite.json), [coverage](evidence/m1-coverage.json) | 3/3 passed; 0 skipped | [JSONL](evidence/m1-choreo-1789722405576.jsonl) | [Hermes](artifacts/m1-ios) |
| M2 | pass; 22 assertions | [suite](evidence/m2-suite.json), [coverage](evidence/m2-coverage.json) | 9/9 passed; 0 skipped | [JSONL](evidence/m2-choreo-1789722929317.jsonl) | [Hermes](artifacts/m2-ios) |
| M3 | pass; 7 assertions | [suite](evidence/m3-suite.json), [coverage](evidence/m3-coverage.json) | 7/7 passed; 0 skipped | [JSONL](evidence/m3-choreo-1789727947163.jsonl) | [Hermes](artifacts/m3-ios) |
| M4 | pass; 5 assertions | [suite](evidence/m4-suite.json), [coverage](evidence/m4-coverage.json) | 5/5 passed; 0 skipped | [JSONL](evidence/m4-choreo-1789723480584.jsonl) | [Hermes](artifacts/m4-ios) |
| M5 | pass; 6 assertions | [suite](evidence/m5-suite.json), [coverage](evidence/m5-coverage.json) | 4/4 passed; 0 skipped | [JSONL](evidence/m5-choreo-1789726022583.jsonl) | [Hermes](artifacts/m5-ios) |
| M6 | pass; 5 assertions | [suite](evidence/m6-suite.json), [coverage](evidence/m6-coverage.json) | 1/1 passed; 0 skipped | [JSONL](evidence/m6-choreo-1789724697432.jsonl) | [Hermes](artifacts/m6-ios) |
| M8 | pass; 6 assertions | [suite](evidence/m8-suite.json), [coverage](evidence/m8-coverage.json) | 5/5 passed; 0 skipped | [JSONL](evidence/m8-choreo-1789728096992.jsonl) | [Hermes](artifacts/m8-ios) |

The supplemental native harness evidence is preserved exactly as recorded: M6: `not-recorded`, requiredForGreen=false, reason “M6 simulator evidence is recorded separately from web green”; M8: `not-recorded`, requiredForGreen=false, reason “M8 simulator evidence is recorded separately from web green”. This is not a claim of simulator execution. The environment requires Hermes exports and no simulator proof. Additional functional evidence includes [bounded quote jump](evidence/quote-page-proof-2.log), [durable replica restart](evidence/m6-offline-proof-1.log), [expiry with all clients closed](evidence/m5-expiry-proof-2.log), [edit/delete windows and revocation](evidence/m4-window-proof.log), and [scheduled digest authorization, retry, restart and catch-up](evidence/m8-time-proof-suite.log).

| Milestone | Hermes file | Bytes | SHA-256 |
|---|---|---:|---|
| M1 | artifacts/m1-ios/_expo/static/js/ios/entry-df8f94ec8a327a2af1ffae2f022d01d3.hbc | 2765055 | `88af61327cce0d0ffeb057532e530eac7c3a286cc02690a166f5e1f7e7c974f6` |
| M2 | artifacts/m2-ios/_expo/static/js/ios/entry-5b53869134b48b67055ba4f092314549.hbc | 2791995 | `b642ae47722e00c09f831614af71c43bc35bf5a0ad53b71b58b783fc1642535d` |
| M3 | artifacts/m3-ios/_expo/static/js/ios/entry-345113fc5dcaf4f387d321a9e6ce3085.hbc | 2813107 | `49d57ab65ec4e73334323828217734b453ffd890b91fdc3778f52c52ee59e4e9` |
| M4 | artifacts/m4-ios/_expo/static/js/ios/entry-5e4a1ee11869b601d5c764ecec8e61b4.hbc | 2819286 | `267186133e24c28c7184febb0d1cbca357a9aa7d98f20b69c93ab207a8ce6fdd` |
| M5 | artifacts/m5-ios/_expo/static/js/ios/entry-cc8c105f599bcd1f4df5aee17ac26a8d.hbc | 2826833 | `7795a570c25bcb274a7e9a71dfceadd9436c595d696fa39e84acdd8fa5d2d04e` |
| M6 | artifacts/m6-ios/_expo/static/js/ios/entry-cc8c105f599bcd1f4df5aee17ac26a8d.hbc | 2826834 | `2cf87f80b7952a9eb928e857bb4b4e83dd8c7000fdd6dbc3b112c907fd5291c3` |
| M8 | artifacts/m8-ios/_expo/static/js/ios/entry-7ff8f1a57e438d020d01deaf4285262a.hbc | 2834455 | `2094c4a0cf948d39912df4ebb4cc57ff3251d7aa8b2f8e029382b98f9a14c504` |

## Scale replay on its own clock

Start=1789724925; end=1789729041; raw wall=4116 seconds; checkpoint verification/probe exclusion=12566 ms; replay-clock wall=4103.434 seconds. Result: **verified**. 167243 starter-plus-scale actions were acknowledged. The frozen scale log contains 167157 actions, plus 86 starter actions. Log timestamps were documentary; no content was backdated. The fresh directory was `scale-instance/`, port 49363, with `--replay` pinned. No numeric frozen scale cap was supplied in the instrument's placeholder table; this runner applied a separate four-hour safety ceiling and checks it between actions. 

- 10pct: pass, 24863 acknowledged starter-plus-scale actions; [verification](evidence/scale-10pct-verification.json), [builder probes](evidence/scale-10pct-probes.json).
- 50pct: pass, 88143 acknowledged starter-plus-scale actions; [verification](evidence/scale-50pct-verification.json), [builder probes](evidence/scale-50pct-probes.json).
- final: pass, 167243 acknowledged starter-plus-scale actions; [verification](evidence/scale-final-verification.json), [builder probes](evidence/scale-final-probes.json).

Verification combined independent actual own-store counts with authorized API reads, exact named O5 fixtures, all named spot entities, and full paging of the busy chat. Receipts are [scale-receipts.jsonl](evidence/scale-receipts.jsonl); the clock/result is [scale-result.json](evidence/scale-result.json). Corpus-wide counts were not inferred solely from queued writes. Builder probes are explicitly separate from the hidden grader's rotated scored probes.

M8 full-corpus adoption/proof: **pass**. After the replay clock ended, the completed M8 schema was adopted with replay suppression still enabled; derived projections were backfilled, four named users’ Insights were compared with independent SQL, and the exact top ten and 48224 original-post rank rows were checked. See [proof](evidence/scale-m8-proof.json) and [doctor](evidence/scale-m8-doctor.json).

## Corrections and attribution

Counts are logged correction events, not a fabricated count of every compiler diagnostic within an event: environment=4, agent-error=20, ambiguous=3, snapback4-defect=1. Each row below retains its evidence pointer; [run-log.md](run-log.md) also records knowledge lookups, retries, process PIDs and boundary notes.

| Epoch | Attribution | Event and evidence |
|---:|---|---|
| 1789722100 | environment | environment correction; actual default node=v25.9.0; switching PATH to /Users/ccheever/.volta/tools/image/node/24.18.0/bin; evidence: tool output. |
| 1789722223 | environment | error/retry attribution=environment; copied frozen choreography retained read-only permissions; chmod u+w on lane copies only then npm install; evidence: evidence/choreo-install.log and evidence/choreo-install-retry.log |
| 1789722346 | agent-error | correction-loop attribution=agent-error; profile form spread row metadata into saveProfile args; explicit field selection fixes E_INPUT; evidence=evidence/m1-acceptance-1.log |
| 1789722375 | environment | error/retry attribution=environment; copied choreography requires ../metering/observations.mjs; copy instrument dependencies unchanged; evidence=evidence/m1-choreo.log |
| 1789722402 | agent-error | correction-loop attribution=agent-error; overlapping suite runs overwrote shared suite status; rerun serially after both finished; evidence=evidence/m1-suite.json,evidence/m1-acceptance-2.log |
| 1789722690 | agent-error | correction-loop attribution=agent-error; RN Image.resolveAssetSource unavailable on web; use Metro web asset URI with native fallback; evidence=evidence/m2-acceptance-1.log |
| 1789722738 | environment | error/retry attribution=environment; choreography default fixture directory assumes original instrument layout; set adapter fixtures.directory to lane copy; evidence=evidence/m2-choreo-1.log |
| 1789722780 | agent-error | correction-loop attribution=agent-error; choreography switches feed tabs while on profile/thread; add persistent feed navigation in shell; evidence=evidence/m2-choreo-1.log |
| 1789722886 | agent-error | correction-loop attribution=agent-error; unfollow is server-only and navigation exposed stale local projection before catch-up; wait for mutation and sync before enabling feed navigation; evidence=evidence/m2-debug-feed.log |
| 1789723248 | agent-error | correction-loop attribution=agent-error; default group title route failed resolution; bind adapter directly to stable starter conversation ID, add direct-id navigation and DM creation for new counterpart routes; evidence=evidence/m3-choreo-1.log |
| 1789723468 | agent-error | correction-loop attribution=agent-error; media picker admitted Send before async video selection finished and suite read before commit; disable Send while selecting/uploading and await authoritative media witness; evidence=evidence/m4-acceptance-1.log |
| 1789724026 | ambiguous | M5 correction loop attribution=ambiguous; view-once choreography miss persisted ordinary photo while independent UI reproduction sent once=true. No source changes during retry; evidence=m5-choreo-1.log,m5-debug-once.log. Other choreography assertions passed including actual expiry wait. |
| 1789724398 | agent-error | M5 unchanged retry passed all choreography; correction attribution=agent-error final UI audit wired saved accent into bubbles and conversation-specific search navigation; config compiler added to backend start. Evidence=m5-choreo-2.log. |
| 1789724882 | ambiguous | M6 offline web choreography and native process-device durability proof passed without correction. Evidence=m6-choreo-1.log,m6-offline-proof-1.log. Knowledge lookup source=package README/guide prediction; full held membership partitions permit predicted sends with explicit IDs in this schema. |
| 1789724925 | agent-error | M6 knowledge lookup source=fixture: action-schema.md, sample-50.log, combined invariant manifest; source=published docs: own-store read-only SQL and worker/token API. Adapter maps arbitrary fixture intent IDs to durable minted write IDs. Inspection-only TypeError from printing nonexistent manifest key corrected to namedSpotEntities; attribution=agent-error; no app impact. |
| 1789725121 | agent-error | M8 correction attribution=agent-error; generated schedule used120s although published schedule syntax allows m/h/d; exact E_QUARRY_SYNTAX in evidence/m8-check-1.log. Generator now expresses config seconds as whole minutes. |
| 1789725137 | agent-error | M8 correction attribution=agent-error; attempted aggregate arithmetic in row rule unsupported: E_QUARRY_UNKNOWN likeCounts[.postId] is not a rule term. Ranking remains derived only by internal helper and backfill job, no caller-supplied score/time API; copied original time checked by exists rule. Evidence=m8-check-2.log. |
| 1789725344 | agent-error | M8 correction attribution=agent-error; TS2322 ranked wrapper passed rank to union FeedCardProps. Explicit wrapper component type corrected; evidence=m8-typecheck-1.log. Ranking diagnostic N_PUBLIC_AGGREGATE_COPY acknowledged: only updateRank derives score from live maintain, caller cannot supply score; score/time index supplies exact newest-first ties. |
| 1789725551 | agent-error | M8 correction attribution=agent-error; digestProgress.key omitted required text bound: E_QUARRY_SYNTAX expected a number, got newline (evidence/m8-check-4.log). Proof cleanup also awaited exit of already exited compile-failed child; made cleanup exit-aware. Evidence=m8-time-proof-2.log. |
| 1789725565 | agent-error | M8 correction attribution=agent-error; E_QUARRY_AMBIGUOUS on text progress key (byId/byKey); used named key predicate. Evidence=m8-check-5.log. Failed proof startup exited without a running server. |
| 1789725618 | ambiguous | M8 final digest catch-up proof passes after syntax corrections; coalesced schedule covers missed periods, including an unread message older than the latest short period. Evidence=m8-time-proof-4.log. Package pins resolved exactly; evidence=resolved-pins.json. |
| 1789726015 | snapback4-defect | Scale platform gap attribution=snapback4-defect (documented capability bound): people q=u09 returns20 complete=false cut=words next=null; 32 first-term words per scope. Exact q=u0900 complete. source=diagnostic,published guide; evidence=scale-search-bound.log,guide-search.txt,platform-gaps.md. No assertion struck or false skip. |
| 1789726015 | agent-error | Final correction attribution=agent-error: expose partial search status in UI and change people search from oldest-first to newest-first. Evidence=src/search.tsx,snapback/schema.q. Revalidating affected M5 paths and final native bundle while scale own-clock continues. |
| 1789726354 | agent-error | Evidence wording correction attribution=agent-error: native supplemental harness status is not-recorded (requiredForGreen=false), not an instrument skip. Exact status/reason retained in platform-gaps.md; browser required checks have no relabeled skips. |
| 1789727427 | agent-error | Post-green correction attribution=agent-error: quoted-message jump only referenced loaded DOM rows and lacked native scrolling. Conversation now pages toward the referenced id; Shell supplies web/native scrolling to the actual row. Source=model knowledge (React Native measureLayout/ScrollView); evidence=src/chat.tsx,src/message.tsx,src/views.tsx. A targeted older-page proof follows. |
| 1789727618 | agent-error | Final regression correction attribution=agent-error: M3 quote suite assumed starter quote remained in first50 messages; dev corpus now exceeds page size. Test now loads Earlier messages before asserting. Evidence=m3-acceptance-final.log. The already-running serial shell lacked fail-fast and may append an optimistic completion log; that entry is not a green claim. Revalidation will use set -e and explicit results. |
| 1789727751 | agent-error | Correction to run-log entry1789727628: its optimistic shell completion text is invalid; M3 browser checks passed but suite failed before pagination repair. It is not a final verification boundary. Follow-up quote implementation uses one indexed surrounding-message window (rather than rendering all intervening history at the busy-chat envelope), and resets conversation state by id. Evidence=chat.around,quote-page-proof.mjs. |
| 1789727804 | agent-error | Quote-window correction attribution=agent-error: casting dynamic usePage operation to any erased inferred item types (TS18046/TS2339). Both operations return messageCard; preserve the generated history result type for the shared hook. Fail-fast prevented subsequent test/export steps. Evidence=quote-typecheck-2.log. |

## Package and source accounting

Resolved: `snapback4@0.2.29`, its optional `snapback4-darwin-arm64@0.2.29` binary, and `snapback4-expo@0.2.20`; the native package resolves the same Snapback version. [Resolved npm tree](evidence/resolved-pins.json). No Snapback source checkout or other lane was inspected. Token accounting remains harness-native; no token estimate is made here.

Physical line counts below cover non-vendor source, tests, scripts and authored documentation. Adapted app/config files count in full. Long JSX/script lines are physical lines, so this is not a complexity measure. Copied kit/harness/fixtures, dependencies, generated API/configuration, bundles, receipt data and this generated report are excluded. The published feed recipe is excluded except its single manually added immutability line; its configured capacities were supplied to the generator. The generated `src/following.ts` wrapper is also excluded. [Machine-readable counts](evidence/line-counts.json).

| File | Authored/adapted physical lines |
|---|---:|
| .gitignore | 8 |
| API.md | 73 |
| README.md | 48 |
| app.json | 28 |
| app/_layout.tsx | 4 |
| app/chat-settings/[id].tsx | 1 |
| app/chats.tsx | 1 |
| app/conversation/[handle].tsx | 1 |
| app/conversation/group/[group]/index.tsx | 1 |
| app/conversation/group/[group]/settings.tsx | 1 |
| app/conversation/id/[id].tsx | 1 |
| app/index.tsx | 5 |
| app/insights.tsx | 1 |
| app/new-chat.tsx | 1 |
| app/post/[id].tsx | 1 |
| app/profile/[handle].tsx | 4 |
| app/profile/edit.tsx | 3 |
| app/search.tsx | 1 |
| app/settings.tsx | 6 |
| diary.md | 42 |
| essay.md | 33 |
| index.js | 1 |
| package.json | 44 |
| platform-gaps.md | 25 |
| scripts/acceptance.mjs | 30 |
| scripts/choreo.mjs | 8 |
| scripts/configure.mjs | 12 |
| scripts/custom-client-demo.mjs | 10 |
| scripts/debug-feed.mjs | 4 |
| scripts/debug-once.mjs | 1 |
| scripts/expiry-proof.mjs | 3 |
| scripts/log.mjs | 1 |
| scripts/m8-time-proof.mjs | 7 |
| scripts/offline-proof.mjs | 2 |
| scripts/push-worker.mjs | 8 |
| scripts/quote-page-proof.mjs | 1 |
| scripts/replay.mjs | 29 |
| scripts/report.mjs | 76 |
| scripts/scale-m8-proof.mjs | 5 |
| scripts/scale-run.mjs | 3 |
| scripts/scale-verify.mjs | 13 |
| scripts/seed.mjs | 33 |
| scripts/test-m2.mjs | 12 |
| scripts/test-m3.mjs | 7 |
| scripts/test-m4.mjs | 5 |
| scripts/test-m5.mjs | 5 |
| scripts/test-m6.mjs | 6 |
| scripts/test-m8.mjs | 5 |
| scripts/window-proof.mjs | 3 |
| snapback/chat.q | 195 |
| snapback/digest.q | 75 |
| snapback/insights.q | 55 |
| snapback/media.q | 67 |
| snapback/schema.q | 38 |
| snapback/settings.q | 34 |
| snapback/social.q | 119 |
| src/chat.tsx | 18 |
| src/client.ts | 21 |
| src/insights.tsx | 3 |
| src/media.tsx | 9 |
| src/message.tsx | 3 |
| src/search.tsx | 2 |
| src/session.tsx | 21 |
| src/social.tsx | 20 |
| src/views.tsx | 18 |
| tsconfig.json | 17 |
| snapback/feed.q (manual addition only: immutable at) | 1 |

## Gaps and limits

- Broad word-prefix search can return `complete:false, cut:"words"` without a continuation after 32 distinct first-term words per scope. This was reproduced with `u09` at scale; exact `u0900` completed. The UI discloses incomplete results. This is a real restriction on the general pagination promise, not a struck requirement. [Exact evidence and scope](platform-gaps.md).
- Full-public post/like replication and the feed recipe's explicit capacity limits are serving tradeoffs. They do not establish unbounded scale or cheap cold acquisition. The tested corpus and probe receipts define the evidence.
- The score projection retains `N_PUBLIC_AGGREGATE_COPY`; only internal code derives its score, with no public score/time argument. The fixed top-ten query's no-cursor note is intentional.
- Hermes export, browser choreography and process-replica proofs are not simulator or physical-device execution. No production deployment, real APNs/FCM delivery, or hidden grader pass is claimed.
- Development and shortened fixture configuration remain checked in intentionally. [README](README.md), [API](API.md), [diary](diary.md), and [essay](essay.md) explain operation and tradeoffs.

All servers and provider workers started by this run are stopped by recorded exact PID during cleanup. No pattern kill is used; cleanup evidence is in the run log.

end=1789729295

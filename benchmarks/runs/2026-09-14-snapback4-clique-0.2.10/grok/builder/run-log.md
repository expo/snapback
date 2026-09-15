lane id grok-clique-snapback4-full-20260913
model grok-4.6
effort=xhigh
backend=snapback4-0.2.10
start=1789392533
pins: snapback4@0.2.10, snapback4-expo@0.2.3
1789392533 created run-log.md with required header and package pins before any install
knowledge lookup source: published docs — npm README for snapback4@0.2.10 and snapback4-expo@0.2.3; `npx snapback4 guide` language card and keyword cards (types, indexes, rules, sync, expire, assets, feeds, search, effects, writes, jobs, personas)
workaround environment: ad-hoc-signed snapback4 darwin-arm64 binary stalls at _dyld_start when stdio is inherited from this host shell; Apple Development re-sign plus Python/Popen start_new_session launches it. Evidence: sample stacks at dyld_start; lldb/Popen succeed.
81016 snapback4 dev --port 49340 --fresh (worker 81019)
19455 expo start --web --port 49341 (metro child 19488)
M1 start after orientation; suite PASS m1 (acceptance/m1.json); choreography m1 green (receipts/m1.jsonl)
correction loop 1 attribution=environment evidence=dyld_start hang on npm binary; signed+session-spawn
correction loop 2 attribution=agent-error evidence=metro gitignore hid snapback/generated/api.ts; copied to src/api.generated.ts
correction loop 3 attribution=agent-error evidence=webDevice wasm URL resolved to HTML; public/snapback4_device_bg.wasm
correction loop 4 attribution=agent-error evidence=logout did not forgetSession / AuthForm only on /; moved AuthForm to root layout
M1 choreography green
59899 python scripts/sb4.py dev --port 49340 --fresh (snapback4 59916, worker 59918) after schema change; killed prior 81016/81019 only
19455 expo start --web --port 49341 still live
M2 start (continuation): suite PASS acceptance/m2.json
correction loop 5 attribution=agent-error evidence=video compose used video blob as Image poster; fixture /poster.png
correction loop 6 attribution=agent-error evidence=createPost upload File/Blob not arrayBuffer; WebFile no longer clears input
correction loop 7 attribution=agent-error evidence=unrepost left timeline rows; delete timeline by byActorPostKind
correction loop 8 attribution=snapback-defect evidence=likeCounts/online-only and unsynced likes table gave likesOf horizon none; sync public last 2000 by byTime on likes/reposts. package README assets/sync
correction loop 9 attribution=agent-error evidence=setLike bumpDailyLikes could not insert/update another principal's dailyActivity (read <- viewer); public dailyActivity. diagnostic E_RULE
M2 choreography green receipts/m2.jsonl recordedAt 2026-09-14T15:34:33.853Z firstGreenAt ~1789400073
M3 start (continuation): suite PASS acceptance/m3.json
knowledge lookup source: diagnostic — setLike E_RULE dailyActivity insert vs unread unique row
knowledge lookup source: package README — sync public last N makes likesOf device with likes-by-byPost horizon
1789400073 M2 choreography green receipts/m2.jsonl (9/9)
M3 suite PASS; choreography not green across runs (DM/receipts/typing/quoted/member-add each passed in some JSONL, never all required together in the last file)
94075/94077/94079 snapback4 dev --port 49340 --fresh (restart)
correction loop 12 attribution=agent-error evidence=RN Composer send disabled under Playwright fill; native textarea
correction loop 13 attribution=agent-error evidence=29 receiptsOf polls starved mutate; sendMessage hung until polls reduced
correction loop 14 attribution=agent-error evidence=groupsNamed null after remove unmounted Thread; cached conversationId
M4 suite PASS; choreo photo pass, video/reactions/edit/delete fail receipts/m4.jsonl
M5 suite PASS; choreo color/background pass; view-once/search/disappearing fail receipts/m5.jsonl
M6 suite PASS; choreo offline queue fail receipts/m6.jsonl (createClient no outbox)
M8 suite PASS; choreo m8-a13 pass; insights/cross-device/dual-offline fail receipts/m8.jsonl
scale replay unchanged start=1789397301 end=1789397754 pass
essay.md and final-report.md written
end=1789404423


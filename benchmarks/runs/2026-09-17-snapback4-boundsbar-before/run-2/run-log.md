start=1789639758
check=1 at=1789639888 command="npx snapback4 check --cost --residency" exit=1 log=evidence/checks/001.log
milestone=first-check at=1789639892
loop=1 attribution=agent-error command="node scripts/check.mjs --cost --residency" failure="Unary minus directly before a table read parsed as a removed write sigil" resolution="Use 0 - likeCounts[postKey]"
knowledge-lookup card=guide lines=2
knowledge-lookup card=search lines=320
knowledge-lookup card=bounds lines=44
knowledge-lookup card=personas lines=94
knowledge-lookup card=reads lines=208
knowledge-lookup card=types lines=104
knowledge-lookup card=language lines=389
knowledge-lookup card=why-E_QUARRY_SYNTAX lines=15
check=2 at=1789639906 command="npx snapback4 check --cost --residency" exit=0 log=evidence/checks/002.log
acceptance-start at=1789640075 pid=58185 port=58030 evidence=evidence/acceptance-1789640075300
milestone=seed at=1789640084
seed-seconds=8.537
acceptance-failure at=1789640084 evidence=evidence/acceptance-1789640075300/failure.txt
acceptance-cleanup at=1789640084 pid=58185
knowledge-lookup card=writes lines=255
knowledge-lookup card=why-N_SPARSE_FILTER lines=15
knowledge-lookup card=why-N_WIDE_MERGE lines=12
loop=2 attribution=agent-error command="Node import snapback4; background npx dev" failure="Root package export absent; detached shell server did not persist" resolution="Use snapback4/client export and a tracked foreground tool session for probing; acceptance spawns and records its own child process group"
loop=3 attribution=agent-error command="npm run acceptance" failure="group(page) consumed native cursor ownership: complete false and next null on the first search result" resolution="Shape the native page into one-message room fragments, preserving its cursor owner and server ordering"
check=3 at=1789640124 command="npx snapback4 check --cost --residency" exit=0 log=evidence/checks/003.log
acceptance-start at=1789640125 pid=65018 port=60652 evidence=evidence/acceptance-1789640125117
milestone=seed at=1789640131
seed-seconds=5.912
milestone=search at=1789640137
milestone=following at=1789640143
milestone=roster-unread at=1789640143
milestone=trending at=1789640143
green=1789640143
acceptance-cleanup at=1789640143 pid=65018
acceptance-start at=1789640189 pid=72367 port=62193 evidence=evidence/acceptance-1789640189826
milestone=seed at=1789640197
seed-seconds=7.692
milestone=search at=1789640204
milestone=following at=1789640210
milestone=roster-unread at=1789640210
milestone=trending at=1789640210
green=1789640211
acceptance-cleanup at=1789640211 pid=72367
probe-server-cleanup session=79312 reason=SIGINT scope=own-started-server
search-protocol={"kind":"two-cursor","operations":["chats","searchBatch"],"cursorArgs":["batch","c"]}
following-shape={"kind":"merge-on-read"}
schema-shape={"workTables":["messageCounts","likeCounts"],"perPrincipalCounterTables":[],"auxiliaryOperations":["seedMessages","seedMembers","seedFollows","seedPosts","seedLikes"]}
derived-columns=[{"table":"messageCounts","column":"roomId"},{"table":"messageCounts","column":"value"},{"table":"likeCounts","column":"postKey"},{"table":"likeCounts","column":"value"},{"table":"posts","column":"negativeAt"},{"table":"posts","column":"negativeLikes"}]
task-lines={"search":[{"file":"snapback/schema.q","start":1,"end":26},{"file":"snapback/schema.q","start":69,"end":75},{"file":"snapback/schema.q","start":114,"end":126}],"following":[{"file":"snapback/schema.q","start":1,"end":1},{"file":"snapback/schema.q","start":32,"end":54},{"file":"snapback/schema.q","start":77,"end":80},{"file":"snapback/schema.q","start":96,"end":98},{"file":"snapback/schema.q","start":128,"end":141}],"rosterUnread":[{"file":"snapback/schema.q","start":1,"end":30},{"file":"snapback/schema.q","start":82,"end":91},{"file":"snapback/schema.q","start":114,"end":126}],"trending":[{"file":"snapback/schema.q","start":1,"end":1},{"file":"snapback/schema.q","start":41,"end":67},{"file":"snapback/schema.q","start":93,"end":111},{"file":"snapback/schema.q","start":135,"end":148}]}

Implementation narrative at first green: shared messages use scoped word indexes. Membership and result pages both use the product size 20. Native pages return singleton room fragments, already ordered on the server; the client only appends their message lists. No message copies or per-principal counters exist. Following discovers all capped follow edges and lazily merges author timelines. Unread sums maintained room message counts minus read ordinals across all memberships; this uses the packet's contiguous 1..N ordinals and no deletion API. Trending scans a rank index updated atomically by like mutations, then applies the requested post-time window. Rank uses negative likes, negative time and ascending logical key. No schedules or background rebuilds are needed.

Limits and failures at first green: initial group(page) lost continuation ownership and correctly returned complete:false; the first failed acceptance remains saved. The compiler initially refused unary minus adjacent to a maintain read. Search remains subject to the 32-word scope expansion bound and matching-merge meter ceiling; a cut merge may have no next. Follow and membership caps are 2048 per principal. Following lane setup grows with followed authors; unread visits every membership and count. Trending's unscoped time filter can scan many excluded old/future posts and hit the 8192 examined ceiling; it retains native cut and continuation metadata, with no claim that arbitrary windows always yield a complete first page. The fixed workload and the shifted zero-like window passed. Input batches contain at most 256 rows; text bounds are 128 for keys, 4000 for bodies and 100 for search. Public posts permit updates so the authored like helper can keep rank current; source likes enforce principal ownership, and import mutations require dev:seed. All application storage is online-only.
finish=1789640317
final-acceptance-seconds=21.318
final-seed-seconds=7.692

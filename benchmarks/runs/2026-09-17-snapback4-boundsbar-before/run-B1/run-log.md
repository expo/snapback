start=1789656984
check=1 at=1789657101 command="npx snapback4 check --cost --residency" exit=0
milestone=first-check at=1789657101
knowledge-lookup card=guide lines=2
knowledge-lookup card=search lines=320
knowledge-lookup card=reads lines=208
knowledge-lookup card=language lines=449
knowledge-lookup card=types lines=104
knowledge-lookup card=personas lines=94
knowledge-lookup card=bounds lines=44
knowledge-lookup card=writes lines=180
knowledge-lookup card=why-N_WIDE_MERGE lines=13
knowledge-lookup card=why-N_SPARSE_FILTER lines=16
loop=1 attribution=agent-error command="node import scripts/transport.mjs" failure="snapback4 has no root export" resolution="import snapback4/client"
server-start at=1789657188 pid=97103 port=61440 log=evidence/dev-1789657188192.log
server-stop at=1789657188 pid=97103
loop=2 attribution=agent-error command="node scripts/smoke.mjs" failure="transport used status instead of Write.state and expected a Read status" resolution="use Write.state and Read.data presence"
server-start at=1789657197 pid=98103 port=61533 log=evidence/dev-1789657197242.log
server-stop at=1789657197 pid=98103
check=2 at=1789657279 command="npx snapback4 check --cost --residency" exit=0
server-start at=1789657279 pid=8991 port=62434 log=evidence/dev-1789657279830.log
milestone=seed at=1789657286
seed-seconds=6.889
acceptance=failed at=1789657286 failure="Unfinished read: {\"data\":[{\"messages\":[{\"at\":1789667000099,\"key\":\"h000019-m000099\"}],\"roomId\":\"h000019\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000018-m000099\"}],\"roomId\":\"h000018\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000017-m000099\"}],\"roomId\":\"h000017\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000016-m000099\"}],\"roomId\":\"h000016\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000015-m000099\"}],\"roomId\":\"h000015\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000014-m000099\"}],\"roomId\":\"h000014\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000013-m000099\"}],\"roomId\":\"h000013\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000012-m000099\"}],\"roomId\":\"h000012\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000011-m000099\"}],\"roomId\":\"h000011\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000010-m000099\"}],\"roomId\":\"h000010\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000009-m000099\"}],\"roomId\":\"h000009\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000008-m000099\"}],\"roomId\":\"h000008\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000007-m000099\"}],\"roomId\":\"h000007\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000006-m000099\"}],\"roomId\":\"h000006\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000005-m000099\"}],\"roomId\":\"h000005\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000004-m000099\"}],\"roomId\":\"h000004\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000003-m000099\"}],\"roomId\":\"h000003\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000002-m000099\"}],\"roomId\":\"h000002\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000001-m000099\"}],\"roomId\":\"h000001\"},{\"messages\":[{\"at\":1789667000099,\"key\":\"h000000-m000099\"}],\"roomId\":\"h000000\"}],\"complete\":false,\"cut\":null,\"fresh\":true,\"next\":null,\"meter\":{\"cut\":null,\"examined\":481,\"heapBytes\":106209,\"indexEntries\":40,\"outputBytes\":2551,\"probes\":20,\"rowsWritten\":0,\"steps\":1414}}"
server-stop at=1789657286 pid=8991
loop=3 attribution=agent-error command="npm run acceptance" failure="group(page) discarded the merge cursor owner; first search page complete=false next=null" resolution="return grouped rows alongside an intact shaped page carrying the native cursor"
check=3 at=1789657310 command="npx snapback4 check --cost --residency" exit=0
check=4 at=1789657310 command="npx snapback4 check --cost --residency" exit=0
server-start at=1789657310 pid=12934 port=63556 log=evidence/dev-1789657310985.log
milestone=seed at=1789657320
seed-seconds=9.779
milestone=search at=1789657334
milestone=following at=1789657343
milestone=roster-unread at=1789657344
acceptance=failed at=1789657344 failure="Expected values to be strictly equal:\n\nfalse !== true\n"
server-stop at=1789657344 pid=12934
loop=4 attribution=agent-error command="npm run acceptance" failure="additional historical Trending window exhausted the rank-first scan meter; fixed A passed but arbitrary windows were sparse" resolution="partition ranking by UTC hour and merge the at-most-25 intersecting hour lanes, retaining exact boundary predicates"
check=5 at=1789657374 command="npx snapback4 check --cost --residency" exit=0
check=6 at=1789657375 command="npx snapback4 check --cost --residency" exit=0
server-start at=1789657375 pid=20790 port=64160 log=evidence/dev-1789657375056.log
milestone=seed at=1789657383
seed-seconds=7.832
milestone=search at=1789657394
milestone=following at=1789657401
milestone=roster-unread at=1789657402
acceptance=failed at=1789657402 failure="Unfinished read: {\"denied\":{\"code\":\"E_INPUT\",\"family\":\"input\",\"message\":\"E_INPUT: unknown variable $value1\"}}"
server-stop at=1789657402 pid=20790
loop=5 attribution=ambiguous command="npm run acceptance" failure="hour-scoped merge compiled but Trending returned E_INPUT unknown variable $value1" resolution="investigate computed range arguments in the merge selector and hoist expressions into named locals"
check=7 at=1789657454 command="npx snapback4 check --cost --residency" exit=0
server-start at=1789657455 pid=31279 port=64829 log=evidence/dev-1789657455093.log
server-stop at=1789657455 pid=31279
knowledge-lookup card=why-E_INPUT lines=12
loop=5 retracted
loop=5 attribution=snapback4-defect command="npm run acceptance" failure="compiled merge discovery with inline hour(at - 86400000) returned E_INPUT unknown variable $value1" resolution="hoist start, startHour and endHour into named locals; one-post fresh-server reproduction now returns a complete result"
check=8 at=1789657469 command="npx snapback4 check --cost --residency" exit=0
server-start at=1789657469 pid=33108 port=64986 log=evidence/dev-1789657469693.log
milestone=seed at=1789657476
seed-seconds=5.901
milestone=search at=1789657485
milestone=following at=1789657492
milestone=roster-unread at=1789657492
milestone=trending at=1789657492
acceptance=passed at=1789657493 seconds=23.997
server-stop at=1789657493 pid=33108
search-protocol={"kind":"two-cursor","operations":["chats","searchBatch"],"cursorArgs":["batch","c"]}
following-shape={"kind":"merge-on-read"}
schema-shape={"workTables":["unreadTotals","postHours"],"perPrincipalCounterTables":["members","unreadTotals"],"auxiliaryOperations":["seedMember","seedMessages","seedFollows","seedPosts","seedLike"]}
derived-columns=[{"table":"members","column":"unread"},{"table":"unreadTotals","column":"principal"},{"table":"unreadTotals","column":"value"},{"table":"posts","column":"likes"},{"table":"posts","column":"negLikes"},{"table":"posts","column":"negAt"},{"table":"posts","column":"hourKey"},{"table":"postHours","column":"hourKey"},{"table":"postHours","column":"value"}]
task-lines={"search":[{"file":"snapback/schema.q","start":1,"end":26},{"file":"snapback/schema.q","start":71,"end":78},{"file":"snapback/schema.q","start":117,"end":133}],"following":[{"file":"snapback/schema.q","start":1,"end":1},{"file":"snapback/schema.q","start":32,"end":60},{"file":"snapback/schema.q","start":80,"end":83},{"file":"snapback/schema.q","start":99,"end":101},{"file":"snapback/schema.q","start":135,"end":148}],"rosterUnread":[{"file":"snapback/schema.q","start":1,"end":30},{"file":"snapback/schema.q","start":85,"end":89},{"file":"snapback/schema.q","start":117,"end":133}],"trending":[{"file":"snapback/schema.q","start":1,"end":1},{"file":"snapback/schema.q","start":41,"end":69},{"file":"snapback/schema.q","start":91,"end":115},{"file":"snapback/schema.q","start":142,"end":152}]}
green=1789657528
knowledge-lookup card=language lines=170
knowledge-lookup card=reads lines=208
finish=1789657588
elapsed-seconds=604
Final architecture: two-cursor search with native cursor ownership; merge-on-read Following; exact membership unread counters and maintained principal sums; immediately updated UTC-hour rank lanes for Trending. Full acceptance passed. Known word expansion, examined-row meter, per-room cap, follow cap, and dense partial-hour limits are documented in final-report.md. No engine ceiling was changed.

start=1789639099
knowledge-lookup card=guide lines=2
knowledge-lookup card=language lines=448
knowledge-lookup card=search lines=319
knowledge-lookup card=reads lines=208
knowledge-lookup card=maintains lines=151
knowledge-lookup card=personas lines=93
knowledge-lookup card=bounds lines=43
knowledge-lookup card=types lines=103
knowledge-lookup card=writes lines=254
check=1 at=1789639222 command="npx snapback4 check --cost --residency" exit=0
milestone=first-check at=1789639241
knowledge-lookup card=why-N_WIDE_MERGE lines=11
knowledge-lookup card=why-N_SPARSE_FILTER lines=15
process-start at=1789639409 session=23455 port=4417 command="snapback4 dev --fresh --no-watch --port 4417"
loop=1 attribution=agent-error command="transport smoke test" failure="Assumed root client export and bare wire args; export unavailable and missing-argument wire replies" resolution="Use Node fetch transport with args envelope and state=sent acknowledgment"
process-start at=1789639410 pid=76887 port=51634 command="snapback4 dev --fresh --no-watch"
milestone=seed at=1789639419
seed-seconds=9.321
process-stop at=1789639419 pid=76887
loop=2 attribution=agent-error command="npm run acceptance" failure="Grouping a merge page into a list lost its native cursor; first search answer was complete:false with no next" resolution="Return the native membership page, shaped into complete nested chat matches; one membership cursor owns continuation and whole-chat nested collections use the schema cap"
check=2 at=1789639460 command="npx snapback4 check --cost --residency" exit=0
process-start at=1789639460 pid=82837 port=52297 command="snapback4 dev --fresh --no-watch"
process-stop at=1789639466 pid=55373 session=23455
milestone=seed at=1789639468
seed-seconds=8.182
milestone=search at=1789639469
milestone=following at=1789639476
milestone=roster-unread at=1789639476
process-stop at=1789639476 pid=82837
loop=3 attribution=agent-error command="npm run acceptance" failure="Extra shifted-window test found only two eligible posts then hit the 8192 examined meter scanning historical ranks; required anchor checks had passed" resolution="Partition rank index by stored UTC hour and discover only intersecting hours through a maintain; merge these ranked lanes with exact temporal filtering"
check=3 at=1789639530 command="npx snapback4 check --cost --residency" exit=0
process-start at=1789639530 pid=91144 port=52974 command="snapback4 dev --fresh --no-watch"
milestone=seed at=1789639536
seed-seconds=6.001
milestone=search at=1789639537
milestone=following at=1789639542
milestone=roster-unread at=1789639542
process-stop at=1789639542 pid=91144
loop=4 attribution=snapback4-defect command="npm run acceptance" failure="Compiled hourly-lane selector with inline hour() bounds refused at runtime with E_INPUT unknown variable $value1" resolution="Bind both hour expressions before the merge so the lane selector uses named locals; attribution based on compiler-generated variable name, no package implementation inspected"
knowledge-lookup card=why-E_INPUT lines=10
check=4 at=1789639560 command="npx snapback4 check --cost --residency" exit=0
process-start at=1789639560 pid=94681 port=53260 command="snapback4 dev --fresh --no-watch"
milestone=seed at=1789639567
seed-seconds=6.310
milestone=search at=1789639567
milestone=following at=1789639572
milestone=roster-unread at=1789639572
milestone=trending at=1789639572
green=1789639573
process-stop at=1789639573 pid=94681

Final serving decisions: search is a native 20-membership page with whole-chat matching collections and one cursor. Following merges up to the enforced 1024-follows cap. Unread stores a server-computed per-membership counter and maintains a per-principal sum. Trending now merges hourly rank lanes discovered by postHours; it no longer scans the global rank index. The 25-hour discovery bound follows from an inclusive UTC-hour interval spanning one day. Exact post-time predicates remove both boundary excesses. A dense boundary hour can still spend the query meter; the full fixed-seed acceptance stayed below it.

Rules and disclosure: posts has public reads at schema.q:55 and permissive updates at schema.q:57 so the like mutation can atomically change another author's rank. The only exposed normal update path is setLike through like; seed paths require dev:seed. postHours publicly reveals occupied hours and counts (schema.q:60-62). unreadTotals is readable only by its principal (schema.q:30-32). Members disclose their stored unreadCount under the roster membership rule (schema.q:11), although the roster output projects only principal. All tables are online-only; no device residency proof was attempted.

Anticipated limits: 4096 messages per room, 100 memberships per room and 1024 follows per principal are enforced schema choices. Twenty nested whole-chat scans can exceed the unchanged query meter for larger or broader-text data even below those individual caps. Such an incomplete query is not accepted. Batched imports can also abort atomically if fanout or combined scans exceed mutation ceilings; the supplied empty-server import order fits. The clock and write/read benchmarks are machine-specific, not performance guarantees.

Knowledge evidence qualification: initial card line entries were counted from the emitted saved card text, excluding trailing blank lines. Some combined tool responses were display-truncated, so those initial counts overstate lines demonstrably visible to the agent. The README was also initially display-truncated and then read in relevant ranges. These entries are preserved rather than silently presented as precise attention measurements; saved card content is in evidence/. Later why lookups were fully visible. Additional visible re-reads were README lines 360-820 (461 lines) and 820-1130 (311 lines), and reads lines 1-65 (65 lines). This is a procedural logging limitation, separate from server acceptance.
knowledge-lookup card=README-range-360-820 lines=461
knowledge-lookup card=README-range-820-1130 lines=311
knowledge-lookup card=reads-range-1-65 lines=65
search-protocol={"kind":"one-cursor","operations":["search"],"cursorArgs":["c"]}
following-shape={"kind":"merge-on-read"}
schema-shape={"workTables":["postHours","unreadTotals"],"perPrincipalCounterTables":["members","unreadTotals"],"auxiliaryOperations":["seedMessages","seedMembers","seedFollows","seedPosts","seedLikes"]}
derived-columns=[{"table":"members","column":"unreadCount"},{"table":"posts","column":"likes"},{"table":"posts","column":"negativeLikes"},{"table":"posts","column":"negativeAt"},{"table":"posts","column":"hourAt"},{"table":"unreadTotals","column":"id"},{"table":"unreadTotals","column":"principal"},{"table":"unreadTotals","column":"value"},{"table":"postHours","column":"id"},{"table":"postHours","column":"hourAt"},{"table":"postHours","column":"value"}]
task-lines={"search":[{"file":"snapback/schema.q","start":1,"end":28},{"file":"snapback/schema.q","start":73,"end":75},{"file":"snapback/schema.q","start":116,"end":138}],"following":[{"file":"snapback/schema.q","start":1,"end":1},{"file":"snapback/schema.q","start":34,"end":62},{"file":"snapback/schema.q","start":77,"end":80},{"file":"snapback/schema.q","start":95,"end":100},{"file":"snapback/schema.q","start":140,"end":156}],"rosterUnread":[{"file":"snapback/schema.q","start":1,"end":32},{"file":"snapback/schema.q","start":82,"end":86},{"file":"snapback/schema.q","start":116,"end":138}],"trending":[{"file":"snapback/schema.q","start":1,"end":1},{"file":"snapback/schema.q","start":43,"end":71},{"file":"snapback/schema.q","start":88,"end":114},{"file":"snapback/schema.q","start":148,"end":164}]}
finished=1789639703

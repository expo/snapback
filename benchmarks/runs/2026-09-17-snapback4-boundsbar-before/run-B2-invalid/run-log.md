start=1789657691
knowledge-lookup card=README lines=1657
note=CLI-launch-stalled-before-dyld-start; investigating-local-environment
note=Selected-one-cursor-membership-pages-with-nested-whole-chat-search; per-chat-read-bound-256-and-native-incompleteness-preserved
acceptance-start=1789658350 pid=36896 directory=/Users/ccheever/projects/snapback-boundsbar-before/runs-b/run-2/evidence/acceptance-1789658350391
check-start=1 command="npx snapback4 check --cost --residency" log=evidence/checks/001.log
loop=1 attribution=environment command="npx snapback4 guide" failure="CLI processes remain before dyld startup with zero application output" resolution="Tried direct published executable, exact-byte copy, explicit Node PATH, foreground TTY, signature verification; unresolved"
loop=2 attribution=agent-error command="import createClient from snapback4" failure="ERR_PACKAGE_PATH_NOT_EXPORTED" resolution="Use the public snapback4/client subpath; transport wire observed with a mock fetch"
knowledge-lookup card=README lines=401
knowledge-lookup card=README lines=181
knowledge-lookup card=README lines=282
knowledge-lookup card=README lines=102
knowledge-lookup card=language lines=0
knowledge-lookup card=language lines=0
knowledge-lookup card=language lines=0
knowledge-lookup card=language lines=0
knowledge-lookup card=search lines=0
knowledge-lookup card=language lines=0
knowledge-lookup card=language lines=0
knowledge-lookup card=language lines=0
knowledge-lookup card=language lines=0
knowledge-lookup card=language lines=0
note=Zero-line-guide-lookups-were-launch-attempts-with-no-content-returned; no-diagnostic-code-was-emitted-for-why
cleanup-at=1789658427 started-processes=[3375, 4370, 16785, 59722, 65762, 67939, 70353, 85503, 97774, 5250, 96377] signal=SIGKILL reason=stalled-before-startup
check=1 at=1789658427 command="npx snapback4 check --cost --residency" exit=null log=evidence/checks/001.log
acceptance-failure=1789658470 message="dev startup timeout: "
acceptance-cleanup=1789658470 pid=36896
check-status-correction=1 child-signal=SIGKILL shell-equivalent-exit=137 wrapper-exit=1 stdout-bytes=0 stderr-bytes=0
seed-seconds=0.000
note=Seed-was-not-started; zero-is-execution-time-not-a-successful-seed-measurement
search-protocol={"kind":"one-cursor","operations":["search"],"cursorArgs":["c"]}
following-shape={"kind":"merge-on-read"}
schema-shape={"workTables":[],"perPrincipalCounterTables":[],"auxiliaryOperations":["seedMembers","seedMessages","seedFollows","seedPosts","seedLikes"]}
derived-columns=[{"table":"roomCounts","column":"value"},{"table":"posts","column":"likes"},{"table":"posts","column":"negativeLikes"},{"table":"posts","column":"negativeAt"}]
task-lines={"search":[{"file":"snapback/schema.q","start":1,"end":24},{"file":"snapback/schema.q","start":98,"end":117},{"file":"snapback/schema.q","start":145,"end":147}],"following":[{"file":"snapback/schema.q","start":1,"end":1},{"file":"snapback/schema.q","start":30,"end":53},{"file":"snapback/schema.q","start":72,"end":75},{"file":"snapback/schema.q","start":80,"end":82},{"file":"snapback/schema.q","start":119,"end":135}],"rosterUnread":[{"file":"snapback/schema.q","start":1,"end":28},{"file":"snapback/schema.q","start":64,"end":70},{"file":"snapback/schema.q","start":98,"end":117}],"trending":[{"file":"snapback/schema.q","start":1,"end":1},{"file":"snapback/schema.q","start":39,"end":62},{"file":"snapback/schema.q","start":77,"end":96},{"file":"snapback/schema.q","start":127,"end":143}]}
milestone=first-check at=1789657999
end=1789658578
elapsed-seconds=887
result=unsuccessful-partial-environment-blocked

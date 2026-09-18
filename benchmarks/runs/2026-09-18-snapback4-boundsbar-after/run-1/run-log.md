start=1789719288
check=1 at=1789719418 command="npx snapback4 check --cost --residency" exit=0
milestone=first-check at=1789719418
knowledge-lookup card=search lines=242
knowledge-lookup card=language lines=508
knowledge-lookup card=reads lines=210
knowledge-lookup card=reads lines=65
knowledge-lookup card=personas lines=94
knowledge-lookup card=feeds lines=109
knowledge-lookup card=types lines=104
knowledge-lookup card=writes lines=255
loop=1 attribution=agent-error command="Node transport probe" failure="Guessed root package export, then a background server exited with its shell; bare mutation arguments returned E_INPUT" resolution="Use direct HTTP envelopes with args and keep server owned by the acceptance process"
acceptance-start at=1789719619 pid=7617 evidence=evidence/acceptance-1789719619914
milestone=seed at=1789719634
seed-seconds=14.127
milestone=search at=1789719637
milestone=following at=1789719655
milestone=roster-unread at=1789719658
milestone=trending at=1789719659
acceptance-pass at=1789719661 evidence=evidence/acceptance-1789719619914 seconds=41.173
knowledge-lookup card=index lines=2
knowledge-lookup card=personas lines=94
knowledge-lookup card=language lines=169
knowledge-lookup card=why-E_INPUT lines=10
loop=2 attribution=agent-error command="SNAPBACK_URL=http://127.0.0.1:4419 npm run seed:hub" failure="Probe server already contained one follow; seedMessages and seedMembers committed before seedFollows refused E_RULE for the duplicate" resolution="Acceptance always owns a fresh in-memory server. Failed probe seed elapsed was not instrumented; successful fresh seeds record precise duration. Probe process group 88320 stopped."
check=2 at=1789719690 command="npx snapback4 check --cost --residency" exit=0
failed-seed-wall-seconds=11.664 measurement="probe-seed.log creation to final stderr write; includes npm startup"
knowledge-lookup card=why-E_RULE lines=10
acceptance-start at=1789719738 pid=21298 evidence=evidence/acceptance-1789719738126
milestone=seed at=1789719750
seed-seconds=12.411
seed-status=complete at=1789719750
milestone=search at=1789719753
milestone=following at=1789719769
acceptance-failed at=1789719771 evidence=evidence/acceptance-1789719738126 failure="Missing expected rejection."
search-protocol={"kind":"one-cursor","operations":["search"],"cursorArgs":["c"]}
following-shape={"kind":"merge-on-read"}
schema-shape={"workTables":[],"perPrincipalCounterTables":["members","unreadTotals"],"auxiliaryOperations":["seedMessages","seedMembers","seedFollows","seedPosts","seedLikes"]}
derived-columns=[{"table":"members","column":"unread"},{"table":"unreadTotals","column":"value"},{"table":"posts","column":"negativeAt"},{"table":"posts","column":"negativeLikes"}]
task-lines={"search":[{"file":"snapback/schema.q","start":1,"end":27},{"file":"snapback/schema.q","start":59,"end":60},{"file":"snapback/schema.q","start":101,"end":121}],"following":[{"file":"snapback/schema.q","start":1,"end":1},{"file":"snapback/schema.q","start":29,"end":49},{"file":"snapback/schema.q","start":62,"end":65},{"file":"snapback/schema.q","start":78,"end":83},{"file":"snapback/schema.q","start":123,"end":139}],"rosterUnread":[{"file":"snapback/schema.q","start":1,"end":27},{"file":"snapback/schema.q","start":67,"end":71},{"file":"snapback/schema.q","start":101,"end":121}],"trending":[{"file":"snapback/schema.q","start":1,"end":1},{"file":"snapback/schema.q","start":36,"end":57},{"file":"snapback/schema.q","start":73,"end":99},{"file":"snapback/schema.q","start":131,"end":147}]}
loop=3 attribution=agent-error command="npm run acceptance" failure="New import-closure assertion failed: members[roomId] resolved to byId, not the room prefix" resolution="Name byRoomPrincipal explicitly in the closure existence probe; rerun check and full fresh acceptance"
check=3 at=1789719800 command="npx snapback4 check --cost --residency" exit=0
acceptance-start at=1789719801 pid=29158 evidence=evidence/acceptance-1789719801466
milestone=seed at=1789719814
seed-seconds=12.452
seed-status=complete at=1789719814
milestone=search at=1789719818
milestone=following at=1789719830
milestone=roster-unread at=1789719836
milestone=trending at=1789719836
acceptance-pass at=1789719837 evidence=evidence/acceptance-1789719801466 seconds=35.668
green=1789719897
acceptance-command="npm run acceptance" exit=0 evidence=evidence/acceptance-third.log

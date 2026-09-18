start=1789720000
knowledge-lookup card=README lines=1977
check=1 at=1789720121 command="npx snapback4 check --cost --residency" output=evidence/checks/001.log
check=1 exit=0
milestone=first-check at=1789720169
process=probe pid=75533 at=1789720170
acceptance-start=1789720270 evidence=evidence/acceptance-1789720270-86627
process=acceptance pid=86724 port=57952 at=1789720270
milestone=seed at=1789720296
seed-seconds=25.470
milestone=search at=1789720297
milestone=following at=1789720312
milestone=roster-unread at=1789720313
milestone=trending at=1789720313
acceptance-pass=1789720314 evidence=evidence/acceptance-1789720270-86627
green=1789720314
process-stopped=acceptance pid=86724 at=1789720314
knowledge-lookup card=guide lines=2
knowledge-lookup card=search lines=242
knowledge-lookup card=README lines=421 range=330-750
knowledge-lookup card=language lines=508
knowledge-lookup card=programs lines=89
knowledge-lookup card=personas lines=94
knowledge-lookup card=README lines=361 range=650-1010
knowledge-lookup card=language lines=220 range=1-220
knowledge-lookup card=feeds lines=63 method=rg
knowledge-lookup card=types lines=104
knowledge-lookup card=language lines=121 range=220-340
knowledge-lookup card=reads lines=274
knowledge-lookup card=why-N_MAINTAIN_DELTA lines=22
knowledge-lookup card=README lines=166 range=1010-1175
knowledge-lookup card=feeds lines=111 range=848-958
knowledge-note=The first full README and combined language/programs/personas output exceeded the tool display limit; their line counts record the requested reads. Subsequent explicit ranges above were displayed without truncation. Cards saved but not read in full are not counted as full reads.
process-stopped=probe pid=75533 at=1789720170
search-protocol={"kind":"one-cursor","operations":["search"],"cursorArgs":["c"]}
following-shape={"kind":"merge-on-read"}
schema-shape={"workTables":["messageCounts"],"perPrincipalCounterTables":[],"auxiliaryOperations":["importMember","importFollow","importMessages","importPosts","importLike"]}
derived-columns=[{"table":"messageCounts","column":"roomId"},{"table":"messageCounts","column":"value"},{"table":"posts","column":"negLikes"},{"table":"posts","column":"negAt"}]
task-lines={"search":[{"file":"snapback/schema.q","start":1,"end":27},{"file":"snapback/schema.q","start":59,"end":60},{"file":"snapback/schema.q","start":103,"end":107},{"file":"snapback/schema.q","start":114,"end":124}],"following":[{"file":"snapback/schema.q","start":1,"end":1},{"file":"snapback/schema.q","start":29,"end":49},{"file":"snapback/schema.q","start":62,"end":65},{"file":"snapback/schema.q","start":82,"end":87},{"file":"snapback/schema.q","start":109,"end":112},{"file":"snapback/schema.q","start":126,"end":134}],"rosterUnread":[{"file":"snapback/schema.q","start":1,"end":27},{"file":"snapback/schema.q","start":67,"end":75},{"file":"snapback/schema.q","start":103,"end":107},{"file":"snapback/schema.q","start":114,"end":124}],"trending":[{"file":"snapback/schema.q","start":1,"end":1},{"file":"snapback/schema.q","start":36,"end":57},{"file":"snapback/schema.q","start":77,"end":101},{"file":"snapback/schema.q","start":126,"end":138}]}

Implementation: server-only Quarry, with no sync or acquisition horizon. Search pages 20 matching memberships and emits the complete descending matching collection for each chat. The room cap is 512 messages and the nested collection bound is also 512; writes beyond that cap refuse. The returned outer shape owns continuation and native complete/cut metadata remains intact. Following opens one indexed lane per follow; post writes do not fan out to followers. Unread sums engine-maintained room counts minus readOrdinal. Imports enforce contiguous ordinals starting at one, and no operation deletes messages. Trending merges 25 hourly rank lanes, with exact time filtering and transactional negative-like counts stored on posts; negative time makes time descending while key stays ascending. Zero-like posts use the same index. No client computes a product answer.

Bounds and authority: one default-ceiling check passed, with the N_MAINTAIN_DELTA note. No failing correction cycles occurred. No meter cuts occurred in the accepted fixed-seed walks. Search can encounter the search word limit or heap/meter limits for larger bodies or groups; whole-chat materialization has to fit one read. Following can encounter an opening cut for far more follows; unread has no continuation if the membership total exceeds its read meter. Trending can spend its meter rejecting rows in a crowded boundary hour. Queries retain truthful metadata in those cases. posts has public read and permissive update authority; only declared post/like/import helpers write its rank columns, and no mutation accepts a caller-chosen score. messageCounts is an engine-owned work table, not a per-principal counter. No application work queue, schedule, job, recipe inbox, native code, SQL or backend wrapper is used.
knowledge-lookup card=why-N_MAINTAIN_DELTA lines=22
milestone=report at=1789720482

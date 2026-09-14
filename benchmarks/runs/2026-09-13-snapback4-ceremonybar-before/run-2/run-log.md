start=1789361897
1789361897 milestone=start reading packet
1789361897 loop=1 attribution=agent-error command=initial timestamp command wrote /tmp/unused-ceremony-time outside current directory; resolution=all subsequent work confined to current directory
1789361897 lookup source=package README node_modules/snapback4/README.md
1789361987 lookup source=package guide language, reads, bounds, effects, search; milestone=packet green; milestone=schema start
1789362011 lookup source=why N_NEVER_COMPLETE and generated api.ts
1789362011 loop=2 attribution=agent-error command=npx snapback4 check produced N_NEVER_COMPLETE; resolution=separate userChats audience from members recipient access
1789362140 milestone=schema green check no problems or notes; milestone=seed and acceptance implementation start
1789362140 lookup source=package README wire, development lifecycle and effects; milestone=acceptance first run start
1789362154 milestone=seed green; milestone=baseline query assertions green
1789362154 loop=3 attribution=docs command=npm run acceptance failed ByteString token header; lookup source=diagnostic token CLI output; resolution=parse final token output line rather than prose plus token
1789362176 loop=4 attribution=agent-error command=acceptance lifecycle code review found cleanup timeout would fire after normal exit; resolution=clear kill timeout once owned child closes; added no-recipient read assertion
1789362186 loop=5 attribution=agent-error command=npm run acceptance failed ByteString again; resolution=extract opaque token by token alphabet because merged stdout and stderr order varies
1789362186 milestone=acceptance restart and schedule retry start
schema-shape={"workTables":[],"perPrincipalCounterTables":[],"auxiliaryOperations":[]}
Schema choices: profiles hold explicit activity; posts hold original/reply/repost facts and validated original targets; likes hold viewer-owned facts and immutable-through-API author/kind projections; follows hold graph edges. likeCounts is an engine maintain grouped by post, world-readable because both posts and likes are public social facts; it is not a per-principal counter. Insights uses bounded indexed pages and conditional sums, seven clock-derived UTC buckets, and lifetime counts. Trending sorts eligible originals by maintained likes, creation time and logical key, then slices by the number of eligible rows.
Chats and members hold membership and admin authority. userChats is an atomically maintained second representation of membership, consumed directly by search and digest; its viewer-only rule makes the principal scan complete while members has a chat-scoped rule for complete recipient scans. Messages use the actual words index for every-term word-prefix search. Acknowledgments hold per-message recipient facts; reads imply delivery and cannot be downgraded. Receipt state sums only current recipients. The digest job sums per-message unread indicators across current chats for active profiles. digestPeriods is a durable emission ledger, keyed by principal and both period endpoints, committed atomically with the real effect. It is a domain fact proving a period was emitted, not temporary work or an accumulator. It persists across restarts and is never cleared or read back to compute counts. There are no scratch tables, per-principal counters, or auxiliary operations. Additional mutations (profile, post, follow, createChat, addMember) are ordinary authorized domain writes used by the seed.
All reads are online. Pages are bounded at 200 social facts/messages, 100 viewer chats/search hits and 20 recipients, comfortably above this seed; ceilings are unchanged. Larger datasets would need pagination or a different aggregate design and can report incomplete. No client computes application answers; it only produces seed inputs, transports operations, checks expected results, and claims/observes/settles emitted effects.
1789362223 lookup source=generated api.ts updated contract; milestone=digest deterministic periods restart and worker settlement green; milestone=real scheduled boundary wait start
1789362240 milestone=real scheduled boundary green periodEnd=1789362240000; milestone=receipt mutation authorization and dynamic probes start
1789362281 milestone=receipt mutation authorization and dynamic probes green; milestone=acceptance green exit=0 copy=.acceptance-3iGyJ5; milestone=final check green no problems or notes
1789362281 milestone=record green schema-shape and final-report.md complete
green=1789362281

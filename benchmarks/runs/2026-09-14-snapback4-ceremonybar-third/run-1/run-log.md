start=1789384294
1789384294 milestone=packet start
1789384294 lookup=package-README
1789384443 milestone=schema start lookup=package-README language/search/jobs/effects
1789384459 milestone=schema green lookup=package-guide jobs/search/effects;lookup=diagnostic check;lookup=why N_NO_CURSOR;lookup=generated-api
1789384608 milestone=seed-and-acceptance start
schema-shape={"workTables":["digestPeriods"],"perPrincipalCounterTables":[],"auxiliaryOperations":[]}
Schema choices: posts, likes and follows are public social domain facts. likeCounts is a per-post maintain, world-readable because likes and posts are public and ranking exposes these counts. No per-principal counters are stored or made world-readable. Insights uses local scalar accumulators and a seven-item local list; trending sorts a shaped bounded candidate page. Membership-scoped words indexes perform search and the membership index supplies ordered chat groups. Receipts hold individual monotone acknowledgment facts, and current memberships determine aggregate receipt state and digest unread counts. digestPeriods is conservatively listed as a work table because only digest reads its writes: it holds durable per-user/per-period emission receipts, atomically committed with the effect, and is essential for restart-safe duplicate suppression. It contains no counters. There are no helper-only operations; profile, post, follow, createChat and addMember are ordinary domain commands used to install the seed.
1789384658 lookup=model-knowledge Node built-in HTTP, process lifecycle, assertions and filesystem APIs for headless harness
1789384658 lookup=environment CLI process metadata after slow initial guide launch; all guide calls subsequently returned successfully without intervention
1789384658 loop=1 attribution=agent-error failed-command="ls node_modules/snapback4-darwin-arm64/bin" resolution="Platform executable is at package root; used the documented CLI, without reading implementation files."
1789384608 milestone=acceptance start copy=/Users/ccheever/projects/snapback-ceremony-third/runs/run-1/.acceptance/run-bkiZiq
1789384609 milestone=server start owned PID=67232 port=56577
1789384609 milestone=seed green
1789384609 milestone=five initial query values green
1789384610 milestone=server start owned PID=67713 port=56577
1789384611 milestone=server start owned PID=68000 port=56577
1789384612 milestone=server start owned PID=68217 port=56577
1789384612 milestone=durable digest duplicate/restart/next-period and real worker green
1789384612 milestone=live ranking/search/receipts/membership and authority green
1789384613 milestone=server start owned PID=68473 port=56577
1789384613 milestone=waiting for actual scheduled boundary 2026-09-14T11:18:00.000Z
1789384681 milestone=actual two-minute schedule green
1789384683 milestone=server start owned PID=79171 port=56577
1789384683 milestone=acceptance green
1789384710 milestone=proof-record green check/HTTP-seed/acceptance/schema-shape verified; no schema correction loops
green=1789384710

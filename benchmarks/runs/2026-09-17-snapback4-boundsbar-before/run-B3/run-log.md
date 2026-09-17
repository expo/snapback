start=1789659207
check-start=1789659419 command="npx snapback4 check --cost --residency" output="evidence/checks/001.log"
CLI startup observation: npx guide, direct installed CLI guide, and direct published platform binary guide have produced no output after several minutes. No package implementation was read or changed. A byte-identical executable copy under evidence was also attempted to distinguish path-related launch trouble; it likewise waits. This is unresolved, not yet attributed as a package defect.
check-end=1789659743 exit=1 signal=null
startup-diagnostic at=1789659733: sampled only our direct CLI process (PID 59405). Its entire sampled stack is _dyld_start +0; physical footprint 96K. This supports an environment-level executable-launch stall before application startup. Evidence: evidence/launch-sample.txt. No compiler diagnostic has been produced yet.
milestone=first-check at=1789659780
loop=1 attribution=agent-error command="npx snapback4 check --cost --residency" failure="merge lane selector used a local page variable; parser requires a bounded range read" resolution="inline the membership range as documented on search card"
knowledge-lookup card=search lines=320
knowledge-lookup card=personas lines=94
knowledge-lookup card=reads lines=208
knowledge-lookup card=writes lines=255
knowledge-lookup card=cli lines=3
knowledge-lookup card=language lines=449
knowledge-lookup card=E_QUARRY_SYNTAX lines=13
CLI recovered around 1789659780; launch stall consumed roughly nine minutes. The sampled executable reached normal operation without changing the installed package.
check-start=1789659799 command="npx snapback4 check --cost --residency" output="evidence/checks/002.log"
check-end=1789659800 exit=1 signal=null
loop=2 attribution=agent-error command="npx snapback4 check --cost --residency" failure="int minus time is not a matching numeric operation" resolution="convert timestamp to integer milliseconds by division before negating the stored ranking key"
check-start=1789659809 command="npx snapback4 check --cost --residency" output="evidence/checks/003.log"
check-end=1789659810 exit=0 signal=null
probe-server-start at=1789659860 command="npx snapback4 dev --port 4483 --fresh --no-watch" background-pid=23221 outcome="shell background did not remain serving; foreground tool session started instead"
loop=3 attribution=agent-error command="node transport probe" failure="guessed snapback4 root export for mintId is not exported" resolution="transport now generates valid 128-bit Crockford IDs per the writes card; direct q/m smoke test passed"
acceptance-start=1789659862 pid=29700 cwd="/Users/ccheever/projects/snapback-boundsbar-before/runs-b/run-3/evidence/acceptance/fresh-MRZGTZ" command="npx snapback4 dev --port 56265"
milestone=seed at=1789659918
seed-seconds=55.122
knowledge-lookup card=shapes lines=36
loop=4 attribution=agent-error command="transport q probe / npm run acceptance" failure="query wire body requires args envelope; scalar empty-argument probe had concealed the mistake" resolution="send {args} on q requests and reject native denied envelopes"
loop=5 attribution=agent-error command="searchBatch runtime probe" failure="group(matches) consumes the page and loses its cursor owner: complete false and next null" resolution="return grouped rows with a separately returned projection of the same native page to retain its continuation ownership"
check-start=1789659954 command="npx snapback4 check --cost --residency" output="evidence/checks/004.log"
check-end=1789659956 exit=0 signal=null
acceptance-failed=1789659967 error="fetch failed"
acceptance-001 stopped its recorded server process group 29700 after seed completed: old in-memory transport ignored query arguments and therefore repeated the first membership batch. Seed took 55.122 seconds. Corrected transport will run in a fresh process.
acceptance-start=1789660010 pid=49631 cwd="/Users/ccheever/projects/snapback-boundsbar-before/runs-b/run-3/evidence/acceptance/fresh-bq0pDz" command="npx snapback4 dev --port 58700"
milestone=seed at=1789660030
seed-seconds=19.050
milestone=search at=1789660047
Search cursor probe succeeded after returning {rows: grouped fragments, continuation: matches {}}. The empty projection retains the native page owner while all message content is grouped on the server. Both the first and second pages had complete=true, native next, and descending fragments; no metadata is manufactured or overridden.
timing-correction: the first check invocation began at 1789659419 and ended at 1789659743 (see preserved check-start/check-end). The milestone at 1789659780 records when its output had been inspected, not invocation time.
milestone=following at=1789660059
milestone=roster-unread at=1789660059
milestone=trending at=1789660059
green=1789660059
acceptance-start=1789660121 pid=64677 cwd="/Users/ccheever/projects/snapback-boundsbar-before/runs-b/run-3/evidence/acceptance/fresh-btxvyu" command="npx snapback4 dev --port 60041 --fresh --no-watch"
milestone=seed at=1789660144
seed-seconds=20.409
milestone=search at=1789660160
milestone=following at=1789660170
milestone=roster-unread at=1789660170
milestone=trending at=1789660170
green=1789660171
search-protocol={"kind":"two-cursor","operations":["chats","searchBatch"],"cursorArgs":["batch","c"]}
following-shape={"kind":"merge-on-read"}
schema-shape={"workTables":["roomCounts"],"perPrincipalCounterTables":[],"auxiliaryOperations":["seedMember","seedMessage","seedMessages","seedFollow","seedPost","seedPosts","seedLike"]}
derived-columns=[{"table":"roomCounts","column":"value"},{"table":"posts","column":"likes"},{"table":"posts","column":"rankLikes"},{"table":"posts","column":"rankAt"}]
task-lines={"search":[{"file":"snapback/schema.q","start":1,"end":23},{"file":"snapback/schema.q","start":96,"end":104},{"file":"snapback/schema.q","start":120,"end":139}],"following":[{"file":"snapback/schema.q","start":1,"end":1},{"file":"snapback/schema.q","start":29,"end":51},{"file":"snapback/schema.q","start":70,"end":73},{"file":"snapback/schema.q","start":78,"end":80},{"file":"snapback/schema.q","start":106,"end":114},{"file":"snapback/schema.q","start":141,"end":151}],"rosterUnread":[{"file":"snapback/schema.q","start":1,"end":27},{"file":"snapback/schema.q","start":62,"end":68},{"file":"snapback/schema.q","start":96,"end":104},{"file":"snapback/schema.q","start":128,"end":139}],"trending":[{"file":"snapback/schema.q","start":1,"end":1},{"file":"snapback/schema.q","start":37,"end":60},{"file":"snapback/schema.q","start":75,"end":94},{"file":"snapback/schema.q","start":111,"end":118},{"file":"snapback/schema.q","start":141,"end":151}]}
cleanup=1789660216 removed-own-store="evidence/acceptance/fresh-MRZGTZ/.snapback4"
cleanup=1789660216 removed-own-store="evidence/acceptance/fresh-bq0pDz/.snapback4"
note=1789660216 optional native meter sampling was attempted after the final acceptance had already stopped its server; connection was refused and no sample was claimed. Existing acceptance evidence remains successful.
cleanup=1789660217 stopped-own-probe-pid=46210 port=4483
knowledge-lookup card=index lines=2
final-narrative: two full fresh-server acceptances passed. Final seed 20.409 seconds, final acceptance about 50 seconds, final green 964 seconds after start. Compiler notes N_WIDE_MERGE and N_SPARSE_FILTER remain. The 4096 selector ranges, 8192 examined-row ceiling, 32-word expansion bound, and out-of-window ranking scans limit extrapolation beyond the tested population. Details and retained failures are in final-report.md.

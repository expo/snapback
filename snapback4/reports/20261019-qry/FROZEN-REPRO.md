# Frozen query-branch evidence

Read-only sources: wave18 bakeoff.md (all sections), friction.all.jsonl and
.agent.ndjson for lanes 009, 032 and 048; wave17 day-two analysis skimmed.
The finished app sources contain workarounds, so the 200-schema survey alone
cannot detect the pre-workaround runtime defect.

The original caskList body was recovered from lane 009's command transcript,
compiled with its full frozen schema in an owned temporary Rust witness and
seeded with one staff-role row and one cask. Before the fix, staff received
`data: [], complete:false`, with only staffRoles in read dependencies: no cask
page opened. After the fix, staff and owner both received that one cask with
`complete:true`. The portable detecting regression is query_read_paths.rs
(4 role probes × cap 1000): sum 10,010 versus maximum 5,005 under 8,192.

Both original bodies contain an explicit fallback return. Therefore a
missing-return check by itself would not repair these failures. Recovered
032 myChallenges likewise has staff/captain and caller branches, initially
ordered by issuedAt and then by id; 048 queue has a host branch and an asserted
roster/fixer fallback. Each of their target tables has cap 2,000 and two rule
probes: the static bounded-lane price is (2000+1)×(1+2)=6,003, and summing
both alternatives exceeds 8,192. These latter figures are source-level
reservation analysis, not a claim that those two complete applications were
independently executed here. The runtime regressions exercise the same
reservation law for indexed time order, role alternatives, fallback returns,
condition-expression work, loops, hidden populations and real meter cuts.

Hidden-lookup clusters: 015/019/027/037/045 expect later semantic errors after
an asserted hidden lookup; the ladder intentionally preserves authored
assertion precedence. Lane 025 defaults a caller-hidden funding lookup and
reports NEEDS_APPROVAL; the optional-side-table note now names that read rule.
Lane 029's program exists guard is caller-filtered; rule exists is a separate
raw witness mechanism. Lane 032's upsert insert denial retains NOT_FOUND to
avoid exposing hidden existence. No public refusal is changed to name a
runtime hiding clause. Source-only notes and local why traces provide detail.

SEC4 owns invariant/escalation/security-note work. DX4 owns provisioning,
staging, uploads, clock/session and setup/proof ergonomics. Those clusters
were not modified in this lane.

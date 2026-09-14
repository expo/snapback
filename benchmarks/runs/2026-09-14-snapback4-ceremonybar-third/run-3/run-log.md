start=1789385530
1789385530 milestone=documentation start
1789385530 lookup source=package README/guide read README
1789385712 milestone=schema-and-client start
1789385712 lookup source=package README/guide programs, jobs, search, effects, wire
1789385722 milestone=documentation green
1789385722 milestone=schema-check green no problems
1789385722 lookup source=why N_NO_CURSOR and generated api.ts
1789385722 milestone=acceptance start
1789385845 loop=1 attribution=agent-error command=npm-run-acceptance failed because job helper parameter start shadowed server start function; resolved by renaming parameters periodStart and periodEnd
1789385845 milestone=seed green through HTTP mutations
1789385845 milestone=initial-shapes green exact values and authorization refusals
schema-shape={"workTables":["digestPeriods"],"perPrincipalCounterTables":[],"auxiliaryOperations":[]}
Schema choices: profiles, posts, likes, follows, chats, members, messages and acknowledgements hold domain facts. Logical string keys are indexed independently of minted IDs. Queries use bounded indexed reads, local scalar/list aggregation, UTC arithmetic, sorting and scoped words indexes. No maintains or per-principal counters exist, and no counter is world-readable. Public social facts are readable to signed-in viewers; chat facts require current membership.
The digestPeriods table is conservatively listed as a work table because only digest reads its durable per-principal/period emission ledger. It survives restarts and is atomically committed with the effect, preventing repeated emissions. It contains no accumulator counts. There are no auxiliary operations: profile, post, follow, createChat and addMember are ordinary domain creation operations also used by seed; all other operations implement the requested wire contract.
1789385892 milestone=restart-dedup start
1789385892 milestone=restart-dedup green identical period emitted no additional effects after server restart
1789385892 milestone=next-period start
1789385892 milestone=next-period green three real effects claimed and settled
1789385892 milestone=scheduled-boundary start awaiting next two-minute wall-clock boundary
1789385930 milestone=scheduled-boundary green observed actual 2026-09-14T11:38:00Z schedule via claimed effects
1789385930 milestone=positive-changes green receipt transitions, per-message unread, membership, messages, ranking and zero effects
1789385930 milestone=schema-and-client green
1789385930 milestone=acceptance green fresh persistent-copy proof retained at .acceptance-0FBfOT
1789385930 milestone=final-report green all four proofs complete; owned server closed in finally
green=1789385930

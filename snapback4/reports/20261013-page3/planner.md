# PAGE3 planner qualification

The before survey reproduces PAGE2's 18 notes in 11 schemas. All 50 odd final
wave-10 schemas were copied before checking; no check ran in the original farm.
Final source copies are /tmp/sb4-page3-farm. The current release CLI checks all
50 successfully. Machine-readable provenance, hashes, per-app outcomes and
exact remaining messages are in farm-survey.json.

| Shape | Before | Unmodified-source after | After exact copy repair |
|---|---:|---:|---:|
| Party plus static role grant | 12 | 0 | 0 |
| Compound, non-equality, multi-branch | 3 | 0 | 0 |
| Hidden parent source | 2 | 2 | 0 |
| Pure membership | 1 | 0 | 0 |
| Total notes | 18 | 2 | 0 |
| Schemas with a note | 11 | 1 | 0 |

Both remaining notes are 033-airline-miles-pooling: poolProposals and
poolMembers. The generic inversion cannot certify absence: a pool may have
owner Alice but only Bob's membership, so Alice cannot read the pool source
row even though its physical owner witness can authorize Alice's child rows.
Discovering only readable owner pools would miss those authorized children;
certifying that discovered subset complete is unsound. A cap or index cannot
repair that unreadable-source proof.

The exact alternative is hidden-parent-rewrite.q. It adds immutable poolOwner
copies, preserves the already immutable pool references and default restrict
deletions, checks copies against pools.owner in insert rules, and fills new
proposal payloads from a non-null readable pool binding. Existing members and
proposals must be backfilled from their parents before adoption, and trusted
seeds must fill the field. The parent owner is immutable and non-expiring.
Neither parent privacy nor original child reader membership is widened. The
new column is a schema change; the original farm is untouched.

A second complete 50-schema copied corpus, /tmp/sb4-page3-rewrite-farm, applies
that rewrite to 033 only. Every schema compiles and all 50 have zero
N_NEVER_COMPLETE notes. The aggregate records each rewritten source and output
hash, not just the repaired schema's aggregate count.

Reproduction (each binary operates on copies):

```sh
cd /tmp/sb4-page3-farm/NNN-app
/home/ccheever/projects/sb4-w10-page3/snapback4/target/release/snapback4 check --json
```

The raw before/after compiler outputs stay at /tmp/sb4-page3-before-outputs
and /tmp/sb4-page3-after-outputs; their SHA-256 values are retained in the
aggregate. Input digest recipe is sorted relative path, TAB, file SHA-256, LF.
Baseline binary is /tmp/sb4-page3-baseline, retained from setup; it reproduces
PAGE2's exact note identities/counts. See the preserved PAGE2 report for its
original baseline and qualification history.

Completeness is a bounded request verdict. Large membership discovery or an
unfinished target head set stays empty/incomplete without a cursor; ordinary
read cuts can retain only a proved ordered frontier. Explicit role-holder pages
need no whole-table cap. Implicit whole-group reads retain a real cap/total
unique over the original fixed prefix; a cap by owner is not a staff bound.
No product or runtime ceiling increased.

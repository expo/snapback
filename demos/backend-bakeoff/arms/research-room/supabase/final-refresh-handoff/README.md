# Research Room / Supabase Stage 5 refresh — stopped

This additive handoff records the required
`@supabase/supabase-js@2.111.0` refresh attempt at frozen source
`4e5da63c33064082c73359f0ee02efcd11e360ff`. It does not overwrite the sealed
capsule or earlier 2.57.4 evidence.

The fresh isolated Docker target started successfully and was healthy. Before
any acceptance scenario ran, a builder redaction expression failed while
inspecting the CLI's ANSI credential table and emitted fresh local credential
values into tool output. LLP 0102 classifies any secret exposure as Stop-class,
so metric work stopped immediately.

Containment completed:

- exact project `llp0102-final-research-supabase-w1` stopped without backup;
- zero project containers, volumes, or networks remain;
- owner-only credential carriers were destroyed;
- ports 58104-58111 and 43115 are closed;
- no acceptance or performance result is claimed for 2.111.0.

The original builder Stop lineage is retained in
`prior-builder-stop-lineage.v1.json`. Earlier 2.57.4 acceptance, performance,
and cleanup are retained only as lineage and are not relabeled as 2.111.0
evidence.


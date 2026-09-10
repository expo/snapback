# Migrations: `successor`, `migration`

`check` validates sources and refreshes compiled facts; it does not install a
successor into the running owner. `dev --status --json` identifies the installed
generation and pending migration. Keep serving the old generation while a
successor refuses; do not mistake a passing check for installed code.

For a destructive change, the owner reports `migrationFile` and `applyCommand`.
Inspect that saved plan, then run the exact emitted command, which uses
`dev --apply-migration <file>`. No `--apply` or `--migration` alias exists.
Index removal/replacement, maintain regrouping and column retyping can be
destructive. Changing a maintain key is an index change even when its count
expression is unchanged.

## Preserve existing values

Adding a required populated column needs three steps: declare it optional,
apply; fill it through a bounded operator job; make it required and apply.
Update `seed.ts` in the first step too. Seeds are checked before stored rows,
but editing seeds cannot backfill a populated store. `guide job` gives the
executable fill fixture and resume/plan commands. `E_SUCCESSOR_NARROWING`
reports remaining nulls, counts and sample ids; finish the fill before narrowing.

Adding an enum case currently counts as a type change. Making the retyped
column optional may permit the successor while clearing old values to null;
that is not a preservation migration. Prefer an additive optional column with
the expanded enum, keep the old column intact, and deploy reads that fall back
to the old value while a bounded job maps old cases to new ones. Verify stored
row counts and old/new values through the system seat, then switch reads and
narrow the new column. Remove the old column only after the preserved data and
all readers have moved. A new optional logical-kind column can avoid retyping
an old discriminator altogether.

Jobs sweep immutable, total indexes. Pick an existing immutable cursor key
that the fill does not modify; do not scan by the column being filled. Do not
rewrite an immutable old column to simulate a migration. Keep the old and new
indexes needed by both readers until the switch is complete. `run <job> --as
system --plan` shows scope, `--dry-run` rehearses on a discarded snapshot,
`--wait` waits for completion, and `run --resume <job_id> --as system` resumes
a parked job. Bounded chunks are resumable work, not one unbounded mutation.

A changed enum or maintain layout is an authoring/data migration decision;
this card does not promise uninterrupted availability through destructive
intermediate generations. Use `guide operator`, `guide job`, and an app journey
that compares stored values before and after the chosen sequence.

## Custody logs

A `deliver` line installs its log empty; `bootstrap` fills it once from
current members, within 8,192 events per installation (Σ cap × rows over the
logs it bootstraps; above it E_SUCCESSOR_BOOTSTRAP: drop the word, and readers
reach prior history through the content table under its rule). Removing or
retargeting the line is a destructive plan. The audience bound `A` is
engine-recorded, never spelled: max(cap, largest stored audience), recomputed
at each installation and shown in the manifest; lowering the cap is admitted,
and history keeps its pricing until those rows are gone.

# Successors: `migrations`, `migration`

`check` compiles and certifies; it does not install. On save, `dev` installs a
successor transactionally. A refusal keeps the old generation and all its data.
`dev --status --json` shows the active generation, refusal, and last successful
`successor` report; `.snapback/log.jsonl` records applications and refusals.
Reports compare `from` and `to`; refusal sites identify the declaration.

## Additive changes preserve values

- Add tables, optional columns, indexes, programs, or rules; raise caps.
  New unique indexes still check existing keys; lowered caps check stored groups.
- Add or reorder enum cases. Removing cases is checked narrowing: zero affected
  rows admits, otherwise `E_SUCCESSOR_NARROWING` refuses. The report records
  removed cases and affected-row counts, including zero, with at most ten IDs.
- Raise `text`, `json`, `bytes`, `image`, `video`, or list bounds; change `T` to
  `T?`. Widening composes through `Optional` and lists, without rewriting rows.
  Text minimum and `format` changes apply to later writes; stored rows are not
  revalidated against those constraints, even when the constraint tightens.
- Add image `once`; removing it is destructive. Scale or currency changes for
  decimal/money and smaller type bounds are destructive.
- Replace a count/sum maintain's grouping, kind, or source: the engine replaces
  exactly the union of predecessor/successor projected IDs. Other rows survive;
  destructive changes affecting those survivors still need a plan. Removing the
  whole target table needs a plan. Jobs cannot write maintained targets.

A positional read such as `counts[viewer]` can compile after regrouping while
meaning something different. The log and status report say, for example,
`maintain counts: by sender → by recipient`. Check refuses only provable missing
names, incompatible types, or missing indexes; review each regroup's readers.

## Checked narrowing and repair

A new required column on populated rows refuses `E_SUCCESSOR_COLUMN_REQUIRED`.
For outer `T?` → `T`, absence counts as null. Keep it optional and apply; add a
job in `snapback/admin.q`, run it, then make the column required and apply:

```q
job fillAvatars():
  chunk p in profiles first 100 by byId:
    update profiles[p.id] { avatarUrl: p.avatarUrl ?? 'https://cdn.example.com/default.png' }
```

Run `snapback2 run fillAvatars --as system --plan`, then `--wait`. `guide job`
covers resume and rehearsal. Update `seed.ts` too; seeds are checked before
stored rows, and edits to seeds cannot backfill existing rows. The refusal
pastes a typed fill job.

Enum removals check values inside optional/list wrappers too. Keep the
predecessor schema and run the pasted job: for a scalar enum it deletes every
row holding a removed case (edit it to map instead); for list-wrapped enums it
deletes the ten sampled rows, so rerun until the count is zero. No case is ever
substituted. Mixed widening/narrowing still runs uniqueness, cap, address and
reference checks. A queued write carrying a removed case keeps its bytes: resume
resets, its replay refuses `E_INPUT` without spending the intent, and it commits
if the case returns.

## Destructive plans

Dropping tables/columns/indexes or incompatible retypes produces a plan such as
`{ "drops": [{ "kind": "column", "table": "messages", "name": "body" }] }`.
Retypes clear the old column values; preserve them with a new optional column,
a bounded mapping job, and changed readers before dropping the old column.

```sh
snapback2 dev --status --json
# Inspect the refusal's migrationFile and its saved plan/project.
# Replace GENERATION with that exact generation; keep the owner running.
snapback2 dev --apply-migration .snapback/migration-GENERATION.json
snapback2 dev --status --json
```

Use the refusal's `applyCommand` from any directory; relative plan paths resolve
from the working directory. Success means ready with the plan's generation; any
failure rolls back rows, indexes, generation metadata and timers together.

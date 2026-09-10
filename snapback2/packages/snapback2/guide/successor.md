# Successors: `migrations`, `migration`

`check` compiles and certifies but never installs. On save, `dev` installs a
successor transactionally. A refusal keeps the old generation and its data.
`dev --status --json` shows the active generation, refusal, and last `successor`
report; `.snapback/log.jsonl` records applications and refusals.
Reports carry `from`/`to`; refusal sites name the declaration.

## Additive changes preserve values

- Add tables, optional columns, indexes, programs, or rules; raise caps.
  New unique indexes check existing keys; lowered caps check stored groups.
- Add or reorder enum cases. Removing cases, or lowering a `text`, `bytes`, or
  list maximum, is checked narrowing: zero affected rows admits, otherwise
  `E_SUCCESSOR_NARROWING` refuses. The report records removed cases and null,
  oversize and affected-row counts, including zero, with at most ten IDs.
- Raise `text`, `json`, `bytes`, `image`, `video`, or list bounds; change `T` to
  `T?`. Widening composes through `Optional` and lists without rewriting rows.
  Text minimum and `format` changes apply to later writes only; stored rows are
  not revalidated, even when a constraint tightens.
- Add image `once`; removing it is destructive. Scale or currency changes for
  decimal/money and smaller `json`, `image`, or `video` bounds are destructive.
- Replace a count/sum maintain's grouping, kind, or source: the engine replaces
  exactly the union of predecessor/successor projected IDs. Other rows survive,
  and destructive changes to them or removing the whole target table need a
  plan. Jobs cannot write maintained targets.

A positional read such as `counts[viewer]` can compile after a regroup with its
meaning changed. The log and status report say, for example, `maintain counts:
by sender → by recipient`; check refuses only provable missing names,
incompatible types, or missing indexes, so review each regroup's readers.

## Checked narrowing and repair

A new required column on populated rows refuses `E_SUCCESSOR_COLUMN_REQUIRED`.
For outer `T?` → `T`, absence counts as null. Keep it optional and apply; add a
job in `snapback/admin.q`, run it, then require the column and apply:

```q
job fillAvatars():
  chunk p in profiles first 100 by byId:
    update profiles[p.id] { avatarUrl: p.avatarUrl ?? 'https://cdn.example.com/default.png' }
```

Run `snapback2 run fillAvatars --as system --plan`, then `--wait` (`guide job`:
resume, rehearsal). Update `seed.ts` too: seeds are checked before stored rows
and never backfill them. The refusal pastes a typed fill job.

Narrowing checks inside optional/list wrappers. Keep the predecessor schema
and run the pasted job, one whole-table sweep: it deletes rows holding a
removed case or over-long list, truncates over-long text with `slice`, and
fills nulls from its argument when the column also becomes required.
Values inside lists and `bytes` cannot be one sweep: that job deletes ten
sampled rows; rerun until the remaining count is zero. No case is ever substituted. Mixed
widening/narrowing still runs uniqueness, cap, address and reference checks. A
queued write carrying a removed case keeps its bytes: resume resets, replay
refuses `E_INPUT` unspent, `outbox.status().blocked` names it, `dismiss` returns
its bytes and the queue continues (`guide offline`); it commits if the case
returns.

## Destructive plans

Dropping tables/columns/indexes or incompatible retypes produces a plan such as
`{ "drops": [{ "kind": "column", "table": "messages", "name": "body" }] }`.
Retypes clear old values: preserve them with a new optional column, a mapping
job, and changed readers first.

```sh
snapback2 dev --status --json
# Review the refusal's migrationFile (plan and project); keep the owner running.
snapback2 dev --apply-migration .snapback/migration-GENERATION.json
snapback2 dev --status --json
```

Or use the refusal's `applyCommand` (relative plan paths resolve from the
working directory). Success is ready at the plan's generation; any failure rolls
back rows, indexes, generation metadata and timers together.

# Successors: `migrations`, `migration`

`check` certifies; on save, `dev` installs transactionally. Refusal keeps the
old generation and data. `dev --status --json` shows the generation, refusal,
and last `successor` report; `.snapback/log.jsonl` records them too.
Reports carry `from`/`to`; refusal sites name the declaration.

## Additive changes preserve values

- Add tables, optional columns, indexes, programs, or rules; raise caps.
  New unique indexes check existing keys; lowered caps check stored groups.
- Add or reorder enum cases. Removing cases, or lowering a `text`, `bytes`, or
  list maximum, is checked narrowing: zero affected rows admits, otherwise
  `E_SUCCESSOR_NARROWING` refuses. The report records removed cases and null,
  oversize and affected-row counts, including zero, with at most ten IDs.
- Raise `text`, `json`, `bytes`, `image`, `video`, or list bounds; change `T` to
  `T?`. Widening composes through optional/list wrappers.
  Text minimum and `format` changes affect later writes; stored rows are not revalidated.
- Add image `once`; removing it is destructive. Scale or currency changes for
  decimal/money and smaller `json`, `image`, or `video` bounds are destructive.
- Replace a count/sum maintain's grouping, kind, or source: the engine replaces
  exactly the union of predecessor/successor projected IDs. Other rows survive,
  and destructive changes to them or removing the whole target table need a
  plan. Jobs cannot write maintained targets.

`counts[viewer]` can compile after regrouping with changed meaning. The report
says `maintain counts: by sender → by recipient`; check refuses only missing
names, incompatible types, or missing indexes. Review regrouped readers.

## Checked narrowing and repair

A new required column on populated rows refuses `E_SUCCESSOR_COLUMN_REQUIRED`.
For outer `T?` → `T`, absence counts as null. Keep it optional and apply; add a
job in `snapback/admin.q`, run it, then require the column and apply:

```q
job fillAvatars():
  chunk p in profiles first 100 by byId:
    update profiles[p.id] { avatarUrl: p.avatarUrl ?? 'https://cdn.example.com/default.png' }
```

Run `snapback2 run fillAvatars --as system --plan`, then `--wait` (`guide job`).
Update `seed.ts`: seeds are checked first and never backfill stored rows.
The refusal pastes a typed fill job.

Narrowing checks inside optional/list wrappers. Under the predecessor schema,
run the pasted job: it deletes removed scalar cases or over-long lists,
truncates text with `slice`, and fills nulls when the column becomes required.
The text-delete alternative guards only values over the new maximum.
Values inside lists and `bytes` need sampled deletes: nulls are filled and
kept, never sampled for deletion. Re-apply and run fresh samples until zero.
No case is substituted. Uniqueness, cap, address and reference checks still run.

A queued removed-case write keeps its bytes: resume resets; replay refuses
`E_INPUT` unspent. `outbox.status().blocked` names the head, its label names
the refusal, and its item offers Dismiss. `dismiss` returns the bytes and FIFO
continues, also on follower tabs. A replay durably clears eligibility before
sending: in-flight or unknown outcomes cannot be dismissed (`guide offline`).
If the case returns, those original bytes can commit once.

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

Or use the refusal's `applyCommand`; relative plan paths use the working
directory. Success is ready at the plan's generation; failure rolls back rows,
indexes, generation metadata and timers.

## Custody logs

A `deliver` line installs its log empty; `bootstrap` fills it once from
current members, within 8,192 events per installation (Σ cap × rows over the
logs it bootstraps; above it E_SUCCESSOR_BOOTSTRAP: drop the word, and readers
reach prior history through the content table under its rule). Removing or
retargeting the line is a destructive plan. The audience bound `A` is
engine-recorded, never spelled: max(cap, largest stored audience), recomputed
at each installation and shown in the manifest; lowering the cap is admitted,
and history keeps its pricing until those rows are gone.

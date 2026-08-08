# guide-gap: the shipped `snapback migrate` surface has no guide page and no capability-index row

**Opened:** 2026-08-08 · **Severity:** P2 (documentation)

`snapback migrate preview|approve|rehearse|apply|verify|cancel` (LLP 0081
reviewed storage evolution; src/cli.rs:979-987, MigrateCommand at
src/cli.rs:1527ff) is a shipped seven-verb operator surface, listed as
shipped `cli.migrate.*` controls in guide/operating/agent-controls.md:145-151
— with the Guide column `—` on every row. There is:

- no guide page or anchor teaching the preview→rehearse→approve→apply→verify
  loop or its refusal codes;
- no capability-index row at all — not even a GAP row — despite
  capabilities.md promising "everything Snapback has, covered or GAP"
  (`/usr/bin/grep -n migrat guide/capabilities.md` hits only an unrelated
  deploy-profile line);
- dangling prose that assumes coverage exists:
  guide/operating/instance-forks.md:396-397 says "Use the reviewed migration
  rehearsal flow for production apply decisions" with nothing to link, and
  guide/getting-started/the-authoring-loop.md:236-240 routes destructive
  schema changes to "the reviewed migration path (LLP 0081)" with only an
  LLP pointer.

An agent facing a destructive schema change — one of the most common
authoring journeys — has no capability id and no aliases ("migration",
"alter column", "drop field") to search.

Ask: add a migrations guide page (operating or backend), a
`backend.migrations`-style capability row with the CLI witness and aliases,
and wire the agent-controls Guide anchors plus the two dangling prose
pointers.

Found independently by two lanes of the 2026-08-08 comprehensive docs
review (entry-points and operating slices).

## Resolution

Fixed 2026-08-08 (docs-review execution, 1284ae8a5). New page
guide/backend/migrations.md teaches the seven-verb `snapback migrate`
loop (all flags verified against src/cli.rs, the 12-variant intent
vocabulary, rehearsal binding, `rollback` declared-but-unbuilt, and all 22
`SNAPBACK_MIGRATION_*` codes); the `backend.migrations` capability row
(with migration/alter-column/drop-field aliases) and index entry landed at
integration; both dangling prose pointers (instance-forks.md,
the-authoring-loop.md) now link real anchors; and the seven
`cli.migrate.*` control-catalog rows gained Guide cells pointing at the
page.

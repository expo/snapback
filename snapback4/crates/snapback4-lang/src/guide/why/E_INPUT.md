# Writes — E_INPUT

E_INPUT means an argument or row value does not fit its declared type.
Correct the named field or its declaration. A typed reference checks the id's
shape; use `require exists t[id] else CODE` to require a visible target.

Defaults fill missing insert columns on the writing host, including the insert
branch of `upsert`; updates and existing-row upserts never reapply defaults.
`upsert` inserts or patches: on an existing row, unnamed columns keep their
values. An incomplete insert patch answers `NOT_FOUND`. An explicit null
clears an optional column. Omitted asset columns keep their placement; an explicit
asset id on a row you cannot read must be your own upload, even if it equals the
retained id. The update
rule runs before asset diagnostics. Conditional `if` sees old only inside
the engine; neither old nor the merged image is a program binding.

The table names are the language card's. A final write is the implicit
return; bind one to use its row (`row = insert ..`). Writes check the rule,
then unique indexes, caps, immutable columns, text formats and `after
insert` postconditions; any refusal rolls the whole mutation back, and a
maintained aggregate is written through its source rows. Every written row
fans out to its partitions (guide sync). A mutation applies at most once
per client-minted id and principal. Valued updates/upserts and conflict
`current` are ordinary read-rule gets (null or withheld when hidden), evaluated
at the read's state; a write that grants read authority may return its row.

A reference column checks the id's shape, not that
its target exists: when a mutation needs a visible target, guard first —
`require exists prompts[promptId] else PROMPT_NOT_FOUND` — a metered point
read that is false for an absent or hidden row; deleting a target neither
deletes nor refuses the rows that reference it, so a lifecycle is the
application's, in its mutations and rules.

- **Types:** `principal`, `id`, `<table>` (a reference to that table's
  id), `int` (within ±(2^53 − 1); there are no floats), `time`
  (milliseconds), `bool`, `decimal <scale>`, `money <CUR> [scale]` (both
  hold integer minor units), `text`, `text <=N`, `text M..N`, each with optional
  `format handle|url`, `enum('a', 'b')`, `json <=N`, `bytes <=N`,
  `[type] <=N` (a bounded list), `image <=N [once]` and `video <=N` (an
  upload the row holds — `guide assets`); `?` after a type makes the column
  optional (null when absent). `default <literal | now | viewer>` fills an
  omitted insert column on the writing host; an explicit value wins.
  A required literal default also fills absent columns in older rows on every host; optional columns still read null when absent.
  An enum fits `text <=N` when every variant has at most N characters and
  contains no control characters except tab, LF and CR: a
  static, total widening with no runtime conversion. If any variant exceeds
  N, use the enum type on the helper parameter instead.

- **References** are typed ids, with no implicit existence check and no
  delete cascade. The string `"null"` is an id; JSON `null` only fits an
  optional reference. When a mutation requires a visible target, write
  `require exists prompts[promptId] else PROMPT_NOT_FOUND` before its
  writes: a metered point read that refuses absent and hidden targets
  alike. Target deletion and dependent-row cleanup are the application's
  policy, expressed in mutations and rules.

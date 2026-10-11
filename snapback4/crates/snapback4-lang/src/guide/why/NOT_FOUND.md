# Writes — NOT_FOUND

NOT_FOUND means a point write has no target, or a write to an unreadable target
was refused without disclosing its existence. It is also the conventional
application code for `row ! else NOT_FOUND`. Check a readable target and retry;
do not infer absence from a refused blind write.

An alternate-key delete of a missing row refuses `NOT_FOUND` locally when the
synced group proves absence; otherwise it queues for server resolution.

For update/upsert, "readable" means the read rule admits the old row in the
pre-write state, before the patch or any of its effects. The engine resolves
id and unique-key targets privately; the update rule judges old and next.
An unnamed `update <- R` must hold for both the row before and the row after
the write, so writing `owner: viewer` cannot take over another principal's row.

| Target before the write | Refusal details |
| --- | --- |
| Readable | `E_RULE`; `E_CONFLICT` with a read-rule `current`; named `E_CONSTRAINT`; `E_INPUT` |
| Unreadable or absent | `NOT_FOUND` for rule denial, an `update` condition, secondary unique clash, or an incomplete insert patch; no row, index, column or branch detail |

A hidden collision on ordinary insert or `insert ... if absent` stays
`E_RULE`; a readable collision names its index (if-absent returns null).
An update or upsert-patch colliding with a different hidden row returns generic
`E_RULE` when its target is readable and `NOT_FOUND` when its target is unreadable.
Use `upsert counters[recipient] { count: 1 }` under an `update` rule to
write another principal's row. Success discloses the admitted row's existence
and the update rule predicates. It grants no extra stream or snapshot row.
A condition belongs on `update`; an upsert inserts or patches. A condition
needs a row you can read; a blind patch needs none. On a row you cannot read,
immutable columns in a patch are ignored. A readable immutable mismatch still
names the column. Before target lookup, the engine reserves room for the rule
probes and the largest merged image allowed by the schema and supplied patch;
if it cannot fit, `E_BOUND` refuses equally for a hidden or absent target.
Delete targets and insert/if-absent collision lookups also reserve authorization
before resolving a row, including expired rows. The allowance covers the read
rule's worst case, including probes that could short-circuit; execution still
charges the rule work once.

Reads come first. A program's own lookup (`posts[post] ! else NOT_FOUND`,
`exists`) sees only rows the caller's read rule admits, so a hidden row is
NOT_FOUND there and a later `require … else CODE` or the table's delete rule
never runs: a moderator who must delete others' rows needs a read rule that
admits moderators, or a `delete posts[post]` by id with no lookup first, which
the delete rule judges directly (`guide refusals`).

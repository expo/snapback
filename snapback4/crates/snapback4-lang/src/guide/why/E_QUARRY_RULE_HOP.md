# Rules

E_QUARRY_RULE_HOP means a known relationship cannot be traversed in this rule
position. Each write-rule term allows one hop through a row-local reference, such as
`.message.conversation` or `messages[.message].conversation`. The referenced
row must be live and readable; absence or denial cannot grant authority,
including under `not`. Each hop costs one prepaid rule probe, sharing the
request's physical authorization allowance. Sibling hops are legal and charged
per occurrence. A device needs current coverage.

Read rules inherit their parent's whole rule with `read through .message`.
Final `after insert` obligations, deeper hop chains, private fields and
engine-maintained target fields need an explicit mutation check instead:
`m = messages[message] ! else NOT_FOUND`, then `require` the desired field
predicate before writing. The located diagnostic names the actual table,
reference and field. Read-through capture and lifetime checks still apply.

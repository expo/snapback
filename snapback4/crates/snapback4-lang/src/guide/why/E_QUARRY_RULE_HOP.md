# Rules

E_QUARRY_RULE_HOP means a known relationship cannot be traversed in this rule
position. Write rules allow up to three live hops through row-local references:
`.reaction.message.conversation`, `.message.conversation`, or
`messages[id = .message].conversation`, including probe keys such as
`exists members[.message.conversation, viewer]`.
The referenced rows must be live and readable. Absence, expiry and denial
remain unknown, including under `not` and equality with null.
Each hop costs one prepaid rule probe within the request's physical allowance.
Sibling hops are legal and charged per occurrence, even in skipped branches.
`check --cost` and `why` list each hop. Prediction needs current coverage of
all parents and authority witnesses; missing coverage withholds prediction.

Final `after insert` keys resolve these hops at transaction end. A missing or
hidden parent rolls back the mutation. Read rules still inherit their whole
parent's authority with `read through .message`, including its lifetime; on a
table that does not sync, a one-hop equality in a read rule is the probe of
that row (`.goal.owner = viewer` is `exists goals[.goal, owner = viewer]`).
Private fields, maintained values, ephemeral targets and chains beyond three hops
refuse. The located diagnostic supplies a mutation check using the actual
names: bind each parent with `! else FORBIDDEN`, then `require` the predicate
before writing. An authorized null field is a value; an unavailable parent
never becomes a value that negation can turn into authority.

# Rules — E_FIELD_AUTHORITY

E_FIELD_AUTHORITY means an owner declaration is invalid, or a supplied/updated field is not yours. Name a required principal column on this table, declare a default, and omit the field when writing another principal's row.

Only a named `update (old, next)` transition may use a private field as a
rule input; ordinary update rules cannot test guesses against it. A named
transition also cannot make an ordinary writer's success depend on another
owner's private value. Such a test requires ownership (or audience visibility).
Comparing an untouched private field with itself, such as
`next.readUpTo = old.readUpTo`, remains available without knowing its value.
Ordered self-comparisons require visibility when the field is nullable: null
is not ordered, so even `next.secret >= old.secret` can reveal nullness.
Retained write-target copies are charged at declared column bounds, so hidden
lengths cannot change the writer's meter or exhaustion boundary.
Private fields cannot supply indexes/cursors, expiry, recorded attribution,
other rules' probes, aggregate source inputs, or Following mappings and predicates; make the field readable by audience
before using it there. A row-keyed count may use a private member predicate
when the member read rule requires that field's owner; `guide maintains` gives
the admission rule. This applies to both `view` and `maintain … timeline`.
Point reads, writes and authorization witnesses charge fixed declared
reservations and results that pass row-read and field authorization. Range
and cursor pages retain an examined-count residual: some scan paths charge
candidates before rejecting unreadable rows (never expired ones), so counts
and meter cuts can vary within the physical walk bound. A private page that
exhausts that bound cannot expose a hidden continuation key, including when
a nested witness consumes the allowance.
Unreadable, private or expiring candidates reserve declared decoder bounds:
a large declaration can exhaust the heap even for an empty value. Public,
non-expiring rows without private fields or recorded captures establish authority before
storage access and use actual-size decoder accounting. Expired scan candidates
are discarded inside the internal ledger before any payload is priced.
Authorization witnesses expose their verdict and the earliest expiry instant
at which the complete rule's verdict can change. All witnesses expiring at
that instant disappear together; correlated alternatives share this timeline.
A stable grant needs no deadline, while necessary expiring authority does.
The bounded branch walk depends on rule structure and verdicts, never on
whether a private witness is permanent or expiring. Alternatives needed for
the complete timeline are visited in both cases.
Failed predicates and denied rows export no deadline.

## Writing a member's read mark

A member patches its own `readUpTo` with no row update grant. A named update
transition still applies; other patched fields need the row's update rule.
Omit another principal's read mark, including 0. See `guide writes` for the
read-mark example and `guide rules` for the membership recipe.

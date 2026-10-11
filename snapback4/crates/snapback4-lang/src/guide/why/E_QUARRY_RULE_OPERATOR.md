# Rules — E_QUARRY_RULE_OPERATOR

A table rule says only what a partition can hold and a device can judge the
same way. Anything else is a check in the mutation, `require … else CODE`:

| form | in | example |
|---|---|---|
| `allow`, `deny`, `public 'why'` | any rule (`public` reads) | `read <- allow` |
| `=`, `!=` over `.col`, `viewer`, literals | any rule | `.owner = viewer and .state != 'final'` |
| `exists t[..]` | any rule; a read rule probes one hop, deeper uses `read through` | `exists members[.board, viewer]` |
| `created t[..]` | insert | `created orgs[.org]` |
| `<`, `<=`, `>`, `>=` | insert, over the row's own required int/time/decimal/money columns and int literals (minor units beside decimal or money); named `update (old, next)` images, by the same rule | `.stars >= 1 and .stars <= 5`; `next.bid > old.bid`; `next.available >= 0` |
| `and`, `or`, `not` | any rule | `not .archived` |
| `now`, arithmetic, helper calls | no rule: `require` in the mutation | `require now < s.startsAt else TOO_LATE` |
| `else CODE` | no rule: a rule refusal is `E_RULE` | `require exists managers[viewer] else NOT_MANAGER` |

E_QUARRY_RULE_OPERATOR names a term a table rule does not evaluate: the clock,
arithmetic, a helper call, or an ordered comparison outside an insert row's own
columns and a named `update (old, next)`. A read rule is an audience, so it
cannot change with time or compare magnitudes: filter the query, or hide rows
past a time with `expire at .until`. The rewrite moves your comparison into the
mutation: `delete <- .startsAt > now` becomes `row = shifts[id] ! else
NOT_FOUND` then `require row.startsAt > now else INVALID_STARTS_AT`. An
optional column may be null, which is not ordered.

An unnamed `update <- R` holds for the row before and after the write, so its
named form is `update (old, next) <- R(old) and R(next)`: `update <- .owner =
viewer and .available >= 0` becomes `update (old, next) <- old.owner = viewer
and old.available >= 0 and next.owner = viewer and next.available >= 0`, every
clause kept. To bound only the new value, drop the comparison from the rule and
`require available >= 0 else INVALID_AVAILABLE` in the mutation.

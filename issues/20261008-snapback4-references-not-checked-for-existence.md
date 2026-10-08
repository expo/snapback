# Snapback 4: a reference argument or column accepts an id whose row does not exist

Status: Open
Date: 2026-10-08
Scope: Snapback 4 core value/write semantics (references), guide text
Reproduced: yes, on main cd2fa88d8b

## Evidence

App-farm round 1, single report flagged "possible defect": order-relay-hooks-0037
placed 2 orders (and 4 deliveries) whose `restaurant: restaurants` column holds
the literal string `"EXISTS"` from a probe-script bug; the mutation accepted it
"without complaint ... Possible missing server-side reference validation, or
references are intentionally unchecked."

## Repro

```quarry
use personas alice
table restaurants:
  name: text <=40
  public 'directory'
  insert <- allow
  online only
table orders:
  restaurant: restaurants
  items: text <=200
  placedBy: principal
  read <- .placedBy = viewer
  insert <- .placedBy = viewer
  cap 100 by placedBy
  online only
mutation placeOrder(restaurant: restaurants, items: text <=200):
  return insert orders { restaurant, items, placedBy: viewer }
```

```
$ snapback4 run placeOrder '{"restaurant":"EXISTS","items":"x"}'
{ ..., "result": { "id": "01M4D5AESC...", "items": "x", "placedBy": "dev:alice", "restaurant": "EXISTS" }, "state": "sent" }
```

Not even the 26-character id shape is checked; an id of a row that never
existed is accepted the same way.

## Design status

Intentional today: the `E_INPUT` explanation (`snapback4 why E_INPUT`) says "A
table reference validates the id's shape, not the target's existence ...
`require exists t[id] else CODE` checks for a visible target". Two gaps:

1. "validates the id's shape" is not what happens: any string is accepted.
2. The rule lives only in a refusal explanation, not where a builder declares
   a reference (`guide types`, `guide writes`, the `from-sql` row for
   `REFERENCES`).

## Suggested fix

- Lead session: decide whether an insert/update writing a reference column
  should check the target's existence (it is one point probe per reference;
  visibility rules decide what "exists" means), or keep it explicit.
- Either way, make the documented behaviour true (validate the 26-character
  form, or drop the "shape" claim) and state it in `guide types` beside the
  reference type with the `require exists restaurants[restaurant] else
  NO_RESTAURANT` idiom.

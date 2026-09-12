# Maintains

`maintain` builds count/sum targets with source group types: count is int;
sum matches its source. Each has a unique group index and read rule; user writes refuse.

`readable <- rule` permits certification over non-uniform sources (`E_DISCLOSURE`);
the target's `read` still applies.

`total[key]` yields its value or typed zero if absent/unreadable, reflecting
earlier mutation writes. Program point reads and their API types see values;
`data` and rules see rows; bounded ranges keep rows/pages.
An unheld local target is unknown: `useQuery` yields `data: undefined`,
`status: "unavailable"`, reason `partial` until authority arrives, including
for composites of totals. Held zeros remain readable offline.
Untimed literal totals also retain their checked owner answer; timed or
mixed row/totals results need enough coverage to rerun exactly.
For `c: counts`, `c.value`/`c { * }` (aliases/named shapes too) refuse:
use `counts[c]` or, if optional, `counts[c ! else CODE]`.

```q
maintain messageCounts: count messages by conversationId
  read <- exists memberships[.conversationId, viewer]
```

See `guide quarry` for related topics, and `guide fanout` for folding a
maintained count across an uncapped population with a `chunk` job.

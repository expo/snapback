# Maintains

`maintain` builds count/sum targets with source group types: count is int;
sum matches its source. Each has a unique group index and read rule; user writes refuse.

`readable <- rule` permits certification over non-uniform sources (`E_DISCLOSURE`);
the target's `read` still applies.
Every maintain needs an indented `read <- rule`. To expose the total publicly,
write `read <- allow`; `maintain ... public` is not a property.

`total[key]` yields its value or typed zero if absent/unreadable, reflecting
earlier mutation writes. Program point reads and their API types see values;
`data` and rules see rows; bounded ranges keep rows/pages.
An unheld local target is `unavailable`/`partial`; held zeros remain readable.
Timed or mixed row/totals results need enough coverage to rerun exactly.
For `c: counts`, `c.value`/`c { * }` (aliases/named shapes too) refuse:
use `counts[c]` or, if optional, `counts[c ! else CODE]`.

For UTC buckets, store `day = divmod(now, 86400000).quotient` in the
source mutation; maintain by owner/day. A timed screen reads all seven trailing
days using the owner's `now`. Load/refresh: `guide live-query`.

Count an existence table for distinct groups; keep its explicit total paired
with source writes and delete at zero (`guide fanout`).

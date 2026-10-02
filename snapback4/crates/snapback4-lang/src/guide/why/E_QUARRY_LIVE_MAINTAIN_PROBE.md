# Expire — E_QUARRY_LIVE_MAINTAIN_PROBE

A row past the time in the column is absent — to every reader, on every
host, before any rule — from that moment; the server's sweep schedules physical deletion
on its one-second tick (backlog and work slices can delay it), and the deletion streams to each device holding it, so it
leaves local stores on the next sync. In development, `snapback4 clock advance 185s`
runs that sweep immediately on the running `dev`; the deletion reaches both
device stores through normal sync, without changing the device clock (guide clock).
Disappearing messages are one field on
insert; there is no purge job to write. An ordinary maintained `view` over an expiring table
reads its physical total minus unswept expired contributions under the read
meter through an internal group/expiry/source-id index. Live rows add no server
read work. Devices still recompute live source contributions under their meter;
partial source coverage or a cut cannot supply an exact aggregate. Physical zero-sum occupancy reads at most one index entry. A rule may probe whether that live group
exists at one rule-probe unit, regardless of expired sources. A rule equality
on its `value` is refused at `check` (E_QUARRY_LIVE_MAINTAIN_PROBE): read the
view in the program; its live value cannot be probed at one unit. Value
equalities on non-expiring maintains and ordinary tables remain supported. Row-keyed counts certify predicates separately (guide maintains).
Value-order indexes over expiring sources are refused by check
(E_QUARRY_MAINTAIN_EXPIRE) and raw schema adoption: use the fresh live bounded query
on guide feeds. It sorts live counts with no schedule lag or writable score table;
if candidates or their contributions exceed the meter, the ranking is incomplete.
The optional scheduled ranked-table recipe trades fresh scores for stored paging.
The sweep already updates aggregates and indexes transactionally, but stored order
is stale between expiry and the physical sweep or after a partial sweep. Taking
stored top-N and rechecking only those winners can miss the live winner. A count-index threshold scan is not built: it could use server physical upper
bounds, which device snapshots lack. Signed sums have no upper bound.
A partial device counts only held live
sources and says `complete: false`. A meter cut of an ordinary aggregate returns `data: null, complete: false`.
An expiring row-keyed range read returns `{ value: L, recountPending: true }`
with `complete: false`, the current-row lower bound examined so far (guide maintains). A zero sum keeps its group while sources
remain, because one signed contribution can expire before another.

- **Rules:** `read`, `insert`, `update`, `delete`, each `<-` one
  expression over the row (`.col`), `viewer`, and literals: `allow`,
  `deny`, `public` (or the table line `public 'reason'`, which also
  documents why), `.col = viewer`, `.col != 'x'`,
  `exists t[.a, viewer, 'literal']` (a probe may name its columns:
  `exists t[id = .docId, ownerId = viewer]`), `created t[..]` (insert rules
  only: true when this mutation inserted the probed row), `and`, `or`,
  `not`. `update (old, next) <- old.x = next.x` names both images. A table
  with no rule for an effect denies it. A rule may probe existence on an aggregate view
  over an expiring source at one unit, but `check` refuses an equality on its
  `value` (E_QUARRY_LIVE_MAINTAIN_PROBE): read the view in the program;
  its live value cannot be probed at one unit. Equalities on non-expiring
  maintains and ordinary tables are unchanged. Rules compare with `=` and `!=`
  only; the system principal consults no rules. Write authority and refusal
  disclosure are separate, as `guide writes` states.

# E_CASCADE_BOUND

E_CASCADE_BOUND means a delete's cascade has no fixed bound that fits its program. `on delete cascade` and `on delete set null` write every referencing row in the deleting transaction, so a reachable delete needs `cap N by <column>` on the referencing table: a product limit on how many rows one target can have. A plain `unique <column>` proves the same bound with a cap of one; a composite unique key does not. A delete then reserves the cascade's whole worst case — every cap along the chain — whether or not those rows exist, so its cost never depends on rows the caller cannot see; `check` refuses a delete whose reservation cannot fit a mutation (or a job chunk). For an unbounded relation: lower the cap if the domain has a smaller limit; keep `on delete restrict` and delete the referencing rows first in a job (`chunk`), then the target; mark the target (`archived: bool`, filtered by readers) and sweep it in a job; or declare `on delete keep` when the rows should outlive the target. guide writes.

`check` computes a cap recipe for all children together that fits both rows
and heap, including the root. Choose the product limit, then apply the caps together; the printed engine maximum is only a ceiling. A dormant unbounded edge needs no cap until a declared delete source appears. A count-maintained
source commonly reserves 3 × its row count: the source row and its old and new
aggregate groups. Event images add heap as well. The recipe is a product cap,
not permission to enlarge a meter. For a maintained sum source, keep restrict
and bulk-delete ordinary rows in a system job so each deletion unwinds its
contribution, then delete the marked parent after its children are gone.

Heap = root write heap + retained event images + 384 × (cascade identities + 1 root + 4 child-id slots + largest set-null group) + max(child write heap, four-row child page, read-through probe scratch).

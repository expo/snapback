# N_SEQUENCE_READ

N_SEQUENCE_READ locates a sequence whose read authority depends on an existing
membership in the same group. The witness parent column, in the selected key or a residual equality, must equal
this row's sequence parent; a key such as `access = .parent` alone does not
prove that, and receives no such note. Its first membership refuses even if the parent
was created in that mutation: parent creation does not prove a fresh shared
sequence counter. Caller E_RULE deliberately does not identify this cause.

Preserve the membership audience with the manual allocator in `guide sequences`:
change the declared sequence column to `int`, seed initial memberships with
zero, and add `lastOrdinal: int default 0` to its declared parent table. For
later inserts, read that readable parent's counter and advance it atomically
wherever the model allocates a position. Preserve existing uniqueness
constraints. The guide explains counters shared across tables. Use `snapback4 why recent`
after the refusal in `snapback4 dev` to see the exact clause and source site.

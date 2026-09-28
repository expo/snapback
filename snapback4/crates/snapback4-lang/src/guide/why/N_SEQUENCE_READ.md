# N_SEQUENCE_READ

N_SEQUENCE_READ locates a sequence whose read authority depends on an existing
membership in the same group. Its first membership refuses even if the parent
was created in that mutation: parent creation does not prove a fresh shared
sequence counter. Caller E_RULE deliberately does not identify this cause.

Preserve the membership audience with the manual allocator in `guide sequences`:
keep an int ordinal, seed initial memberships with zero, read the readable
parent's lastOrdinal for later joins and increment it atomically for each
message. Keep the group/ordinal uniqueness constraint. Use `snapback4 why recent`
after the refusal in `snapback4 dev` to see the exact clause and source site.

# Delivery custody: `deliver`

The declaration, its log's shape, receipts, and refusals are `guide offline`
(Custody); installing, bootstrapping, removing, and the audience bound `A` are
`guide successor`. This page is what a write does to the log.

Inserts and seeds deliver to the group at that write, one event per principal.
Changed updates/upserts and deletes append to the original recipients, departed
members included; omitted optionals are null and equivalent writes add nothing;
rollback removes the events. A deleted id cannot be reused
(E_DELIVER_INCARNATION: insert into that table with its required fields and a
fresh id). Receipt-only replay derives no events; private audience probes are
traced outside receipts. Reserve: insert N+1, update/delete A, upsert
max(N+1, A); nonuniform scans, job chunks included, cannot spend it. E_BOUND
names a dominant deliver term; loop-dominated steps keep E_STEPS. A replay or
`then` refused by historical A settles durably.

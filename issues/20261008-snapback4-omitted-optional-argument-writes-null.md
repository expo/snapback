# Snapback 4: an omitted optional mutation argument is not `= null`, and the write clears the column

Status: Open
Date: 2026-10-08
Scope: Quarry optional arguments in mutations (core: binder/interpreter); docs (`guide writes`, `guide types`)

A mutation with an optional argument used `if arg = null` to decide whether
to update a column. Called with the argument omitted, `arg = null` was
false, the update ran with the omitted value, and the column was written
null: the existing value was cleared and the mutation reported success.
Single build, but the costliest single Snapback item in the farm's v7 arm
(insulin-dose-calculator-0633, Muse, 25 minutes; round-3 synthesis cluster
13), and a silent wrong write.

Ask: either an omitted optional argument compares equal to `null` (what the
author expected), or the guide states the difference between omitted and
`null` with the form that tests "was it given" — and `check` notes a write
of an optional argument to a column with no such test. Reproduce with the
build's schema before deciding (its `snapback/schema.q` is under
`~/appfarm/apps/insulin-dose-calculator-0633/` on the M5 Ultra Studio).

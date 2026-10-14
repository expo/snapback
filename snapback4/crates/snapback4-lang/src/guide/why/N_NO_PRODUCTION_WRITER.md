# N_NO_PRODUCTION_WRITER

N_NO_PRODUCTION_WRITER means no production insert path can bootstrap this table. Fixtures
and /seed are development doors. `why N_NO_PRODUCTION_WRITER` in your project
names the missing insert path or the existing mutations whose insert rules
depend on rows that have not yet been provisioned.

Add a service-seat insert mutation. Use an operator-minted seat: require `viewer = 'service:ops'` in a bootstrap
mutation and allow `or viewer = 'service:ops'` in the table's insert rule.
Its probes still obey read rules; allow that seat to read the rows it must
check. Mint `snapback4 token --service ops --release ./deployment` and call the
mutation with the real account principal and the bearer token. A synced roster
uses the independent seat-or-existing-member branch; the compiled recipe is
`snapback4 guide deploy --section first admin`.

A persona-only schema's identity note is safe to ignore without `use identity`.
It is a reminder for a production transition, not a requirement for a dev app.

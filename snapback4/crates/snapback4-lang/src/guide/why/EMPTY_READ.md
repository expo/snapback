# Empty answers — EMPTY_READ

EMPTY_READ is optional local evidence that a query returned null, an empty
array, or a composed answer containing either, without an instrumented cause.
It does not prove denial: no one typing, no reactions yet, or a profile not
created are ordinary answers. It is not a caller refusal. Default `dev` neither
prints nor records these answers. `snapback4 dev --trace-empty` records them
only in `snapback4 why recent`, with operation, request and time; it still
prints no empty-result notices. Visibility filtering with an evaluated read
rule remains outside this stream. An application's explicit `require … else
EMPTY_READ` is a real refusal and is still logged.

To investigate one read, run these from the backend project, replacing
OPERATION, TABLE and DIR with your query, table and fixture directory:

- `snapback4 why OPERATION` shows the query's read sites, execution placement
  and coverage requirements. Match the arguments and viewer of the empty read.
- `snapback4 why TABLE` shows its read rule, sync audience and acquisition
  horizon. Follow any `read through` parent with `snapback4 why PARENT_TABLE`.
  `snapback4 guide rules` explains why hidden and missing rows look alike;
  empty data alone cannot tell which rule rejected a row.
- `snapback4 check --residency` reports sync coverage and server/device
  placement. `snapback4 test --fixture DIR --as alice --residency --verbose`
  measures that viewer's acquisition and runs queries on the fixture; replace
  alice with the declared persona or principal you are investigating.
  `snapback4 guide sync` explains horizons and `complete: false`;
  `snapback4 guide offline-interactions` explains incomplete local coverage.
  A server empty answer is not proof of what a device holds.
- For a request/time marker, restart development with
  `snapback4 dev --trace-empty`, reproduce the read, then run
  `snapback4 why recent` (or `snapback4 why recent --instance ID` if several
  dev servers run). This is bounded, eventual evidence, not a rule verdict.
  It cannot recover a past unrecorded read or show a device-only read.

Use one quiet reproduction: tracing shares the 32-record stream and 32-slot
queue with real refusals. Polling empties can crowd out older refusals. A
dropped latest record leaves `why recent` reporting `pending or dropped` until
a newer record is saved. Pause polling, reproduce once, inspect promptly, then
restart without --trace-empty when finished.

Keep the rule and horizon that the application needs. Do not widen either
solely to silence an empty answer. Real refusal envelopes and parked jobs
still enter the local refusal stream by default.

# M7 closing-essay paragraphs

Day-2 evolution turned out to be a migration story more than a feature
story. The polls themselves were straightforward Quarry — a message kind,
an options table with stable client-chosen ids, a one-row-per-voter table
with set-state upsert — because the platform already knew every pattern
the feature needed: reactions showed the vote shape, text sends showed the
receipt and push fan-out, membership creation showed the `created` probe
that keeps options honest. The instructive half was the backfilled count.
A maintain cannot filter tombstones and nothing runs on expiry sweep, so a
stored counter can never be exactly "currently visible"; the correct
implementation is a read-time query over live rows, backfilled and
maintained forward by construction rather than by batch job. The record
should show the pre-M7 schema already carried a count structure — the raw
`messageCounts` maintain — which counts rows rather than visible messages
and stays untouched beside the new query.

What gave me the most confidence was sequencing: snapshot before schema,
probe before suite, suite before choreography. Exporting the pre-M7 state
through the custom-client API first meant every later step had an
independent oracle; the throwaway API probe caught the one real defect (an
immutable `at` blocking vote changes) before the durable suite existed;
and the durable suite — including a regression item that re-runs all seven
prior suites — meant the choreography run was a confirmation, not an
experiment. It passed green on the first attempt, live tallies and offline
reconcile alike. If there is a lesson for the next Day-2 session, it is
that the choreography's page-scoped selectors (one `sm-poll-total` per
view) are the sharpest constraint in the whole milestone: the setup script
that guarantees exactly one live poll with fresh ids earned its place more
than any feature code.

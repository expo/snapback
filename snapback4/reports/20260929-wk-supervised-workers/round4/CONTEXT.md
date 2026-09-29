# WK round 4 context

Scope: Node completion ledger, worker lifecycle/environment, serve package lookup
and credential retirement. Applied the read-only llp-orient skill. Read the lane
prompts and prior reports, both complete round-3 reviews, Snapback 4 instructions,
exclusions and journal, governing LLP sections and current effects guide.

The first command was `git fetch origin && git merge origin/main`. The only
conflict was two append-only journal histories; both were retained in merge
`d22e97335`. No push or publication.

Governing documents: LLP 3000 is the fence's root (current); LLP 3000.009
(current) owns durable work and worker supervision; LLP 3000.007 (current)
owns the worker authoring surface; LLP 3000.019 governs adoption and writer
boundaries. LLP 3000.005 keeps native jobs separate. No Snapback 4 foundation
link applies.

- LLP 3000#4-fence-numbering-routing: independent workspace and gates; preserve
  the 593,719 B gzip wasm cap.
- LLP 3000.009#5.2: stable effect identity, completion before acknowledgement,
  unchanged effect ordering/attempts/meters, and honest provider-call ambiguity.
- LLP 3000.009#5.3: supervisor-owned credential lifecycle, keeping credentials
  out of logs, only validated project source runs, explicit child environment,
  bounded restart and process-group lifetime.
- LLP 3000.007#9.2: standalone Node workers remain outside the data plane.
- LLP 3000.019#3.6: do not make HTTP admission wait for supervision's writer work.
- LLP 3000.005#2-where-it-sits: no native-job or wasm-engine change.

Decisions preserved in the existing LLP: keep rollback journaling and retry busy
COMMIT while retaining the writer reservation; cancellation before handler entry
stops, cancellation after provider success still commits the receipt. Persistent
readers can delay that commit. Unrecoverable storage/result-encoding failures
and process death still leave a provider-call/commit window.

A failed session deletion advances the existing shared revision once, keyed to
the retiring child's original revision. Serve honors that transition too and
renews peers; successful independent restarts and manual seats remain unchanged.
Use the nearest ancestor's schema-local dependency installation for releases.
Supervised ledger failure exits with internal status 78, becomes visible as
ledger-unavailable and follows bounded retry. Standalone done resolves.

The full suite exposed round-3 automatic snapshots omitting checked project
imports outside snapback/. Reuse the existing checker graph and descriptor-based
source validation for those copies; fixture state belongs in its explicit output
directory, since module URLs refer to the private snapshot.

Docs updated: LLP 3000.009 §5.2/§5.3, effects/actions cards, server manual and operations manual.
The await census updates only the two server-worker entries: these awaits do
not participate in client write delivery. No new LLP, gate or budget.

Risk retained: the previously ticketed watchdog fallback group-ID reuse concern
is outside these requested repairs. Linux execution is not macOS or actual
provider qualification. Handoff: none.

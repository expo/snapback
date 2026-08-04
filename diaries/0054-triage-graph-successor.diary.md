# Diary 0054: Triage Graph local-first successor

**Date:** 2026-08-03  
**App:** `demos/triage-graph`  
**Program:** LLP 0155/0157 Move 1, lane P3

## What I built

I built a fresh sessions-mode Triage application rather than porting the old
Triage transforms. The predecessor contributes only scale lineage and exit-gate
intent: the dated workload manifest refreezes 249,000 baseline events plus a
1,000-update burst, 100 active matches, 50-row pages, 20 query changes, and no
Fleet workload. This is the LLP 0155 OQ13 decision: fresh successor manifest,
no copied predecessor transforms.

The online screen consumes one generated `snapshot-batch.v1` tuple: active
issues and transition summaries arrive under the same snapshot and the UI
renders the two node arrays directly. That felt excellent. The declaration is
short, codegen refused a missing `_id` projection immediately, and the result
shape made it hard to accidentally reintroduce the old client-side collection
join. The generated `sbsb1` continuation also turned the untouched-root
pagination proof into a direct two-page assertion.

The offline boundary needed more care. LLP 0166 correctly says snapshot batches
are volatile, so I added a separate generated owner-scoped relational inbox
with `opaque-authorized-snapshot-v1` retention. P1/P2 then worked as intended:
the live query established from the generated activation, stored a completeness
proof and authorized lease, and a new client rendered the same 100 rows after
the owned backend stopped, marked `authoritative` / `retained`. The explicit
answer classes were much safer than treating “some cached bytes exist” as an
offline-success signal.

Durable registrations were the roughest app-facing seam. LLP 0166 OQ8 keeps
programmatic authoring private, so the demo isolates the underscored
`__prepareGeneratedMaterializationBridge` and `__registerDurableQuery` calls in
one adapter. This proves the shipped ledger survives relaunch, but it is not a
pleasant or supportable product API; the rest of the UI intentionally knows
nothing about it.

The first custody inspection corrected an assumption I brought from ordinary
cache implementations. Twenty disposed, non-retainable snapshot-batch query
changes remain as bounded grace payloads, while only the relational result has
the durable registration and retained-render authority. The frozen envelope is
therefore 21 records/fragments and 120 stored top-level result rows: 20 volatile
one-row graph envelopes plus 100 authoritative-retained inbox rows. Inspection
names both classes instead of calling the volatile bytes offline-renderable.

The controlled run also found a receipt bug: reading `liveInbox.rows.length`
after disposal serialized zero because disposal clears the mutable handle.
Capturing the installed count before disposal repaired the measurement without
weakening the proof. Final measured custody is 48,016 logical bytes (21,561
result bytes plus 26,455 proof bytes), one 612-byte durable registration, one
lease, and 124,572 physical carrier bytes. Hydration installed 100 rows / 14,981
payload bytes in one 144.321 ms observed attempt; the frozen latency ceiling is
1,000 ms.

## Guide experience and gaps

The guide pages for relational queries, snapshot batches, generated artifacts,
live queries, sessions, and acceptance testing were useful and accurately
steered the provider-native screen. In particular, the snapshot-batch page made
the cursor and aggregate-take limits obvious, and the generated-artifact page
prevented committing forty cache projections instead of the one review
manifest.

The offline guide has drifted behind the P1/P2 bridge. It still describes
protected JS retention as unproven/Contract-only and does not teach trusted
composition activation, qmk1 materialization establishment, LLP 0166 answer
classes, lease custody, or the fact that public programmatic registration
authoring is intentionally absent. I filed
`issues/20260803-guide-gap-p2-materialization-retention.md` so the guide can
absorb that knowledge without this lane making a capability claim.

Codegen also warns that the relational projection result is `unknown`, even
though the projection is fully declarative. That forced casts in the UI and is
tracked separately in
`issues/20260803-relational-query-projection-result-typing.md`; fixing it needs
a core codegen change outside P3's writable surface.

## Build and verification experience

The primary sandbox denied loopback bind with `EPERM`, exactly as the lane note
predicted. I moved the controlled run to the project-authorized Apartment Mac,
created a detached temporary worktree at the exact P1+P2 base, bootstrapped its
vendored Ibex runtime from prepared artifacts, built the requested source
binary, and used a fresh file-store directory. The final 250,000-event run and
retained receipt passed all eight gates; `--check` also passes after bringing
the content-addressed activation/cache and receipts back to this worktree.

Compared with React plus Convex or Supabase, the generated composite and
proof-carrying retained answer remove a large amount of handwritten join/cache
logic and make offline authority far more explicit. Snapback currently adds
more deployment-specific activation ceremony, internal registration plumbing,
and generated-cache handling than either familiar alternative, so the data
model felt better while the local-first application setup felt less mature.

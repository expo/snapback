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

## 2026-08-04 — Move 2 public registration follow-through

The OQ8 programmatic-registration half is now public, so I replaced the demo's
private bridge/address assembly with one `client.registerQuery` call over the
generated `retainedInbox` reference. The client now owns qmk1 construction,
the authority-partition digest, the closed registration record, and writer vs
non-writer broker forwarding. That removes the most brittle app-specific code
from the original diary entry while preserving the stable
`triage-graph-retained-inbox-v1` identity and exact retention policy.

The new outcome envelope is a useful ergonomic improvement over the private
boolean-shaped seam: the demo handles `committed` and stable refusals through
the same `RegisterOutcomeV1` shape used by forwarded contexts. The remaining
friction is deliberate but visible: the app must choose and permanently own a
store-scoped registration id, and durable intent can still refuse when the
generated query's owner classification does not admit retention. Compared with
React plus Convex or Supabase, that asks for more explicit custody policy, but
it no longer asks the application to know a materialization address or auth
partition digest.

## 2026-08-04 — Maintenance-aware custody correction

The original 21-fragment/120-row freeze captured the demo before LLP 0166's
maintenance pass was wired into the shipped client. Once Lane A added that
pass, the old assertion became actively misleading: all 20 query-change
handles had been disposed with `persistResume: false`, so their pinned
retention was `none` and §D5 required payload compaction at the next writer
pass. They were not release-grace payloads under the implemented policy.

The acceptance harness now injects a fixed clock and inert scheduler, prepares
and records each exact qmk1 address, then explicitly drives one maintenance
pass—no sleep and no idle-callback race. `StorePolicyInspectionV1` must explain
the resulting set as one programmatic registration retaining the 100-row Inbox,
zero release-grace or blocker-held records, and 20 compacted
`instance-bookkeeping` stubs. This was a stale-harness defect, not lost durable
payload: the registered Inbox remained present throughout the reported
failure.

The adjudication also exposed a separate Lane A over-retention defect. The
maintenance predicate compacted `retentionRequest: none` while demand was
active, but missed the same pinned request after final release, allowing a
default (or infinite) TTL axis to keep payload that §D2 says may not be kept.
The policy now reclaims that payload on the next explicit pass and has an
owning regression. No registered or payload-retaining grace record was lost;
the defect retained too much.

This made Snapback's policy model feel substantially better than an ordinary
opaque cache once the right inspection was in hand: the test can state why
every address exists and which one may own bytes. The ergonomic miss was that
an acceptance workload could previously observe whichever queued maintenance
callbacks happened to run. The injected clock/scheduler seam fixed that cleanly
and belongs in future custody-oriented demo harnesses from the beginning.

## 2026-08-16 — owner provenance moves out of the handler

The four Triage mutations now omit owner fields on inserts and rely on LLP
0264's host stamp. That removed repeated `ctx.auth.userId` plumbing without
changing the owner slice. Because authored source identity changed, the
demo-local trusted composition activation was re-prepared through the existing
server-owned ceremony and regenerated; this is maintenance evidence only, not
a renewed capability claim.

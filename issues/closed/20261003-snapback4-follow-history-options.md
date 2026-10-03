# Snapback 4: Keep the Following history window; older posts on profiles

Status: Closed — Charlie ruled to keep the 1,000-event window (2026-10-03)
Date: 2026-10-03
Scope: Research/design; no product implementation authorized by this ticket
Proposal: [F, LLP 3000.032 §4.4](../../llp/3000.032-client-contract-builder-costs.research.md#44-f--older-follow-history-keep-the-window)
Evidence: [ledger](../../snapback4/reports/20261003-cx-client-contract/EVIDENCE.md) (F1/F2); 2/14 primary Astra builds cite this cost.

## Resolution — 2026-10-03

Following keeps each actor's newest 1,000 events at follow time and new events
afterward. Older posts are reached through the actor's profile, as documented
with one query and an end-of-feed profile link in the
[feeds card](../../snapback4/crates/snapback4-lang/src/guide/feeds.md#following-contract).

Charlie rejected all-history copying: followers × history storage adds about
99,000 copies / 286 MB for one reader of a 100,000-event actor (about 9.9M
copies for 100 readers, by arithmetic); the whole feed is withheld during
backfill; catch-up traffic grows while devices retain the same 1,000-row floor;
and 2/14 calibration mentions with zero workaround lines show no builder demand.
The [ruling and shelved RFC](../../llp/3000.016.000-older-following-history.rfc.md#0-ruling)
and [F's measurements](../../snapback4/reports/20261003-f-follow-history/REPORT.md)
are preserved. The version-3 `timeline experimental history all` prototype is
not landed; it remains recoverable at
[`origin/sb5/f-follow-history-prototype-parked` (0936b660f0)](https://github.com/ccheever/snapback/tree/0936b660f0).
Any later older Following support should prefer on-demand pages under its own
design. [LLP 3000.016 §3](../../llp/3000.016-following-on-a-bounded-device.rfc.md#3-semantics-worth-stating)
records the retained contract.

## Original options and obligations

The options were fixed 1,000, frozen all-history enumeration, on-demand older
paging and a planned current-membership read; the ruling above selects the
first. The original scope and estimates below remain for context.

Expected builder-code reduction: Zero demonstrated workaround LOC. Six declaration/query lines already accept the window; benefit is a capability, not code deletion.

Correctness obligations: Fixed enumeration domain, fair task turns, truthful page completeness, explicit existing-follow upgrade, bounded meters and stated storage cost. Preserve event identity, edge epochs, tombstones, floors and publication fences. The linked proposal cites the governing LLP sections and gives the API sketch, alternatives and risks.

Planning cost: 0.5–25 days documentation/design depending on option; implementation separately estimated in LLP, including scoped tests, docs and review repair; not measured implementation time.

The ruling selects the documentation/profile option. Any future expansion needs its own ruled design and concrete source replacement/probe plan; no score uplift is promised. Preserve independent content authority and existing custody rather than creating another client cache or queue.

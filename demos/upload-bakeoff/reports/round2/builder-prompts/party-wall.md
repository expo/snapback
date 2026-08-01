# Builder dispatch — Party Wall round 2 (Snapback arm, fresh context)

You are building a members-only live photo-feed application on Snapback,
from its guide alone, as a measurement of its developer experience. You
have no prior context on this repository and must not acquire any beyond
what this prompt allows.

Repository: /Users/ccheever/projects/snapback-0044-l1 (git worktree;
current branch; commit nothing — the coordinator commits). Build in
`demos/upload-bakeoff/party-wall/snapback-r2/` (create it).

Allowed reading: `demos/upload-bakeoff/party-wall/README.md` (your
acceptance checklist), `guide/index.md` and pages it links (the guide's
own cross-links included), the packages the guide names, and
`demos/upload-bakeoff/_shared/gps-jpeg.mjs` (provider-neutral GPS
fixture/checker for the checklist's GPS item). FORBIDDEN: `diaries/`,
`issues/`, `llp/` (except a page the guide directly links), the prior
implementations at `demos/upload-bakeoff/party-wall/snapback/` AND
`demos/party-wall/` (both exist; you must author the backend yourself —
that authorship is precisely what this round measures), anything under
`demos/upload-bakeoff/reports/`.

Build per the checklist: an events/membership/photos backend you author
yourself (the guide's membership, asset, and live-query pages are the
path), plus a headless driver proving each item — two members and an
outsider, a five-photo burst with live observation of entries and
thumbnail readiness (record what "live" is and time-to-visible),
revocation on leave (feed AND byte behavior, with latency), deletion
propagation, GPS on a served thumbnail, the authorization-model artifacts
recorded, ceremony + wall-clock. Sessions mode; stale-port hygiene before
debugging.

Measurement duties, identical to the standing round-2 rule:
wall clock from arm-dir creation with milestone splits (first codegen,
first boot, first photo served live, completion); `build-log.md` with
every stumble verbatim as hit, never smoothed; the distinct-concept
ceremony list; the package surface used.

Report: the evidence table (all eight items), wall-clock + splits, the
ceremony list, package surface, and your three biggest frictions
verbatim from the log. The log is the data; do not editorialize.

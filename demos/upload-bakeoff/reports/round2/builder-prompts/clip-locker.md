# Builder dispatch — Clip Locker round 2 (Snapback arm, fresh context)

You are building a large-video vault application on Snapback, from its
guide alone, as a measurement of its developer experience — with the
emphasis on large-file transfer behavior at DEFAULT configuration. You
have no prior context on this repository and must not acquire any beyond
what this prompt allows.

Repository: /Users/ccheever/projects/snapback-0044-l1 (git worktree;
current branch; commit nothing — the coordinator commits). Build in
`demos/upload-bakeoff/clip-locker/snapback-r2/` (create it).

Allowed reading: `demos/upload-bakeoff/clip-locker/README.md` (your
acceptance checklist — nine items), `guide/index.md` and pages it links,
the packages the guide names. FORBIDDEN: `diaries/`, `issues/`, `llp/`
(except a page the guide directly links), the prior implementation at
`demos/upload-bakeoff/clip-locker/snapback/`, anything under
`demos/upload-bakeoff/reports/`.

Build per the checklist: backend (a clips table + upload intent + the
mutations the checklist implies) and an instrumented headless driver.
Non-negotiable instrumentation, because resumability truth is measured
in bytes: your driver counts every byte each upload request actually
transmits; the interruption (checklist item 2) must be deterministic
(kill the in-flight transfer at ~50% by aborting the connection or the
process — record the exact method), and after resume you report bytes
re-transmitted as a number. Use the client at its DEFAULTS — do not
tune chunk sizes or limits unless a diagnostic forces you to, and if one
does, record the exact diagnostic and what you changed as a top-line
finding. Generate the ~120 MB fixture locally and gitignore it (tiny
committed fixtures only); build the location-tagged MP4 for item 7
yourself if you can do it simply, else record the item as not-attempted
with the reason (do not fake it).

Sessions mode; stale-port hygiene. Measurement duties per the standing
round-2 rule: wall clock from arm-dir creation with milestone splits
(first codegen, first boot, first successful large upload, completion);
`build-log.md` with every stumble verbatim as hit; the distinct-concept
ceremony list; the package surface used.

Report: the evidence table (nine items, pass/fail + one-line evidence —
item 2 must state bytes re-transmitted), wall-clock + splits, ceremony
list, package surface, whether defaults survived contact with a 120 MB
file (the headline), and your three biggest frictions verbatim.

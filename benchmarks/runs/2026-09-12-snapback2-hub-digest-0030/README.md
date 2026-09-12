# Exact hub digest qualification — 0.0.30

The copyable `dist/guide/recipes/exact-hub-digest/` recipe completes the reopened
hub ticket without changing certified limits or the required population.
Source candidate: `05b71a418158693b400e1bf5bb0d62c94713bb98`.
Package source: `f1867f540b5752d62cc8fa6bd918bab4a3c3291a`.
The package source preserves the candidate product blobs and adds the 0.0.30
version preparation. Publication and registry results are recorded separately.

The focused owner test traverses 500 follows and 1,000 memberships, excludes
900 expiries that become due after accumulation, handles a late membership
leave and source deletion, and restarts before the pending retry. All clients
are closed before the scheduled boundary. It produces exactly 1 new follower,
499 followed posts, 99 unread messages and 98 unread chats, one logged effect,
no zero-activity emission and no duplicate on replay. Two deterministic controls
force equal persisted read/send timestamps while preserving the real mutations'
sequence order; a leave/rejoin control binds contributions to a fresh membership.

The compiler/package suite passed 319 checks, including discovery and
certification of the installed full recipe. The focused owner case passed in
28.630 seconds (29.411 with its harness). These logs are author executions,
not independent reviewer executions. Final-chunk static bounds are 3,221,762
heap bytes, 3,446,773 closure bytes, 31,461 steps, 1,515 examined rows and 509
writes. They are certificate bounds, not measured allocations.

The required full suite was run on the preceding candidate `eccad684a7` before
its read-order repair. Native checks passed 1,200/1,200 and compiler checks
319/319; package checks passed 1,449 with one failure at the owner's unchanged
10-second startup deadline during cold concurrent compilation. The identical
isolated package-workspace case then passed with that same deadline. The full
run is retained as a failure; it is not reported green. The ordering-only delta
was qualified with the fresh compiler and focused owner executions above.

The earlier `eccad684a7` source and its `a9cc16e0` package stages were rejected
because millisecond read/send timestamps did not establish transaction order.
The corrected source uses a monotonic per-conversation send sequence and a
membership-bound read-through sequence. Rejected package artifacts were preserved
and were not published. Historical 0.0.29 digest counterexamples remain in their
original release evidence directory.

This is scoped source and package qualification. It does not claim a full
Clique builder wave, constant-request global search, or a performance result.

Both fresh final reviewers returned `NO MATERIAL FINDING REMAINS` for the
source candidate. Their received verdicts are retained here. The corrected source
landed at `f47f667c7e69c31098495b4275e37b1ff52150b3`; every candidate product
blob and qualified package/version blob is unchanged. The landing preserves
the newer main branch negative evidence and reconciles the ticket/plan text.

The publisher completed at **07:32:27 UTC** on 2026-09-12 in **56.2 seconds**.
All three 0.0.30 registry integrities and `latest` tags were verified at
**07:34:40 UTC**. See [registry verification](./registry-final.json),
[qualified receipt](./qualified-resume.json) and [publication log](./publish.log.gz).
The qualification JSON is the preserved prepublication snapshot; its hold status
is historical. The first publish invocation refused before any registry write
because its imported Linux receipt was omitted. The retry supplied the retained
receipt. npm then propagated the accepted packages asynchronously; none was
republished during that interval.

Both Darwin arm64 and Linux x64 passed all **29 installed-consumer steps and
four media checks** with the production engine against the same final shim.
The packaged recipe source hashes match the corrected candidate. Canonical
client / React / Expo / runtime gzip sizes are **142,989 / 152,942 / 156,395 /
89,843 bytes**, exactly matching 0.0.29. The 90,000-byte runtime ceiling passes;
the historical growth comparison remains failed and its baseline is not reset.
The published guide has **32 Markdown files and 98,202 / 98,304 bytes**.

`files.json` binds the retained artifacts. Compressed logs and cost JSON retain
their original bytes after decompression. The separate earlier full-run failure
and isolated control have their original candidate and command provenance.

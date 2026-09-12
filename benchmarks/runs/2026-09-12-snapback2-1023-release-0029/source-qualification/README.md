# Retained source qualification for Snapback 2 0.0.29

The final source check is bound to **75ee110fa1ccff019c994c667fd36b2d332ce8b7**, not the later landed or published commit. Root owns that integration mapping and separate publication SRI evidence.

`qualification.json` maps actual recorded statuses, source assertions, raw evidence, byte comparisons and cleanup. `files.json` records the original remote or git source, original SHA-256, retained SHA-256 and sizes for each collected artifact. Raw logs and source excerpts use lossless gzip; no application stores, credentials, binaries or package tarballs are included.

- Final literal `snapback2/scripts/test.sh`: exit **0**, **58 seconds**, 1450 package, 318 compiler and 1199 native tests passed; both evaluators, doctests and package artifact verification passed.
- Original combined29 full-suite failure and the intermediate 13/14 guide run remain unchanged. The missing reserved-binding guidance was restored; complete guide 14/14 and final full script passed.
- Canonical runtime is **89,843 / 90,000 bytes**; the 80,000-byte target remains unmet. Guide is **98,237 / 98,304 bytes**.
- Existing full-loop measurement at cee80 is **exit 1**: all four +1% historical baseline byte comparisons fail. The accepted bf650aebb baseline was not changed. Earlier imported-main rows already exceed it; final bytes are lower than the latest retained comparable main row. Timed checks pass, while the effects-disabled chat receipt remains explicitly blocked in the original row.
- Hub execution covers full-population search, feed, rich history, author CRUD and negative controls. The digest is **unresolved**: its retained test proves stale accumulated eligibility after deletion/restart. Timer expiry ordering is a source-level counterexample, not successful final-emission validation.
- Historical Snapback1 source-cap failure is retained as a failure. No claim it passed, and it was not rerun during collection.

`derived/closeout-audit.json` records the clean EPYC lane at 75ee and all 75 recorded owned PIDs absent. No lane executable remains. Branches and claims are preserved. Historical final-run host/process context is in `raw/qualification29/final/`; current read-only host context is separate.

Collection performed only read-only remote operations and local evidence writes. It did not launch a build, test, benchmark, new instrument or gate.

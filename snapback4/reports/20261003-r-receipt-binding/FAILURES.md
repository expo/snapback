# Full-sweep failure classification

The original script reports 45 client failures: the 44 leaf/file entries below
and the enclosing social-browser parent. The parent's only failed child is
`observations make retention explicit`, with the same CLI-replacement cause.
Raw outcomes remain in [full-suite.log.gz](./full-suite.log.gz). The table classifies
every failure; repaired check outcomes are in the linked logs and REPORT.md.
No failure is asserted inherited without baseline evidence; none needs that
classification here. Environmental diagnoses are supported by unchanged tests
rerun after correcting their execution environment, not by suppressing tests.

| Original failure (verbatim test name and timing) | Classification and repair | Recheck |
|---|---|---|
| `delivery-fault-matrix.test.mjs`: every delivery await is explicitly classified (157.613845ms) | Ours: two new zero-await files missing from the boundary census | [delivery-census-repaired.log.gz](./delivery-census-repaired.log.gz) |
| `per-row-liveness.test.mjs`: packages/snapback4/test/per-row-liveness.test.mjs (18588.30826ms) | Environmental: Node HTTP parser asynchronous exception after passing cases under the concurrent pool | [client-repaired.log.gz](./client-repaired.log.gz) |
| `readme-examples.test.mjs`: README TypeScript examples compile and call every public function (8641.704694ms) | Ours: recipe block omitted imports and typed context | [client-repaired.log.gz](./client-repaired.log.gz) |
| `routes.test.mjs`: an explicit 5xx Response retries the same invocation without duplicating its mutation (124236.61722ms) | Environmental: worker startup ENOENT during shared CLI replacement; isolated CLI rerun | [client-repaired.log.gz](./client-repaired.log.gz) |
| `seen-devices.test.mjs`: seen lifecycle process: real generated binding, offline custody/restart, leave/rejoin and independent retained history (1003.405701ms) | Environmental: shared CLI replaced by another lane; missing descriptor / old starter | [client-repaired.log.gz](./client-repaired.log.gz) |
| `seen-devices.test.mjs`: seen lifecycle wasm: real generated binding, offline custody/restart, leave/rejoin and independent retained history (815.847727ms) | Environmental: shared CLI replaced by another lane; missing descriptor / old starter | [client-repaired.log.gz](./client-repaired.log.gz) |
| `server-e2e.test.mjs`: dev watches checked imports and configs outside snapback and keeps the last good worker through failed checks (127919.315705ms) | Environmental: worker startup ENOENT during shared CLI replacement; isolated CLI rerun | [client-repaired.log.gz](./client-repaired.log.gz) |
| `social-browser.test.mjs`: observations make retention explicit (10.238889ms) | Environmental: shared CLI replaced by another lane; missing descriptor / old starter | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: acquire CLI refuses invalid arguments before connecting (12.682183ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: acquire CLI saves actual SDK acquisition and cold retained receipts across fresh runs (633.09283ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: acquire refuses unknown personas, mismatched bearer identity, unreachable servers and unknown queries (642.647283ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: serve accepts a matching bearer, refuses a different principal, and omits server timings (900.141513ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: bounds guide command and receipt excerpt execute against a small fixture (664.518623ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: reconnect proof rejects more-then-drop and records every attempted request (155.092ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: reconnect proof rejects denied and records every attempted request (147.555592ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: reconnect proof rejects malformed-json and records every attempted request (163.410201ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: reconnect proof rejects null and records every attempted request (164.267656ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: reconnect proof rejects missing-fields and records every attempted request (180.800171ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: reconnect proof rejects bad-more and records every attempted request (152.93007ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: reconnect proof rejects behind-server and records every attempted request (151.06287ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: reconnect proof rejects dropped-first and records every attempted request (162.683472ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: reconnect proof rejects drop-once and records every attempted request (150.723692ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: reconnect proof rejects truncated-body and records every attempted request (153.241616ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: reconnect proof rejects bad-ack and records every attempted request (151.387827ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: reconnect proof rejects bad-acquisitions and records every attempted request (151.445283ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: echoed bearer and derived refusal text never reach stderr, JSON, text or receipt files (9.670978ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: witness family usage advertises both commands and shares input diagnostics (13.464205ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: receipt identifies the JSON-line subprocess host (162.57527ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: restart times coverage separately from first answer (142.237439ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: binary native module installs and survives restart (152.421197ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: binary native module digest refusal fails proof (172.577264ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: server allowlist drops raw from every acquisition output surface (154.421936ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: server allowlist drops hex from every acquisition output surface (155.249036ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: server allowlist drops HEX from every acquisition output surface (145.585869ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: server allowlist drops base64 from every acquisition output surface (145.172359ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: server allowlist drops base64url from every acquisition output surface (154.426053ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: server allowlist drops percent from every acquisition output surface (160.94865ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: server allowlist drops percentLower from every acquisition output surface (152.842718ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: server allowlist drops sha256 from every acquisition output surface (155.38466ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: caller query and args are echoed from the request, never selected schema metadata (153.700415ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: failed query receipts distinguish argument rejection, query refusal and incomplete coverage (435.61237ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: equals token spelling authenticates without exposing the bearer (80.812602ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: acquire argument refusals omit values including equals bearers (6.214647ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |
| `witness-acquire.test.mjs`: runtime refusals do not echo caller argument values in stderr (160.106878ms) | Environmental: shared executable outside checkout cannot locate the client witness helper | [client-repaired.log.gz](./client-repaired.log.gz) |

The script's other failed stage is Cargo's artifact build, caused by our missing
`Bound.receipt_members` field in the serve-poison test fixture. It was repaired
before the complete Rust stage reran. That rerun records five failed targets:

| Rust target | Failed cases | Classification and repair | Recheck |
|---|---:|---|---|
| `snapback4-lang::frontend_regressions` | 2 | Ours: copied contract needs its new type-only dependency | [frontend-repaired.log.gz](./frontend-repaired.log.gz) |
| `snapback4-core::row_view_accounting` | 6 | Environmental: private-store parent was a symlink | [real-directory-repaired.log.gz](./real-directory-repaired.log.gz) |
| `snapback4-core::row_view_disclosure` | 8 | Same real-directory requirement | [real-directory-repaired.log.gz](./real-directory-repaired.log.gz) |
| `snapback4-core::row_view_witness` | 3 | Same real-directory requirement | [real-directory-repaired.log.gz](./real-directory-repaired.log.gz) |
| `snapback4-core::snapback4_core` | 8 | Same real-directory requirement | [core-directory-repaired.log.gz](./core-directory-repaired.log.gz) |

All remaining Rust targets and doctests completed in [rust-repaired.log.gz](./rust-repaired.log.gz).
The repaired fixtures preserve the original assertions. No core/filesystem rule,
product runtime, timeout, concurrency default or budget was weakened.
Development-only failures before the full sweep are classified in REPORT.md.

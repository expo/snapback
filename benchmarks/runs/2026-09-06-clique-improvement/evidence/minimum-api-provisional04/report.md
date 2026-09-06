The bounded **actual API minimum witness passes 74/74** against the immutable M5 provisional-04 owner and the exact saved compiler fixture. There were **32 accepted calls and 42 refusals**; every refusal preserved row, index, commit, job, outbox and outbox-attempt counts. This is provisional candidate runtime evidence, **not publication qualification**, a full integration result, or a benchmark. No repository/product source was edited, no compiler or Rust build was run, and no main/push/publish action occurred. Compiler source remains owned by compilerQwriter.

The executed artifact is `/Users/ccheever/clique-improvement/revisions/search-engine/provisional-04/snapback2-owner` on `ccheever@100.88.75.121`, a native arm64 executable identified by the producer as a debug actual owner, not a core test binary. Its SHA256 matched before and after execution. All 141 archived source files matched `inputs.json`; compact sorted JSON hashing of their path-to-SHA map reproduced the exact requested source graph. The archive and source patch are retained in `immutable-owner/`. The unchanged base Cargo.lock also matches the producer's lock hash. This verifies the supplied source/archive/binary binding without rebuilding it.

| Binding | SHA256 / identity |
| --- | --- |
| Actual owner | `81b1549a8255faa351b90f8908c69ec6a4784409e74cbe08fd39a086ba6eb498` |
| Source graph | `7125764886dbf9188e79b51ad6a4683ef7015e66e23e0b4e144b51dc0403c254` |
| Immutable owner inputs.json | `9f1c28b8c425fe7ee3f59d16a1245c66604be67b8cc99c204c91f19030592ada` |
| Source archive | `bc688a92981db9cda3e2c23ebfea96638ae17bcf597eb768d00cc4cac3cc9808` |
| Frozen implementation-project.json | `8c35b015b59047aa157355ecdf7dc2ee84905f25a4ca919155aaaea0080b4849` |
| Frozen implementation-compile.json | `3cf1d69dfcc1989ba028a56fd41fe248eebc9bdd41c6a5736400a9dc22a12a2f` |
| implementation-tested-inputs.json | `d142cb9dc0c5cbaaff8b51bedc467230ac96247b88a6a278a683a7562235f941` |
| Value model | `i53-codepoint-bytes-unicode-search-text-min-v4` |
| Evaluator | `bounded-spike-rust-search-text-min-3` |

The frozen compiler commit is `e6c46a2aca7c3fa014ce365dadce667b5e13e509`. All 188 compiler-file hashes in its tested-input manifest match the committed Git objects. Its saved 310-dependency attestation is retained; this witness did not rebuild or revalidate a mutable compiler worktree. The original fixture files and saved compiler outputs match on both hosts. `compiler-replay.mjs`, adapted from the earlier external witness, transports the saved compiler response unchanged and returns an empty seed. It imports no compiler and rewrites no IR. The owner performs its normal certification, HTTP admission, execution, persistence, and job enqueue. No legacy Index/Scan compatibility conversion is present.

All eight standalone and installed operation certificates carry the exact identities above. Installed argument descriptors equal the frozen descriptors, including all nine positive Text.min fields. The owner's cache serializer adds `version: 1`, duplicates the existing auth settings at the project root, and omits empty schema.channels; `installed-binding.json` records these three differences. This is ordinary owner serialization after replay, not a fixture adaptation. `snapback2 version` reports **0.0.8**, unchanged; package version alone does not identify this candidate.

| API family | Cases | Accepted | Refused | Matched |
| --- | ---: | ---: | ---: | ---: |
| Query | 43 | 21 | 22 | 43 |
| Mutation | 19 | 7 | 12 | 19 |
| Job admission | 12 | 4 | 8 | 12 |
| Total | 74 | 32 | 42 | 74 |

All 45 original query/mutation baseline cases were replayed with their authored acceptance decisions, including the 12 prior minimum misses. Additional calls cover ASCII minima/maxima, supplementary scalar boundaries, decomposed versus precomposed Unicode, four-item cardinality, invalid later list items, and emitter boundaries. A single `😀` or `é` fails min 2, while `e` plus combining acute and `😀a` pass; three supplementary scalars pass max 3 and four fail. A 200-supplementary-scalar body and 50-supplementary-scalar list item pass their maxima. Empty min-zero text passes. Optional text and optional lists accept null/omission; optional lists also accept an empty list while refusing an empty or one-scalar item under min 2.

Representative exact admission responses follow; all requests, raw response bodies, HTTP statuses/headers, deadlines and before/after counts are in `api-results.json`.

| Request | HTTP | Exact response body |
| --- | ---: | --- |
| Mutation ops.add, empty body | 200 | `{"code":"E_INPUT","family":"input","guide":"input/runtime","message":"E_INPUT: arg body is below text min 1","rewrite":"fix the rejected mutation input and retry","state":"rejected"}` |
| Mutation ops.add, empty option | 200 | `{"code":"E_INPUT","family":"input","guide":"input/runtime","message":"E_INPUT: arg options is below text min 1","rewrite":"fix the rejected mutation input and retry","state":"rejected"}` |
| Query ops.inspect, empty body | 400 | `{"code":"E_INPUT","family":"input","guide":"input/runtime","message":"E_INPUT: arg body is below text min 1","rewrite":"pass arguments matching the operation declaration"}` |
| Job ops.sweep, empty body | 400 | `{"code":"E_JOB_ARGS","family":"job","guide":"job","message":"E_INPUT: arg body is below text min 2","rewrite":"job sweep(body: text >=2 <=3):","site":"ops.sweep"}` |

Every invalid job was submitted before any positive job or row insertion. Empty, one-scalar, over-max, null and omitted job arguments left records/commits/jobs/outbox at **0 → 0**. Four valid jobs then returned HTTP 200 top-level `state: "queued"` records, persisted exactly one job each, and completed against the still-empty table. They produced eight lifecycle commits and no record writes. Thus refusal does not depend on a chunk body running. The fixture's job has a scalar text argument only; no list/optional job signature is claimed.

Existing maximum and cardinality behavior is preserved: text maxima use E_INPUT/E_JOB_ARGS, over-four lists retain E_FANOUT (mutation envelope code `bound`), and the existing lower-cardinality guard retains OPTION_COUNT/denied. The minimum query refusals are HTTP 400 E_INPUT, rather than the historical assertion prototype's denied query result. All 42 refusals, including cardinality refusals, show identical durable counts before and after.

The initial store was empty. Final stopped-store counts are **4 records, 4 index entries, 15 commits, 4 jobs, 3 outbox rows, 0 effect attempts**. These are accounted for by four valid inserts, eight empty-job lifecycle commits, and three valid emitter commits. Every invalid emitter call preserved the outbox and commit counts. Both live status responses report `effects.engine: "none"`; final effect attempts are zero. The frozen effect contains a grant for `https://example.com` but its function only returns its payload. No effect or external network request was executed. Witness HTTP was restricted to the private loopback owner; SSH used only the named M5.

**Channel admission is untested:** the exact frozen fixture has no channels. Its unchanged channel-subscription count is zero and is not an admission proof. No channel, numeric-scalar argument, optional job signature, or min-list job signature was fabricated to fill fixture coverage gaps.

Counts came from 153 owner-created `/control/fork` SQLite snapshots, using the owner's normal backup API. Every snapshot response and hash is retained in `snapshot-responses.jsonl`; private stores and snapshots remain stopped on M5. Selected persisted rows/commits/outbox fields are in `persisted-evidence.json`. Credentials and full private databases were not copied into the local evidence mirror.

Two harness issues are preserved explicitly. Attempt 01 stopped before any admission call because a direct read of the owner's exclusively locked database failed; `attempts/01/` retains its script, traceback, status and cleanup. Attempt 02 used supported snapshots and completed all 74 HTTP calls. Its initial parser expected a wrapped successful job envelope and misclassified four actual top-level queued responses. `attempts/02/` preserves that initial summary, script and unmodified API results. `audit-results.py` recognizes the recorded job envelope and checks each persisted enqueue delta; `audited-results.json` and the final `witness-summary.json` contain the corrected derived result. No response was altered and no product red was hidden. The unsupported `--version` invocation is also retained; the supported `version` invocation succeeds separately.

The complete run took 0.558 seconds; each HTTP request had a 4-second timeout, startup 8 seconds, job completion 4 seconds, and the private witness a 60-second alarm. Scoped verification commands had 30-second deadlines. Cleanup used a 3-second terminate deadline and would allow 3 seconds after a PID-specific kill; neither run needed SIGKILL. Port 50864 was verified free for attempt 01, owned PID **62223**; port 50865 was verified free for attempt 02, owned PID **74958**. Both owners exited 0 after SIGTERM, both ports returned connection-refused, and final bind checks passed. Only these owned PIDs were signalled. No reserved port was used.

Original local and M5 input/evidence hashes are unchanged. Historical parent report/phase files were already different between hosts when this witness began; their respective before/after hashes are preserved. The old c8741dc6 owner plus ordinary compatibility copy remains **version-bound historical baseline evidence** in `inputs/`; it is not relabeled as current candidate evidence. The present result is scoped to the exact provisional-04 owner and frozen e6c46a2 fixture. No genuine new-owner failure was found; no engine/compiler patch or external red escalation was necessary.

`evidence-manifest.json` binds the detailed evidence. `phase.json` is the external phase handoff, and `final-answer.md` is separate from this report. These artifacts and their hashes are mirrored under the same private witness root on local and M5 hosts.

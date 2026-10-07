# FH round 4: refresh and live review fixes

This round follows `200eda60b6` in `sb4-intent/fh-following-history` on eb1000.
No additional merge, push, publication, remote host or other worktree changes.
The supplied full-feature Astra and Grok reviews were read in full; copies are
retained beside this report. LLP 3000.026 §9.12 records every disposition.

## Changes and review disposition

- **Astra P1, valid wider cards:** refresh authorizes a metered prefix instead
  of refusing the whole mounted batch. It returns `preparing` and the last
  checked public input identity; the SDK continues the suffix. The SDK also
  bounds request bytes and splits multiple point witnesses, requiring every
  fragment to authorize. Field lists split at the 128-field witness bound too;
  a separate 200-field-card regression covers that boundary. Live shaping runs
  in separate bounded continuations.
  New history cards stay staged until combined validation completes. The
  regression traverses 100 cards with 120 extra fields, then 20 wide live cards.
  A native test covers the exact 14 MiB reservation boundary, one byte below,
  and a smaller output allowance. Runtime ceilings are unchanged.
- **Astra P1, live loss:** displayed live events remain mounted and are
  reauthorized, even after leaving the inbox preview window. Retention checks
  the current epoch's actual inbox copy, liveness and every disclosed card
  witness. The composed list deduplicates by event identity and sorts by exact
  event time/id, independent of the card projection. A decimal time string and
  Unicode scalar comparison preserve ordering at the JSON/JavaScript boundary.
  Tests cover 21 later arrivals, tombstone/unfollow withdrawal, and a refollow
  whose new copy window excludes a retained live event.
- **Post-B visibility, user ruling:** the frozen history session does not grow.
  Recent inbox deliveries may be previewed live; backdated arrivals below that
  window and arrivals missed between polls belong to the next exact session.
  The generated hook now exposes `refresh()` to begin that session. A real
  server test exhausts the old 25-event domain, refreshes, then exhausts all 26
  events including the backdated birth. This replaces the previous unimplemented
  complete post-B live-subscription claim in the LLP, guide and certificate.
- **Astra P2, cancel binding:** cancellation checks viewer, operation, normalized
  arguments, declaration/page size and engine incarnation/generation before
  abandoning either an unused registration or a session. Cross-operation cancel
  leaves both first execution and pinned replay intact; correct cancellation
  affects only its consumer. Both JavaScript and native HTTP regressions cover it.
- **Astra P2, refused meters:** every response uses the outer refresh ledger.
  A final output refusal retains completed read charges; a failed reservation
  adds nothing. The regression restores the allowance and reuses the session.
- **Grok, spin:** dropped/fence-discarded responses use exponential backoff with
  ceilings from 100 ms to 5 s and jitter in the upper half. Observation wakeups
  obey the same deadline. Accepted progress resets it; a loadMore queued during
  successful refresh runs promptly. A deterministic scheduler test exercises
  drops while online, repeated wakeups, recovery and all-fragment authorization.
- **Grok, native HTTP coverage:** native HTTP tests now cover authentication,
  malformed input, independent openings, refresh, replay and cancellation.
  `/following/cards` is explicitly in the Rust read-only refusal matrix.

## Protocol and resource limits

Refresh slices do not advance history tokens or add frontier custody. Mounted
input is already public; `checked` echoes an input id, and `seen` contains only
shaped live ids already returned during that cycle. No hidden heads, births,
work counts or private scan positions leave the server. A live cycle admits at
most 100 preview identities before the next poll; post-B completeness comes
from the next frozen session. Refresh observations may change on retry; pinned
history units keep their stronger replay guarantee.

Authorization costs O(M) point work over mounted witnesses, split into bounded
requests. Each live slice reevaluates the bounded inbox window P ≤ 100 and
shapes a fitting prefix: O(RP) for R slices. This does not scan unrelated authors.
Existing nonrenewable withdrawal and own-post/edge fences remain in force.
Read-only history still refuses `E_READ_ONLY`; ordinary inbox/matchRead behavior
and offline device facts are unchanged.

## Persisted bytes and wasm

**No persisted-byte change in round 4.** No engine table, schema, catalog, IR,
application row, index or ordinary inbox query/certificate changes. The added
ordering field and refresh continuation fields are HTTP JSON only. Session
custody remains volatile, so no new old-engine refusal test is needed. The
round-3 report enumerates inherited main changes (LB, RX and read-only sessions).
No Darwin execution is claimed; the user will run the fence and wasm measurement.

Linux wasm is **2,135,336 B raw / 645,307 B gzip**, byte-identical to round 3
(SHA-256 in `wasm.json`). The unchanged **645,607 B cap is Linux + 300 B**.
No cap adjustment or device history traversal was needed. Both the focused
build and the full-suite build report this size with locked Binaryen 132.0.0.

## Measurements

Seven serial samples per native corpus, pinned to CPUs recorded in `cpus.json`;
the native measurement process used `19,20,21,52,55,60,65,77`. Other lanes and
full-suite work were on the shared host, so these are observations, not latency
SLOs. Keep every sample, including the first; report medians rather than best
runs. `measurements.json`, `measurements-summary.json` and `core-scale.log` retain
all samples and meters. Storage is accounted frontier/replay custody, not RSS.

| Native reader / corpus | First page median | Later page median | Preparation units | Maximum custody |
|---|---:|---:|---:|---:|
| Metadata / sparse 1,100 | 0.959 ms | 0.969 ms | 0 | 97,924 B |
| Metadata / sparse 50,000 | 1.085 ms | 1.047 ms | 0 | 97,924 B |
| Metadata / 8,200 follows | 200.704 ms | 0.834 ms | 5 | 17,087,232 B |
| Shaped / sparse 1,100 | 1.508 ms | 1.469 ms | 0 | 299,636 B |
| Shaped / sparse 50,000 | 1.635 ms | 1.556 ms | 0 | 299,636 B |
| Shaped / 8,200 follows | 199.656 ms | 1.333 ms | 5 | 17,288,752 B |

Both sparse corpora exhaust the same 1,101 events with identical traversal work
and storage despite the unrelated post population. Every request asserts all
seven ceilings; sessions are reclaimed afterward. Metadata custody is unchanged
from round 3. Shaped custody grows by 960 B for the added ordering metadata in
the two retained page responses; this is volatile memory, not persisted data.
The first native page includes opening/preparation time. Initial registration
is separately metered and is not counted as a preparation unit.

Fresh HTTP/SDK displayed first pages: **35.95 ms sparse 50k**, **1,329.90 ms
8,200 follows**; zero/six preparation replies and one opening RPC each. The five
later-page observations range **29.87–50.09 ms** and **30.19–66.23 ms**, respectively.
Preparation responses remain 95 B; ordinary page replies are 6,040–6,140 B.
These are separate developer-CLI/client measurements, not native optimized-test
latencies. See `http-measurements.log`. The earlier D0 and round-3 reports retain
the original sparse global-reader failure and previous measurements.

## Verification

Focused final checks:

- Core Following: **27 passed**, including both explicitly enabled scale tests.
- Language history/shaping: **10 passed**; independent research/reproduction:
  **3 passed**, including both normally ignored cases; guide: **113 passed**.
- Serve: **190 passed, 4 existing ignored**, including the new HTTP test and
  read-only barrier matrix. The standalone CLI was built first.
- Both client Following files: **16 passed**, one manual measurement skipped
  in the normal run and then explicitly run/passed separately. This final run
  uses the staged-publication, retained-copy and witness-fragment changes.
- Read-only client files: **118 passed, 1 configured published-engine skip**.
- Client build/typecheck and reference audit passed (531 LLPs, 10,501 refs).
- The separate root inventory command exits 1 with **exactly the same 7,320 B
  output as round 3**: inherited Snapback 1 generated/guide prerequisites and
  capability-index budget. No new inventory signature; no repair outside the
  Snapback 4 fence. `inventories-comparison.json` records the comparison.

The complete **`bash scripts/test.sh` passed: zero failures in 2,608 seconds**.
Native inventory: **310 binaries / 1,023 executions**. All **340 client files**
passed (**6,614 tests, 56 declared skips**), followed by both serial model files
(**79 passed, no skips**). Doctests, release guard, package/app typechecks,
fixture wrappers and wasm passed. The known native-witness `/proc` inspection
flake (`20261004-snapback4-native-witness-proc-group-inspection`) **did not occur**;
no new full-suite failure occurred either. No guard or timeout was weakened.
See `full-suite.log.gz`, `full-suite.run.json` and `qualification.json`.

After that full run, final review found the separate 128-field witness-input
boundary. Only the dedicated Following SDK partitioner and its test changed:
field names now split into bounded witness fragments. The final affected rerun
passes **17 client Following tests**, with the manual measurement declared skip;
client build/typecheck and the delivery-await classification check also pass.
No shared client, native, route, guide or wasm implementation changed after the
full run. `full-suite-source-sha256.json` preserves its inputs;
`source-sha256.json` records the final inputs. The full run is not claimed to
include that subsequently added regression.

The published-engine/Darwin skips retain their prerequisites; they are not
counted as executed compatibility evidence. Peak observed worktree use was
**22 GiB** rounded, below 50 GB. No push or remote-host use.

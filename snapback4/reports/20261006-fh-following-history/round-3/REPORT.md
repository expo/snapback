# FH round 3: review fixes and integration

Round 3 follows round 2 (`8d984b4f90`) and merges `origin/main` at
`2a5fc454aa`, preserving both parents (no rebase). Work stays on eb1000,
`sb4-intent/fh-following-history`; no push, publication, remote host or other
worktree changes. Tests and measurements use CPU affinity. The full merged-tree script completed
in **3,087 seconds**; its one guide-budget failure was fixed and the complete
113-test guide target passed afterward. No unresolved introduced failure remains.

## Review disposition and implementation

The supplied Astra NOT READY review and its full detailed evidence, and Grok
READY WITH CHANGES review, were read. LLP 3000.026 §§9.4/9.11 records their
individual dispositions and the delegated follow-churn ruling.

- **Astra P1 fixed.** The new native regression reproduces the panic on eight
  own posts with 122-byte IDs: the first four-item request has `examined=50`
  and stages three events; the successor has `output_bytes=1024`. See
  `p1-before.log`. The reader now preflights retained output before copying or
  advancing the frontier. A named refusal leaves the token, staged images and
  accounted custody intact. Restoring the allowance recovers the same token;
  replay returns identical pinned bytes. Final reply allocation and checkpoint
  costs are preflighted after authority probes, and publication uses checked
  charges rather than panicking.
- **Astra P2 / Grok required finding closed.** Round 2 already marks a discovery
  slice visiting post-B follows `stalled`. The strict churn-wave assertion stays;
  round 3 proves a completed page wins and a defensive self-edge skip remains
  `preparing`. The mutation API refuses self-follow, so the defensive test models
  an inherited self edge directly in the owned table. Discovery finishes against
  the frozen oracle once additions stop; new follows never enter that domain.
- **Optional oracle improvements delivered.** The independent owned-event scan
  now compares every Event field and checks terminal suffix exhaustion directly.
  A matrix removes or physically purges an actual live owned event after either
  head retention or staging. Retained heads are skipped; revoked staged images
  restart explicitly. No traversal helper is used by this oracle.

### Request-path assertion audit

| Path | Smaller request allowance behavior |
|---|---|
| Retained staged output | Preflight before frontier copy, named refusal, no advancement; exact recovery regression |
| Fork/publication validation | Publication and fork reservations check current heap, examinations, probes, steps and checkpoint writes; tests shrink each retained-state obligation |
| Pinned replay | Actual pinned output and authority cost checked before replay; smaller output refuses, restored allowance returns pinned bytes |
| Projection and card authority `assert!(take(used))` | Immediately preceded by a fixed reservation under the current ledger; the internal Runner's independent LIMIT bounds actual used values, so smaller outer ceilings refuse before executing it |
| Refresh `assert!(take(unit/used))` | Same fixed reservation checks; final refresh output uses checked charging and refuses without touching session custody |
| Lifecycle / simple response | Atomic reservations precede ordered-tree changes; the only response-size debug assertion concerns a fixed control envelope, never retained cards |

The zero-index allowance can still permit staging an already validated head.
That is valid bounded preparation, not a required refusal. Existing discovery
reservation tests cover the no-seek-after-cut rule. Failed reservations keep no
failed charge; completed read work may remain metered on a refused attempt.

## Merge integration

Conflicts preserve both parents' features: Following transport bindings and
read-only startup/scope gates; `matchRead` exports and the Following hook;
FH diagnostics alongside read-only/RX diagnostics; both await classifications;
all JOURNAL and known-flake issue evidence. The await boundary is recomputed
from the merged sources. The Following handler now destructures main's scoped
principal result and defensively refuses read scope, in addition to the outer
guard before body intake. No read allow-list expansion was made.

**Read-only sessions:** every history action (`open`, `unit`, `refresh`, `cancel`)
returns `E_READ_ONLY`. The SDK returns that refusal immediately for an explicit
read-only client or app facade, creates no history observer, and never polls
preparation. A raw read token in an unmarked client gets the same server refusal.
Refused controllers wait for explicit retry instead of letting observation
notifications resume polling. A real-server regression checks no changes in
application rows, idempotency/outbox/action/presence tables or either session
table, and proves a refused cancel cannot consume the full consumer's page.

**`matchRead`:** Following phase states remain a separate protocol type. Ordinary
Read evidence cannot describe stalled preparation, revision restarts, pinned
units, live prepend or ordered omissions without fabricating completeness or
freshness fields. Render Following's phases directly. Its offline `inbox` is the
unchanged ordinary Read and works with `matchRead`; read-only users can query
that inbox normally. The real-server regression renders an ordinary inbox with
`matchRead`. Both guide cards explain this distinction.

## Persisted bytes and compatibility

**FH round-3 delta: none.** No new persisted engine table, schema/IR/catalog
encoding, application row or inbox program/certificate changes. Frontier and
pinned responses remain volatile server custody. No new device traversal.

The **merged main** does carry persisted changes; they are not FH changes:

- LB adds the fail-closed `ListRange` type representation to schema/program/action
  metadata for positive list minima; zero-minimum legacy forms keep their bytes.
- RX adds `ReferenceChain` terms and final-reference keys under the existing
  `rule-reference-v2` capability carrier, preserving old one-hop metadata.
- Read-only sessions add the separate `_read_sessions` auth table, scoped session
  wire metadata and principal-generation revocation linkage. Main carries the
  published-engine read-token refusal/downgrade tests. The closed route guard
  remains unchanged by FH.

PK chooses keys using existing Get/Exists/write/probe forms; successful legacy
selections preserve their prior serialized explanation strings. RM and PD are
client changes, and HR adds headless identity registration without a new schema
or device encoding. See the merged lanes' reports for their compatibility evidence.
The existing compatibility controls are retained. The user will run the Darwin
fence, including the published native-engine/device cases, on the mini. This
report makes no macOS execution claim.

## Wasm and verification

Linux wasm: **2,135,336 B raw / 645,307 B gzip** with locked Binaryen 132.0.0.
Cap: **645,607 B = Linux + 300 B**, up 43 B from merged main's 645,564 B cap.
This preserves the requested macOS allowance even though Linux fits under the
old cap. See `wasm.json` for the artifact SHA-256 and `wasm-first.log`.

Focused engine tests: **25 passed**, followed by both explicitly invoked scale
tests. Focused client journeys: **11 passed**, one manual measurement skipped.
The final read-only regression passes after refusal-poll suppression. Package
and app typechecks/builds pass, as do the release guard, fixture wrappers and
reference audit (531 LLPs, 10,501 refs). The corrected native CLI is rebuilt.

The merged full script ran **310 native binaries / 1,023 executions**, with the
one guide-budget failure listed below; workspace doctests passed. Its client
phase ran **340 files: 6,609 passed, zero failed, 56 declared skips**. Both full-count model files passed: **79 tests, zero failures or skips**. The
script exited 1 for the original guide failure; this report does not call that
invocation a zero-failure run. The affected rerun proves the correction.
[Full raw execution](full-suite.log.gz), [qualification summary](qualification.json),
[guide rerun](guide-rerun.log), [final native build](native-final-build.log).

Skips include seven published 0.2.33 Darwin schema/device fences; three RX
published 0.4.13 upgrade/refusal cases requiring `RX_PUBLISHED_ROOT`; the
read-session old-engine roundtrip requiring `SNAPBACK4_PREVIOUS_PUBLISHED_BIN`;
and the existing manual/platform witnesses. No skipped published or Darwin
case is claimed as executed here. Main's lane reports retain their earlier
published qualification; this run retains their tests unchanged.


## Merged-tree measurements

Seven runs per corpus, `taskset -c 7,15`, separately sampled at 0.50% busy each
before execution. These are engine timings including registration, discovery,
card shaping and publication; oracle scans are outside timed intervals. Later
page numbers are the median of the seven within-run medians. This is a shared
host, so the samples do not claim host isolation or an HTTP latency SLO. The
round-2 report retains the separate HTTP/SDK measurements.

| Reader / corpus | First page median | Preparing units | Later page median | Maximum retained custody | Events |
|---|---:|---:|---:|---:|---:|
| Metadata / 1,100 posts | 0.998 ms | 0 | 0.988 ms | 97,924 B | 1,101 |
| Metadata / 50,000 posts | 1.306 ms | 0 | 1.170 ms | 97,924 B | 1,101 |
| Metadata / 8,200 follows | 254.681 ms | 5 | 1.197 ms | 17,087,232 B | 8,200 |
| Shaped cards / 1,100 posts | 1.498 ms | 0 | 1.493 ms | 298,676 B | 1,101 |
| Shaped cards / 50,000 posts | 2.495 ms | 0 | 2.403 ms | 298,676 B | 1,101 |
| Shaped cards / 8,200 follows | 216.393 ms | 5 | 1.364 ms | 17,287,792 B | 8,200 |

Adding 48,900 unrelated posts changes no first/last/total work meter,
preparation count or accounted custody. The corpus includes about 1,000 users
and an extra repost. Every request asserts all seven meter ceilings; each full
traversal matches the independent oracle and reclaims all custody afterward.
The two explicit scale tests pass. `measurements.json` retains every sample,
opening/first/last/total ledger and byte maximum; `measurements-summary.json`
contains the table inputs. Custody is volatile (zero frontier disk storage),
priced separately from the source store and process/SQLite RSS.


## Failure record (full script and final affected reruns)

- The merged client guide initially contained 1,201 words. The full suite's
  `snapback4-lang::guide` target failed only
  `client::existence_card_and_starters_teach_the_sdk_words` (112 passed, one
  failed). This was an introduced merge integration error, not the `/proc`
  flake. Removing the redundant joining word restores the 1,200-word budget
  while retaining Following and `matchRead`. The entire guide target then
  passed **113/113** (`guide-rerun.log`). No gate or test expectation was relaxed.
- Root `scripts/check-inventories.mjs` remains red with **byte-identical** output
  to round 2: legacy Snapback 1 generated-fixture/source gaps, diagnostics/guide
  inventory drift and its capability-card size budget. These inputs are outside
  the Snapback 4 fence. See `inventories-comparison.json` and
  `root-inventories.log`; this is separate from the Snapback 4 full script.

- The known `20261004-snapback4-native-witness-proc-group-inspection` flake did
  **not recur** in this run. The CLI target passed 327 tests (four existing
  ignores), lifecycle passed 27, witness passed 32, and all client files passed.
  No process inspection, group ownership check, timeout or cleanup guard was
  weakened. The inherited issue remains open; passing here does not close it.


## Delivery

Report, JOURNAL entry, approved LLP updates, guides, tests and code are committed
together with the two-parent merge. `merge-inputs.json` pins the exact parents;
`source-sha256.json` records 195 changed source/test/contract inputs. Final source
hashes and wasm identity matched the qualification records. Peak observed
worktree use was **22 GiB rounded**, below 50 GB. No pushes, other hosts,
other worktrees, or unrelated process changes.

The root inventory failure is inherited and separately disclosed above. The
Darwin and explicitly configured published-binary skips remain for the operator's
qualification; this merge adds no FH persisted bytes or new capability fence.

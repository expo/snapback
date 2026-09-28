# Lane OS — round 1, ordinary mixed search

**SDK composition implemented and exercised through public clients and mounted
React. The unchanged wasm budget remains red.** Nothing is pushed
or published. [Round 0](./ROUND0.md) preserves the previous report and failure
ledger; its evidence remains in this directory. Round 1 logs are under `round1/`.

First ran `git fetch origin && git merge origin/main`: `Already up to date.`
Read the binding lane prompt, round-0 report/journal, all of LLP 3000.028,
Snapback 4's fence, root/design brief, exclusions, rules and current search guide.
Applied the read-only `llp-orient` skill from the populated `lane-a5` copy.
The governing constraints are LLP 3000.028 §3.3/§7.2, LLP 3000.024's compact
opening/drain Decision, and the existing local publication fences. No other
lane or evidence store was changed. No tool was installed.

## Delivered behavior

**Deliberate behavior change, retained from round 0:** the bare membership-audience
word search changes from an empty incomplete server answer to the compact
membership page. Explicit membership queries and guarded operations keep their
meaning. The original builder program and original query IR remain controls.

The compiler now describes the proved bare single word page with a literal
limit, word/cursor arguments and a time/integer plus ID order. The SDK coordinator
uses that descriptor; Rust still evaluates the query, filters, tombstones,
expiry and retained authority. Per-chat `searchChat` is explicitly authored
without a membership guard in the builder-program fixture.

Online, the device scan includes only certified `Left` scopes; the original
server operation supplies current scopes. Rejoined scopes never qualify as
`Left`. The SDK orders the two streams, deduplicates, then applies the limit.
It makes one server invocation per requested page. Opening refusals remain
authoritative; a missing constituent head cannot establish a global prefix.
A drain cut ends the attempt without a refill request, preserving its cut and
incompleteness even if retained rows fill the result.

The combined cursor contains two **consumed** positions. It never advances to
an unconsumed response's `next`. Unconsumed hits are discarded, then recomputed
and charged on a later requested page. No row buffer, cursor registry or durable
search session survives the call. The token is limited to 4,096 encoded bytes
and binds query/arguments, viewer, generation, order, link revision and a digest
of device incarnation/acquisition state. Only emitted row keys enter source
positions. A changed binding restarts the observation; a fresh coordinator can
resume compatible positions without having retained the previous response.

**Budget source: the existing device `Ceilings::default()` per-page read
allowance.** `search_state` starts the ledger, reserves retained-state decoding,
and exports its receipt. Cursor/argument work is prepaid; the Rust scan resumes
those counters; the SDK then resumes the scan's receipt. The final state check
resumes that same receipt.
Comparisons, deduplication, streamed server decoding, retained buffers, output
and cursor construction use that same ledger. Server work retains its separate,
unchanged invocation meter. Coordinator exhaustion refuses `E_BOUND`.

The coordinator reobserves device state after delivery and retains the existing
identity, prediction and expiry fences. The complete authorized membership
opening exports bounded scope keys, reserved and serialized directly under the
server meter. The coordinator decodes and compares these keys on the shared
ledger, requiring the server set and the device's Left set to be disjoint.
An unsynced rejoin with overlap returns loading until sync updates the device;
unrelated commits do not block the merge. Older devices explicitly refuse the
new internal composition call. A server missing the scope proof cannot publish
a mixed result. Offline the ordinary body retains its current/retained scan.

## Acceptance matrix

| §7.2 requirement | Evidence and limit |
| --- | --- |
| u0500 / coffee, online and offline | The full builder-copy harness compares current online pages with original `searchNewest`, and offline pages with `searchHeld`. Process and wasm each traverse 10,014 independently enumerated IDs in 501 combined pages, exactly one server query per page and no duplicate or omitted ID. |
| Retained dominates page one | Process and wasm real-device tests fetch 20 server hits, emit 20 newer retained rows, and assert the server consumed position remains null. All 65 independently enumerated fixture IDs appear exactly once over the traversal, including a cross-source timestamp tie with BMP/astral Unicode IDs (Rust-compatible order). Both full builder-copy traversals also pass this condition: 20 retained rows emitted after 20 server hits were fetched, and no server position consumed. |
| One server invocation / mixed drain | A real server with 4,077 live dense scopes reaches a default-meter drain cut after opening. Each requested combined page makes exactly one invocation. Retained rows fill page one while preserving `cut: meter` and `complete: false`; subsequent requests recompute the unconsumed server prefix. The full builder copy also passes: 245 added current chats × 32 word variants produce a real meter cut; two requested mixed pages each make one invocation, first emitting 20 retained rows with the server position still null. A separate SDK cut-stream test traverses every ID exactly once with three-hit constituent cuts. |
| Shared ledger | Both real devices receive prepaid coordinator counters and return increased scan receipts. A near-full prepaid heap prevents the device scan from returning rows. The SDK seam proves decoding fits alone but refuses after a nearly exhausted scan; lowering a receipt is refused. |
| Membership during delivery | A held server reply is released after completed leave sync; it is withdrawn with no second server invocation. A subsequent requested observation replans. |
| Link change during pagination | A combined cursor restarts on the offline coverage domain; returning online uses the current binding. |
| State reset / lost coordinator state | Both real device tiers execute `clear_rows` during a held response, withdraw it with one invocation, reacquire and restart the old cursor on current data. SDK epoch-reset delivery is also withheld. Fresh coordinator instances resume unconsumed hits without buffers. Process and wasm close/reopen tests traverse all 65 IDs exactly once across the restart. |
| Retained edits and expiry | A post-leave server edit does not replace the retained delivered image. An expiry crossed while a real response is held withdraws that response, makes no extra invocation, and a later query excludes the expired ID. |
| Rejoin | A rejoin not yet synced cannot merge a stale retained match; it returns loading. After sync, current server data wins, the retained lane excludes that scope, and incompatible continuation restarts. |
| `searchChat` floor matrix | The full builder fixture uses the exact unguarded body. Current/departed × online/offline, tokens below/exactly at/above the full ordinal/ID acquisition floor, coffee pagination, whole empty group and rejoin are exercised on process and wasm. |
| Guarded control | Original `searchIn` still returns `NOT_MEMBER` after departure on server and both device link states. No guard is removed. |
| Empty needles / unsupported audiences | Existing browse/variant control and excluded-audience tests remain. SDK composition only selects a nonempty word branch; explicit membership, guarded and held programs have no descriptor. |
| Mounted React transition | **Pass.** The existing Vite/headless Chromium harness mounts `useQuery` over a real wasm local client: current online → departed online → offline → rejoin. One unchanged operation retains images, renders “Results may be incomplete”, then replaces the edited retained match after rejoin. Expo is not separately witnessed. |

## Qualification

- Final focused JS: **22/22** cases, including real process/wasm traversal,
  cuts, ledger exhaustion, two real reset cases and mounted React.
  Log: `acceptance-publication.log`; earlier targeted passes are also retained.
- Final affected Rust: **10/10** ordinary search (including bounded authorized
  audience proof), **24/24** membership search, **11/11** search merge.
  Log: `affected-qualified.log`.
- Whole guide: **92 passed, 0 failed**, including a final pass after the guide
  and membership-proof change. Log: `whole-guide-final.log`.
- Full builder: process and wasm each pass **501 pages / 10,014 unique IDs**,
  including 24 acquired retained coffee hits; first page emits 20 retained hits
  while all 20 fetched server hits remain unconsumed. All 50 `searchChat` reads
  pass the floor/current/departed/link/rejoin matrix. Full evidence:
  `u0500/builder-search.jsonl`, final `finished: pass: true`.
- Builder-program drain: **2/2 requested mixed pages pass** under default
  ceilings, each with one invocation; `builder-drain.jsonl` ends in `pass: true`.
- Required `scripts/test.sh` ran **once**, exact summary:
  **`== 1 failure(s) in 1816 s`**. The only failed step is **`wasm build` (ours)**.
  All other steps pass, including Rust, client tests (**3,864 pass / 10 skip**)
  and models (**79 pass**). No baseline or environmental suite failure.
- Original input hashes, including SQLite/WAL, are rechecked after all work.
  Final reference audit and diff checks pass; logs are committed with this report.

The single suite started before final membership-proof, retained-state ledger
and expiry-retry changes. Final focused Rust/JS/guide checks qualify these
changes separately. The full builder run predates only the server proof's
smaller direct-serialization reservation, the state's explicit output-bound
refusal, Unicode tie handling and final publication-marker handling. Final
targeted tests cover these refinements.
The builder drain runs on the direct-serialization version. The historical suite
is not a claim that every final source byte was rerun in that invocation.

## Costs and limits

Final wasm: **2,044,274 B raw / 593,309 B gzip**. Round 0 was
2,019,815 B raw / 585,378 B gzip: **+24,459 B raw / +7,931 B gzip**.
The unchanged cap is **586,193 B**, so this is **7,116 B over budget (ours)**.
No budget was raised. `wasm-final-bound.log` is the final device-feature build.
The additional device bytes implement compiled composition metadata, retained-only scanning,
ledger resumption, state proof/decoding and its internal call protocol. The
server-only audience opening and TypeScript coordinator are not wasm code.
The suite's earlier wasm was 2,041,667 B raw / 592,533 B gzip, also over cap.

Round 1 adds a compiler execution descriptor, the certified-Left scan filter,
a meter continuation bridge and the SDK coordinator. It adds no schema index,
synced row or durable cursor state beyond round 0. Every resumed page repeats
server work from its consumed position; the local scan also repeats under its
existing allowance. Its device-state binding intentionally invalidates more
broadly than membership alone. The cursor is live, not a cross-page snapshot;
refresh restarts ordering after edits. Expo and the full RFC's broader §6/§8
measurements remain outside this round's qualification.

## Every failure

The final successes do not erase the following retained logs:

- **Ours, compilation:** first build named the runner's store `rows` and treated
  a `ColumnType` as a wrapped column. The next build needed the guarded-store
  forwarding method. The next needed mutable device access for `search_state`.
  One TypeScript build needed an explicitly optional `seq` value; the audience
  proof first imported `MeterKind` through its private module path. Corrected.
- **Ours, fixture setup:** the first JS test had a missing object brace; the
  next fixture lacked the membership insert grant proof; then its seed entries
  needed `{table, row}` envelopes. Descriptor diagnostics first omitted the
  persona header. Corrected; all failed logs are retained.
- **Ours, descriptor restriction:** the initial descriptor did not recognize
  the compiler's equality prefix and explicit trailing ID. Until corrected,
  tests exercised old routing, producing three traversal/lifecycle failures
  and two explicit descriptor diagnostic failures. The descriptor now follows
  the proved scan prefix and accepts the actual time/ID suffix.
- **Ours, test expectations:** the first synthetic cut stream incorrectly
  marked its terminal page incomplete without a safe next; withholding it was
  correct. The first real drain expectation omitted retained rows interleaved
  on page two. Both expectations now use the correct source semantics.
- **Ours, harness:** the first full-store traversal parked `/changes` without
  heartbeat bytes. The silence watchdog changed the link after 68 successful
  mixed pages. The harness now uses the repository's heartbeat helper. The
  original run is retained under `round1/u0500-silence-watchdog/`.
- **Ours, build sequencing:** a subsequent qualification launched process
  clients before the queued native build containing the watermark fence
  finished. Six real-device tests and the full-store first mixed page returned
  loading; wasm already had the new field. Final checks await the native build.
  The full-store failure remains under `round1/u0500-before-native-fence-build/`.
- **Ours, first rejoin fence:** after the native build was corrected, two
  full-builder attempts still returned loading at mixed page zero. Re-syncing
  after the oracle did not help: ongoing background commits kept the server
  head ahead. `watermark-diagnostic.log` reproduces this with successful sync.
  Replaced the global watermark condition with the bounded authorized audience
  proof. The completed full builder run passes all 1,002 combined pages.
- **Ours, proof reservations / drain setup:** synchronizing 4,076 added dense
  scopes exhausted the shared metadata allowance before dispatch. These new
  current scopes need not be acquired; removed that harness sync. The first
  audience proof used excessive JSON-tree reservations and correctly refused
  `E_SEARCH_OPEN` at 4,077 scopes; a diagnostic assertion exposes the refusal.
  Direct, preallocated plain serialization now fits, and the same real drain
  test passes under unchanged ceilings. Failed/repeated runs are retained as
  `mixed-final-proof`, `mixed-final`, `mixed-completed` and `drain-proof-diagnostic`.
- **Ours, builder drain calibration:** 4,030 added dense scopes on the builder
  schema hit the heap opening refusal before draining. The control correctly
  returned `E_SEARCH_OPEN`. Replaced this stress shape with 245 scopes × 32
  word variants, which opens within the same envelope and produces a real
  drain cut. Both combined-page assertions pass; the original failed probe
  remains in `builder-drain-many-scopes.*`.
- **Ours, mounted harness:** the first Vite attempt omitted React JSX-runtime
  aliases; the next recreated the operation reference on every render, causing
  React's update-depth error. Both harness defects are fixed. The mounted
  current/departed/offline/rejoin test passes in 1.65 seconds.
- **Ours, wasm budget:** every changed wasm build exceeded the unchanged cap.
  The budget is not raised; the final size and full-suite classification above
  remain explicit failures.
- **Ours, inspection commands:** several early reads guessed absent paths;
  several edit commands used a duplicated worktree prefix and changed nothing.
  Discovery/working directory corrections followed. No installation, secret
  copy or shared-path edit occurred.

The full-suite failure classification is exhaustive: **ours — wasm build;
baseline — none; environmental — none**. Earlier development failures above
are also ours. Historical round-0 failures remain in `ROUND0.md`.

## Reproduction

From `snapback4/`, build the native binary, wasm and client in that order; the
wasm budget command reports the overrun. Run the focused files
`ordinary-search.test.mjs` and `ordinary-search-ledger.test.mjs`, Rust
`cargo test -p snapback4-sim --test ordinary_search`, and the whole guide.
`OS_FLOOR_U0500=1 node experiments/p19-one-query/ordinary-search.mjs` creates a
fresh lane-owned copy under `.work/os-r1-u0500`; move only that prior run's
copy aside before repeating. Then
`node experiments/p19-one-query/ordinary-search-drain.mjs` makes a second copy
and exercises the builder-specific drain; its `.work/os-r1-builder-drain` must
also be moved aside before a repeat. The original evidence store is never opened
by SQLite. `verify-inputs.py` guards the original program/database/WAL hashes.

All log and JSONL artifacts in `round1/` are stored with `.gz` suffixes; use
`gzip -dc` to inspect them. Filenames above omit that compression suffix.

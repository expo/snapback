# QJ — jump to a quoted message

**Round 1:** [settling and durable browser evidence](round1/REPORT.md) supersedes
the scrolling/oracle details below. This page retains the round-0 design and
full-suite qualification record.

2026-10-07 · eb1000 · branch `sb4-intent/qj-quote-jump` · commit only, no push.
Base: `8e530ff2419387cb97ff841b4a2aa8b7828c7229` (`origin/main` at lane creation).

## Result and design

The installed social starter now offers Reply and renders its saved `replyTo`
through `QuotedMessage`. Tapping a present, settled quote opens the original's
history window, scrolls it into view and highlights it for 1.8 seconds. The
composer remains the same mounted input with the same draft. The change addresses
calibration #31, m3-a11 / d-02: mounting the original is insufficient; the test
must prove its position inside the viewport.

`history` and `messageReceipts` accept an optional `through` ordinal. Quarry
selects the existing unique `(conversation, ordinal)` index with an upper bound
and `last 20`; no cursor is invented. A distant jump requests one window ending
at the original instead of walking every intervening page. If the target is
already loaded, the hook keeps that window. Latest messages restores the newest
window. Online reads reach outside the replica horizon; offline unknown coverage
remains uncertain.

The 69-line `useJumpToMessage` owns only an ordinal, IDs, visibility and timing.
`usePage` owns current bodies and cursor chains. One FlatList owns the transcript,
with variable-height `scrollToIndex` and `onScrollToIndexFailed`: approach an
estimated offset and retry against measured cells. The attempt has a four-second
monotonic deadline. Visibility starts the highlight, not mounting or dispatching
a scroll call. Short rows must fit; a row taller than the viewport must fill it.
A failed attempt has a visible notice and an explicit retry path.

`matchRead` renders loading, partial, absent, denied and present quotes. Absent
shows “Quoted message unavailable”; denied hides it. Neither can jump. Pending
and revalidating previews disable the action. No previous quote body is saved.
The starter still has no message-expiry feature; an extended schema's expired
point read follows the same absent/denied/unknown handling.

Reply selection is an ID owned beside the existing draft and once viewer. It
travels through the existing saved-send journal; the SDK remains the only outbox.
The server checks that a selected original is readable and belongs to the same
conversation. Original route identity, membership/send policy, retained history,
receipt independence, media ownership and account/backend reset rules remain.
History and receipt page chains use the same query bound/index and join current
answers by message ID. If receipts withdraw during paging, their chain catches
up to the retained history length after recovery. Hard withdrawal unmounts the list while preserving the
composer and once viewer.

## Governing context and documentation

Read the Snapback 4 fence, NOT-DOING, journal, LLP 3000 and LLP 2000.000; applied
`llp-orient` to the social starter and its @refs. The governing working-set
constraints are LLP 3000.028 §8 (recipe and composer/media ownership), LLP
3000.023 §§10,13 (retention and bounded ownership), and LLP 3000.031 §§7–8 (honest
existence and matchRead). No SDK contract, engine ceiling or wasm source changes.
LLP 3000.028 §8 records the application-level decision. Both `guide social` and
the installed README now teach “Jump to a quoted message”; the guide embeds the
actual hook and component, checked against the installed files and generated API.
The social card renders 733 lines. The eight budgeted reference cards and their
limits are unchanged.

## Verification

The new browser witness bundles the installed starter with real
`react-native-web@0.21.2`, the template's supported 0.21 series. This is a pinned
workspace **test** dependency. It uses real generated operations and HTTP,
separately with the online client and wasm replica. Tests cover:

- original + 30 intervening messages + reply; the original starts outside the
  loaded page, then its bubble bounds lie within both list and browser viewports
  and its computed background is highlighted within four seconds;
- an already visible original, unchanged list position, and highlight removal;
- an absent original with unavailable text, no action and no list movement;
- draft text and DOM node identity across the jump and return to latest;
- 530 intervening messages, beyond the 500-row sync horizon, reached by an
  ordinal-bounded read without cursor walking;
- the Reply/Send UI writing the original ID;
- an already loaded but offscreen original, including a forced unmeasured-index
  failure followed by a successful offset/retry;
- a negative control blocking both scroll methods: no highlight, a four-second
  timeout, preserved draft, and a successful explicit retry after unblocking.

Native-process and wasm-device tests exercise the identical anchored query,
receipt cursor agreement, offline held windows and unacquired history without a
false absence. The existing controlled quote witness also exercises `onJump`,
no action for unknown/denied/absent reads, and disabled revalidation.

Native UI scrolling uses the shared FlatList interface and typechecks against
React Native. This Linux-only lane does not claim an iOS/Android simulator run.

The final social/read affected run passed **69 tests**, with zero failures/skips,
including all social starter/browser cases, the quote witness and `matchRead`. Client
typecheck passed. The pinned receipt model suite passed **211 tests**; the guide
passed **113 tests**, including the final full-suite execution. `ref-check --verbose` reported 530 LLP documents, 10,455 references,
zero errors and zero unchecked references. The complete screen-lifetime file also
passed **16 tests**, and the frozen compatibility inventory passed its one case
after the fixture corrections below. Logs retain all results.

The full suite ran with `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`, `CARGO_INCREMENTAL=0`
and eight Cargo build jobs. For the shared host, it used 24 CPUs of affinity,
six Rust test processes and four test threads per process; the unchanged suite
selected eight client-file slots from that affinity. No counts or hang guards
were reduced. From the repository root, the full command is:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT \
CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0 \
CARGO_BUILD_JOBS=8 SNAPBACK4_RUST_TEST_PROCESSES=6 RUST_TEST_THREADS=4 \
taskset -c 48-71 bash snapback4/scripts/test.sh
```

The final complete script exited **0**, with **0 failures in 2,748 seconds**:

| Stage | Result |
| --- | --- |
| Rust workspace | 5,120 passed; 33 declared ignores |
| Client files | 329/329 passed; 6,499 tests passed; 54 declared skips |
| Seeded client models | 2/2 files, 79 tests passed; original 5,000-sequence counts retained |
| Fixture wrappers | 9 tests passed |
| Other stages | Build, wasm, docs budget, release guard, package/client and both app typechecks passed |

`full-suite.log.gz` is the complete qualifying output; `full-suite.exit` is `0`.
The final 30-intervening-message browser witness measured **126.9 ms online**
and **130.3 ms with the wasm replica**, each within the 4,000 ms assertion bound.
In both, the bubble was at **192–256 px** inside a **192–752 px** list viewport
and highlighted with `rgb(255, 232, 154)`. These are observed run measurements,
not a cross-device latency guarantee.

The independent screen-lifetime rerun passed 16/16 and the worker-regression
check passed 77/77. The latter's long quiet interval is the already-recorded
fixture overhead in `issues/20261002-snapback4-worker-refusal-tests-wait-entire-hang-guard.md`;
its cases and bounds remain unchanged.

Final checkout disk use is **15.24 GB (14.19 GiB)**, below the requested 30 GB.
No other worktree or host was used. Nothing was pushed or published.

The suite's wasm rebuild is byte-identical to the pre-change build, including
all generated bindings. Device SHA-256:
`a4c6b4a8a7e76d81df9f424899f474863ce23cf232c0e4162861cc1333a3ec83`.
The canonical `build-wasm.sh` measurement remains **2,135,164 B raw / 645,264 B gzip**, under the unchanged 645,564 B
budget. `wasm-before.txt` records each artifact's baseline digest;
`wasm-final.txt` verifies all four generated artifacts against those hashes.

## Development findings

The existing DOM substitute for FlatList was insufficient evidence for the
calibration failure. The real RN-web witness checks rectangles and includes an
actually offscreen loaded target, so disabling scrolling fails that oracle.
Early nonqualifying runs exposed fixture setup mistakes (a bare online bearer
had no viewer for the screen; the web root needed a bounded flex container;
wire query arguments have an `args` envelope), plus a render-loop issue from
allocating a new empty list on every loading render. The hook now shares its
empty array and suppresses unchanged visibility updates. The old receipt fixture
now provides continuation on both independent SDK page reads. The list still
unmounts on hard withdrawal, preserving the existing once-media remount witness.
Earlier logs are retained separately from the final qualification logs.

The receipt suite initially failed 13 of 211 cases because it used the evolving
social schema as input to exact-source transformations, fixed row-shape oracles
and already-frozen wasm corpora. Its declarative model now reads
`tests/fixtures/receipts/social.q`, byte-identical to the starter at the lane's
base commit (SHA-256 `2d0a020719004f5b3572a7673616d8b6c2d94be1cca9685a263422ba3f6681b4`).
No oracle, corpus record, work count or assertion was weakened or regenerated.
`starter_compiles_and_rejects_owned_progress_and_unallocated_reports` still reads
the **current** starter, and the new browser/native/wasm witnesses exercise its
actual reply/window operations. This separates the stable engine model from the
application's evolving schema; `guide-and-receipts.log.gz` retains the initial red.

The first full run also caught this new snapshot in the top-level `.q` fixture
inventory used by the unrelated frozen ephemeral-compatibility test. Moving it
to `fixtures/receipts/` preserves that original inventory and all expectations.
During that run the shared filesystem reached zero free bytes while this
worktree occupied about 13 GiB. Fourteen Rust cases failed with SQLite `DiskFull`
or an explicit `No space left on device`; capacity recovered without cleanup
from this lane. No other worktree or process was altered.

The first full run completed Rust with the 14 storage failures and one fixture
inventory failure above, both app typechecks and nine fixture-wrapper tests;
then 327 of 329 client
files passed. The screen-lifetime fixture stalled because its copied
`Conversation.tsx` lacked the new transitive modules. Its helper now copies
`QuotedMessage`/`useJumpToMessage` and supplies Pressable, preserving all 16
assertion scenarios. The stopped run's active logs are retained; its exit is
143, not a completed whole-suite verdict. The remaining worker-regressions file
had completed four passing cases at interruption; models had not yet run.
Both fixture corrections passed their direct checks before final qualification.

A final ownership review caught the independent receipt chain losing an Older
request while its root was withdrawn. The conversation now requests receipt
continuations until their current length catches up with loaded history. The
existing browser scenario holds the receipt root in loading, pages history,
then restores receipts and requires the older decoration to return. A second
suite invocation was stopped during Rust compilation for this correction;
`full-suite-interrupted-for-receipts.log.gz` records its completed setup phases.

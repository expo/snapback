# Wave 9 MEDIA — fix #16 (NA9/E4)

Branch: `sb4-w9-media`, base `e82bb70b97` (0.4.24). No push or publication.

## Change

Device-owned upload-and-place captures copied bytes, normalized metadata, immutable arguments, a stable intent/execution id, viewer and backend-store binding in one outbox commit. Memory/wasm, IndexedDB (main and Worker hosts), and native SQLite share the state machine. Placement stays held until the durable asset receipt is committed locally. Typed queued/uploading/blocked/placing/cancelling/terminal states expose retry and cancellation. Reload, restart, orphan adoption, lost replies and failed persistence preserve custody; quota and ownership conflicts hold the source suffix.

The asset server declares immutable bytes/metadata/placement before transport, deduplicates owner plus intent under its SQLite transaction, syncs asset files and directory before ledger publication, pins unplaced assets, retains cancellation tombstones, and binds placement/finalization to its ordinary at-most-once execution receipt. Owner-only inventory recovers pins after device-storage loss. WAV, MP3 and FLAC are sniffed file assets.

React and Expo expose `useUpload` and the guarded local-client `uploadAndPlace` capability. Expo `saveAsset` reads authorized bytes and presents a native save/share sheet with private temporary files and cleanup. `packages/snapback4/OFFLINE-UPLOADS.md` specifies the Exact adapter contract; Exact owns its adapter implementation. HAND owns general protocol text, DX owns guide/starter integration, REL owns publication/native release artifacts; one-line pointers preserve lane boundaries.

## Decisions

- IndexedDB stores a bounded byte copy atomically with the outbox value. OPFS adds no required second owner or commit boundary; applications do not own an auxiliary queue. Native SQLite stores the same envelope.
- Limits: 64 MiB per selection, 128 MiB unresolved bytes, 64 KiB other args, 96 KiB total placement metadata; server pins are bounded to 128 MiB per owner. Inventory pages have 50 entries; existing bounded terminal history remains 256.
- Explicit remote cancellation consumes its original authenticated request/body through owner retirement; outbox waits remain cancellable and late responses cannot release custody.
- Shared receipt checks compare live and terminal input before source acknowledgement; entering shared ownership survives the entire orphan recovery pass.
- Wasm budget: locked Linux 2,270,687 B raw / 689,337 B gzip, cap 689,837 B including inherited 500 B allowance. Increase 9,919 B versus recorded integration cap/baseline; no freshly rebuilt control or Mac measurement and no global runtime-ceiling change.
- RFC status remains Draft; READY reviews do not accept on the author's behalf. Round 6 was an amendment incorporated into round 7, with no fabricated round-6 review.

## Qualification

Implementation commands ran inside this worktree; Cargo checks set `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0` in the invocation. Setup completed with the frozen Bun install, native build, wasm build and client build. The full `scripts/test.sh` was not run.

| Check | Result | Evidence |
| --- | --- | --- |
| `cargo test -p snapback4-core -p snapback4-device -p snapback4 --no-fail-fast` | PASS: 3,286 passed, 20 ignored, 192 targets; exit 0 | `cargo-all-quality.log` |
| Final memory/SQLite upload custody | PASS: 6 | `device-final.log` |
| Final core asset-intent/adoption/metadata bounds | PASS: 7 | `core-bounds-final.log` |
| Affected ephemeral core and HTTP tests after adoption guard | PASS: 16 core ephemeral + 18 HTTP/CLI | `ephemeral-core-final.log`, `ephemeral-cli-final.log` |
| Client build and Expo TypeScript | PASS | `client-final-adoption.log`, `expo-typecheck-final.log` |
| Delivery fault matrix + await census | PASS: 441 tests, 213 explicitly classified delivery awaits | `delivery-matrix-final-adoption.log` |
| Media intent/hook/Expo helper + Chromium tests | PASS: 24, including main-thread and Worker adverse receipt/history recovery | `media-final.log` |
| Asset suite, Expo media storage, Chromium `online-journal-browser` | PASS: 191; one Darwin-only test skipped | `assets-and-journal-final.log` |
| Wasm budget | PASS: 689,337 gzip under 689,837 cap | `wasm-budget-adoption.log` |
| `./ref-check` | PASS: 542 LLPs, 11,028 refs, zero errors/unchecked | `ref-check-final.log` |

The full Rust run started before the final adoption/bounds delta. The affected core and HTTP checks above ran after the guard; the additional metadata-bound core test and final full asset/client checks ran after the bounds patch. Unchanged Rust suites were not repeated. The last changes to wasm-executable device code are included in the measured artifact; later server-only engine/HTTP checks do not alter the web artifact. Client matrix qualification includes the readiness blocked-state patch and faults its failed commit with retained bytes.

## RFC review

The unchanged round-12 contract SHA-256 is `56224d6d23d04e99151efeca793ddb596865862862c0e8cad2f0d70304ff4be5`. Final independent verdicts are [Codex round 12](../../../llp/reviews/3000.038.000-media-round12.sol.md) and [Muse round 12 follow-up](../../../llp/reviews/3000.038.000-media-round12b.muse.md), both READY. All received reviews are saved verbatim under `llp/reviews/`; no absent review is fabricated. Fresh Codex round 12 requested `gpt-6.1-sol` at high effort and is READY. Muse's final follow-up is READY on that same RFC after checking server enforcement of existing limits. The bounds fix strengthens implementation of the already-reviewed contract, so it does not invent a new design revision or require a fresh Codex design review.

## Platform limit and downstream ownership

This Linux host cannot build or execute UIKit's share/save sheet or an Expo simulator. Portable Expo helper tests, Expo TypeScript and both native SQLite custody tests qualify the accessible paths; the iOS UI and rebuilt xcframework need the REL/native platform witness. Exact's adapter and DX's starter integration remain their assigned workstream work. No MEDIA implementation item is deferred.

## Commits

- `6596309959` — docs(media): propose durable device upload-and-place intents
- `a807652aac` — docs(media): close review gaps in custody and cancellation
- `8c261b2f4b` — feat(media): bind uploads to immutable placement and durable asset receipts
- `f35447ae36` — feat(media): put upload dependencies and byte custody in the device outbox
- `2b1b636fb7` — feat(media): expose declared asset intent transport and typed refusal help
- `ec6f21b1db` — fix(media): preserve upload identity across recovery and receipt boundaries
- `905b8720b2` — feat(media): add guarded upload-and-place hooks and Expo asset saving
- `05863df162` — fix(media): preserve ownership through admission and whole-pass recovery
- `aa3fe243e2` — chore(media): record final device wasm cost and preserve platform allowance
- `d1bc34bf76` — test(media): prove upload custody across delivery faults and browser recovery
- `64f7350d3c` — fix(media): settle schema-transition failures and enforce server metadata bounds

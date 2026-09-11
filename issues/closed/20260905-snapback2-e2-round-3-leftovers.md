# Snapback 2 lane E2: residuals after the third review round

Status: Closed — resolved 2026-09-11
Priority: P1 (native witness and custody claims)
Filed: 2026-09-05 (LLP 1013 landing 9; reviews `llp/reviews/`-adjacent record in the orchestrator's state)

Three blind-review rounds (grok 4.6, Muse, codex astra) and two fix rounds; the round limit is
three. What stayed open, each small and bounded:

1. **Device COMMIT-failure recovery is unqualified** (grok M6, astra material). The portable
   conformance runner names its probe honestly (`body-ended transaction rejects and next
   transaction succeeds`); the Node driver's real COMMIT failure is tested in `sqlite.test.ts`.
   Induce an actual COMMIT failure on the pinned Expo SDK 54.0.37 driver while the transaction
   is active; verify no row lands and the next exclusive transaction succeeds.
2. **`client.assetUrl(list)` compacts viewed entries** (grok M3): scalar returns `undefined` for
   a viewed id, the list returns only the mintable ones; `useAssetUrl` preserves positions and
   now declares `(string | undefined)[]`. Decide whether the client list should preserve slots
   too (tested as intentional today).
3. **Derivative file deletes run after the sqlite commit on the file queue, not awaited** (grok
   M4, report deviation): custody fences stop stale serves; a crash in the window leaves
   orphans until the next startup sweep. Acceptable; a next lane that lists the cache directory
   must tolerate transient garbage.
4. **`SESSION_VIEW_LIMIT = 8`** (grok minor): the ninth concurrent view-once viewer drops the
   oldest session. Name the limit in LLP 1012 §9 or lift it.
5. **The Expo Composer never sets `viewOnce`** (grok minor): the column, the predicate, and the
   owner path exist; the template's composer is text-only. A photo/clip composer with a
   view-once toggle is the app's, not the arm's.
6. **HTTP-cache absence on the device is proven by the container scan, not by reading
   URLSession's configuration** (astra material 2, Muse material 3): `expo/fetch` on SDK 54.0.37
   forwards no cache policy; the owner answers every private byte response `no-store` (ordinary
   private assets lose HTTP caching — a performance tradeoff recorded in `asset_http.rs`).
7. **All-private-bytes `no-store`** (Muse material 4): the owner cannot tell an ordinary row
   from a one-use one at the byte endpoint; a delivery proof that carries the policy would
   restore caching for ordinary private media.

8. **Android ordinary-image witness remains unqualified (2026-09-05).** During
   the native memory-video repair, the API 36.1 emulator received the ordinary
   PNG file source but the host timed out awaiting the image's loaded witness.
   The subsequent video-only probe passed actual playback, private-directory
   no-media scanning and reopen denial. Investigate the ordinary image decode
   and onLoad witness before claiming the full Android media run; this is not
   a claim that the native image itself was proven broken.

## Resolution — 2026-09-11

1. The pinned Expo SDK 54.0.37 iOS witness now induces a real SDK-owned
   `COMMIT` failure after the transaction body, proves that no row lands, restores
   WAL, and proves that the next exclusive transaction succeeds (`a8dd702b4`;
   the exact ten-step iOS run passed at `25d7549a7`).
2. The list overload is position-preserving and returns `undefined` in a consumed
   entry's slot. Types, native custody tests, guide text, and LLP 1012 §9 agree
   (`779991dd6`).
3. The transient post-commit derivative orphan is accepted behavior. Custody fences
   prevent serving it, and the next open sweeps it; no synchronous filesystem delete
   was added to SQLite's committed swap.
4. The independent eight-viewer cap was removed. Session blobs now share
   `maxAssetBytes`; LLP 1012 §9 names the sole oversize-mounted exception
   (`63e3b507c`).
5. The text-only template Composer does not own an app's media UI. A future
   app-owned media operation selects the schema's `once` column; no false toggle was
   added to this arm.
6. The native client explicitly sends `Cache-Control: no-store` as a request header,
   including on Expo SDK 54, and focused custody tests observe it. This replaces the
   former inference from a container scan.
7. The owner now distinguishes policy from the supplying row: ordinary private bytes
   answer `private, no-cache` with an ETag and reauthorize before `304`; one-use bytes
   answer `private, no-store`. Real-owner full, range, and conditional controls pin the
   distinction (`779991dd6`).
8. The targeted Android ordinary-image witness passed twice on the exact API 36.1
   Google APIs arm64 image; the final minimal-delta run loaded a private `file://`
   source, retained `viewed: false`, and found the derivative in the app cache.

Android evidence: emulator 36.6.11 (archive SHA-256
`aebcd4dde29a4921d47e5e79b8c1ffece69a70f5b280d8dc7033ebaffa737072`),
AVD `Snapback_API_36_1`, Android 16 fingerprint
`google/sdk_gphone64_arm64/emu64a:16/BE4B.251210.005/14574095:userdebug/dev-keys`,
Java 17.0.20. The headless Apple-silicon emulator required its known platform
workarounds: forced HVF, disabled luma sampling, and a no-history/no-animation launch
to avoid ranchu task-thumbnail readback crashes. The disposable adb-reversed witness
manifest explicitly permits its localhost cleartext HTTP/WebSocket endpoints.

The earlier 1×1 grayscale-alpha PNG was a poor cross-platform native fixture: Android
Fresco explicitly reported `Problem decoding into existing bitmap`. The witness now
uses its existing 4×4 RGBA PNG on both native platforms, ignores empty-source load
events, reports native decode errors, and still requires the materialized private file.

Final evidence hashes:

- `target/e2-witness-android-result.json`:
  `81ec1df218652c922f61d74e853a9323b2846582112a2c1a525ece23735064ea`
- `target/e2-witness-android-build.log`:
  `b56b40b1b657844320a07aa8ca229bcde0e97fce96dc120ebd46180b5663323b`
- release APK:
  `d5d83a060d6946c066acca8a144d6603368909fcbebd09e2c2a5c60db1bd8c78`

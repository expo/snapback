# Snapback 2 lane E2: residuals after the third review round

Status: Open — reconciled 2026-09-11
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

## Reconciliation — 2026-09-11

- 1 remains device-unqualified: the portable probe manufactures a body-ended
  transaction; the mocked Expo unit test is not SDK proof.
- 2 remains intentional-but-undecided: `client.assetUrl(list)` still compacts viewed
  entries while `useAssetUrl` preserves positions.
- 3 remains accepted transient-orphan behavior and constrains future directory sweeps.
- 4 remains: `SESSION_VIEW_LIMIT = 8` is still unnamed in LLP 1012.
- 5 is obsolete as an arm requirement: the shipped composer is text-only; app-owned
  media composer operations can carry `viewOnce`.
- 6 remains an evidence limitation, not proof that URLSession cached bytes.
- 7 remains: current private delivery still answers `no-store` because its proof does
  not identify the supplying row's once policy.
- 8 remains unqualified; this pass did not run an Android emulator.

Next acceptance: run real SDK COMMIT and Android ordinary-image witnesses; decide the
list-slot and eight-session contracts; retain orphan tolerance; and either carry an
exact ordinary-private delivery policy or explicitly accept its no-store cost.

# Cal29 B1–B3 pilot

These are rewrites of the actual builder files, not hypothetical snippets.
The cached source from the CX run at `/tmp/cx-cal29` matches the ledger hashes;
package configuration, generated API and UI components were read from the same
recorded M1 lane over SSH for the temporary typecheck. No source on that host
was modified. The rewritten app is `/tmp/lane-b-cal29` on eb1000, using this
lane’s built client through a local package link. `bun run typecheck` passed.

| Specimen | Before physical lines / UTF-8 bytes | After | Byte delta |
| --- | ---: | ---: | ---: |
| B1 custody call | 1 / 42 | 1 / 152 | +110 |
| B2 fallback renderer fragment | 1 / 238 | 1 / 318 | +80 |
| B3 toggle selection | 1 / 281 | 1 / 283 | +2 |

Measurements exclude each selected excerpt’s final newline, as LLP 3000.032
§2.3 did. Whole minified lines are not reinterpreted as formatted LOC. B1+B2
are 2 lines / 280 B before, 2 / 470 B after. B1–B3 together are 3 / 561 before,
3 / 753 after (+192 B). Full chat.tsx is 46 physical lines, 16,755 → 16,961 B;
social.tsx is 34 physical lines, 6,178 → 6,176 B. Imports and the changed pending
indicator account for the difference from selected-block totals. No global app
savings or score effect is inferred. Full files, exact selected strings and
SHA-256 hashes are under `pilot/`.

Behavior changes:

- Both `send` and `sendMedia` now appear when no mapped row is visible. Empty
  media text receives a label. Arguments never open a media/once handle.
- A terminal receipt retains a `settling` card (“Sent; updating view”) until the
  existing observed-write retirement, with no fabricated ordinal or ticks.
  Predicted rows suppress a duplicate only while visible; withdrawal restores it.
- The set-state selector continues showing the latest admitted intent through
  that same local interval. It reports phase; pre-admission identification is
  excluded from overriding admitted state. Counts still come from the query.
- The existing stable-message reader and its historical identity list are left
  in place; this pilot does not claim to fix that separate lifetime concern.

The selected blocks save **zero physical lines** and grow 192 bytes. The entire
two-file rewrite grows 204 bytes. This helper did not meet the proposal’s initial
100–250-byte reduction target. Its demonstrated gain is shared, tested behavior
for the receipt/observation race and the omitted media path. A future cold-builder
comparison is needed to establish any improvement in builder experience.

# snapback4: `foregroundHint` gives up on `require` statements, so the chat starter's `thread` query is never hinted

**Opened:** 2026-11-03 · **Area:** `snapback4/packages/snapback4/src/local-acquisition.ts` (`foregroundHint`), the chat starter schema · **Status:** open

`foregroundHint` walks a query's body and accepts only `Let` and `Return` statements ("Branches, loops,
counts and other derived shapes have no hint"). A `Require` statement does not change the returned
scan, but it makes the function return `undefined`. The chat starter's own history query starts with
`require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED`, so the conversation a
user opens is never the acquisition hint in the starter, and the walk serves groups in index order
instead (observed in Diary 0124 through a wire trace: the first acquire request carried no hint until
the demo removed the guard). The Exact adapter's Rust port (`exact2/snapback4/client/src/acquisition.rs`)
mirrors the reference and has the same gap.

**Fix shape:** treat `Require` (and any statement that neither binds a name nor returns) as
transparent when deriving the hint; keep refusing branches, loops and counts. Add the starter's
`thread` query to the hint tests. Update the Rust port when the reference changes.

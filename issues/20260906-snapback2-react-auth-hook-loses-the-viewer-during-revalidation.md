# snapback2: after reconnect a child auth hook has no viewer while the parent stays authenticated, so the UI misattributes the viewer's own rows

**Date:** 2026-09-06 · **Area:** snapback2 React arm (auth hook) · **Source:** Clique full run, astra-snapback2 (M8 diary "The hardest UI issue was subtle", essay)

## What happened

After a reconnect, a child component's auth hook briefly reported no viewer while the parent's
hook still reported an authenticated principal. Messages converged correctly, but the UI treated
the viewer's own messages as somebody else's and hid their receipts. The builder found it only by
running a diagnostic copy that printed the actual author and viewer attributes, and fixed it in the
app by "retaining the exact token-bound principal during revalidation" while server revalidation
continued. Its words: "the most elusive issue came later."

An app author should not have to discover that the hook's viewer can flicker to empty during
revalidation. Either the hook keeps the last known principal until revalidation resolves (and
exposes a `revalidating` flag), or the guide says loudly that it does not.

## Proposed

1. Make the auth hook retain the token-bound principal during revalidation and expose the
   revalidation state separately; drop the viewer only on an actual refusal.
2. A React test: reconnect while a child hook is mounted; assert the viewer never reads as absent
   between two authenticated states.
3. Guide note on the auth page about viewer stability across reconnects, with the retry path
   (`20260906-snapback2-guide-gaps-from-the-clique-run.md` already asks for the token-restoration
   retry path).

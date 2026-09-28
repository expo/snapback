# Snapback 4: the social starter's `immutable` rationale and its witness

- **Status:** Open
- **Date:** 2026-09-28
- **Area:** `snapback4/crates/snapback4/src/verbs/init/social/schema.q` (the starter's `immutable` line and comment), `snapback4/packages/snapback4/test/social-browser.test.mjs:451`
- **Found by:** Grok's review of lane EX round 5 (`~/sb4-intent/reviews/ex-r5.grok.md` on the EPYC host), READY with two non-blocking Lows

1. **The comment gives the wrong reason.** It presents scope immutability as what stabilizes the keyset. Under LLP 3000.028 §3.3, `at` being immutable keeps `(at, id)` from moving under edits; `conversation` is immutable because a message never changes chats, and that is what the search admission rule requires. Say both, and point at the search card for the admission rule.
2. **No witness locks the declaration.** Deleting the `immutable` line still yields the same rows in the browser witness, because the starter has no message-update mutation. In the starter smoke, assert that the generated schema keeps `immutable` covering `conversation` and `at`.

# LLP 1018 real browser session diagnostic — 2026-09-07

**Result:** the focused browser session exercise passed on local source
`df959d36a46d34a8963497d7ebaeaf21de296f4d` plus this commit's witness changes.
This is an engineering diagnostic on a source build, not a published-package
qualification, a cold-builder result, formal M7, or completion of LLP 1018.

The existing `snapback2/scripts/witness-web.mjs --sessions --keep` ran the
ordinary React chat template against the real Rust owner, using headless
Google Chrome 152.0.7977.76, actual IndexedDB, and actual Web Locks. The runner
used Node 24.18.0; the private package bundle was built with Node 22.23.2.
The owner was built at the same product source in the warm survivor-uniqueness
lane and linked read-only into the browser lane; its sibling media helper was
also linked (no media behavior was exercised).

## Observed results

- Two ordinary `client.subscribe` consumers received identical data through
  one logical `/api/live/control` child. Closing one retained the other;
  closing both released the shared entry (consumer counts 2 → 1 → 0).
- A second actual page rendered the chat template's live thread. Its attempted
  mutation refused `E_OFFLINE_FOLLOWER`; no mutation request left that page.
- After an operation-specific readiness check, the writer's owner transport
  was cut and two posts were durably queued. The page was closed without
  calling `client.close()`, releasing the actual browser-owned lock.
- The follower inherited both stable intents, submitted them in FIFO order,
  and the independent owner query contained exactly one row for each in
  commit order. The newly promoted writer then committed another post.
- No application-owned cache, per-tab database, queue merger, subscription
  coordinator, polling recovery loop, or root resume anchor was added. The
  witness observes SDK APIs and requests; it does not supply those mechanisms.

## Raw attempts and limits

Every original result is retained, including failures:

1. `attempt-1.log`: setup refused because the sibling media helper was absent.
   Linking the existing helper resolved that precondition.
2. `attempt-2.log`: duplicate subscription and follower behavior passed;
   the later offline enqueue refused `E_OFFLINE_ID_BLOCK` (no grant). The
   initial generic ready check preceded opening/using the second tab.
3. `attempt-3.log`: readiness observations transitioned from grant-missing
   to ready and both intents queued. The initial takeover assertion read an
   empty queue before takeover/replay completed, so its premature transport
   assertion failed. This is not evidence that the intents were lost.
4. `attempt-4.log`: pass. The exercise brings the tab being operated to the
   foreground within headless Chrome, checks operation readiness immediately
   before disconnecting, and waits for the actual replay requests before
   asserting settlement. It retains intermediate non-atomic status/entry
   observations rather than treating a transient empty queue as completion.

The focused fake-owner regression file also passed (9 tests, 597 ms;
`client-sessions.log`);
its result complements rather than replaces the real-browser witness.

The full historical browser witness was not run. Its independent cold-cache,
revocation, and kill-during-swap sequence is outside this selection. No browser
process kill, browser restart, bearer restoration, Expo/native takeover,
follower write forwarding, schema evolution, or multi-principal held-count
prediction is claimed. These posts were predicted, but their entries explicitly
omit unheld `messageCounts`; this does not qualify LLP 1018's held-count question.
These are known-template engineering observations, not counts from a fresh
builder's independent discovery process.

## Artifact SHA-256

- Owner: `57ffd352d0144ea7e26bbbae17d4dad25f101969a72ad7605790091322349679`
- client.mjs: `d776d48fd23d13b7b736fff61219b005b72a77e4b61e705b29be8acc27a549f4`
- react.mjs: `c8e3a707248bb6cf25beb9cdbfd74e3c111febcdc71e1cb7866519283abcbd88`
- compiler.mjs: `9c93d2adc425eab14d977a2a8b0d1228a0a5c8c27c4e59bc889efe9863490a78`

Scoped validation also passed: `node --check`, source/doc whitespace checks, caps
(7 categories), and ref-check (412 LLPs, 7,723 refs, zero errors).

Raw attempt logs retain original reporter whitespace, including the first
setup refusal’s blank final line; unrestricted committed whitespace checks
flag those raw lines.

# Keep logout response ownership through its self-terminal live cut

**Status:** Closed
**Severity:** P1
**Systems:** Auth, Client kit, Live queries, Logout, Contract
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0059; LLP 0060
**Marker:** auth, logout, terminal, live, race

With an authenticated live socket open, a successful logout could revoke the
session and publish a terminal live frame before the logout HTTP response was
read. The client terminal cut correctly blanked predecessor surfaces, but its
general transport quiescence also aborted the in-flight logout controller. The
caller then received `SNAPBACK_CLIENT_AUTHORITY_STALE` even though logout had
committed, making the Card Game acceptance proof intermittent.

**Done when:**

- A live terminal notification for the exact logout predecessor still blanks
  all authority-scoped surfaces synchronously.
- That self-terminal cut cannot abort the logout response that caused it.
- Exact empty 204 remains the only public `null` success.
- A peer-installed successor is never cleared or reported as logout success.
- A deterministic client regression runs the terminal cut while reading the
  logout response.

## Resolution

`authLogout` now keeps its HTTP request outside the general tracked-controller
set and completes the exact captured-authority comparison after reading the
response. If another path completed the clear first, logout synchronizes under
durable custody ownership, first joining any in-flight clearing transition, and
accepts only the same auth-mode/stream anonymous outcome; any successor or
unsettled state remains stale. Regressions
inject the live terminal cut inside the 204 body read, then separately advance
durable custody anonymous-to-session behind a missed wakeup. They prove the
first logout returns `null` while the second discovers and preserves the peer
successor.

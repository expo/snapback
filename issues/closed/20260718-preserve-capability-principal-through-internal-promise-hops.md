# Preserve capability principal through internal Promise hops

**Status:** Closed
**Severity:** P0
**Systems:** Runtime, Security, Actions, Upstream Ibex, Hermes
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-18
**Closed:** 2026-07-18
**Related:** LLP 0009 §Capability Model; Ibex LLP 0013 §Phase 5; `tests/action_watchdog_v0.rs`
**Marker:** hermes, promise, principal, action, fetch, capability-attribution

The full local proof exposed a false-denial in outbound actions. The initial
JavaScript `fetch` capability check ran as the granted root principal, but a
later native fetch step after Promise adoption ran as `kNoUserPrincipal` and was
denied. The grant itself was correct. Hermes had registered a descendant
Promise reaction from its internal trampoline after the user callback returned,
so `getCurrentPackageId` found no user frame and the later enqueue lost the
authenticated causality of the actively draining parent reaction.

Blindly inheriting an active parent in ordinary enqueue would reopen the async
deputy laundering boundary. The safe rule is private, causal, and
sentinel-preserving: Promise mints a one-shot token while a reaction registrant
is live, and only the closure-private exact-source record may consume it. If
Promise's private factory itself runs with no user frame during an internal
adoption hop, it may preserve the actively draining scheduler only when that is
a real principal. Ordinary enqueues have no parent fallback. A live user frame
always wins, and neither `kNoUserPrincipal` nor the no-job/runtime sentinel can
propagate as authority.

**Done when:**

- Hermes patches 0008–0009 implement private registration-bound scheduler
  tokens and the narrow internal-factory inheritance rule.
- An engine regression ends a multi-hop chain in a bound native capability
  check, proving that no JavaScript callback frame masks attribution.
- The pre-fix engine returns `denied`; the rebuilt engine returns `allowed`.
- Existing async deputy containment tests remain green.
- `action_watchdog_v0` and the canonical local/Linux proofs pass.

## Resolution

Ibex patches 0008–0009, published in commit
`bfbc6133af739ed2dabc2f44efa693d1412452e5`, bind each Promise reaction to
its registrant with a closure-private one-shot token. Only the exact internal
adoption source can preserve a real active scheduler through a no-frame hop;
ordinary enqueues never inherit ambient authority and both sentinel principals
remain non-authoritative. The focused multi-hop engine and async-deputy
containment regressions pass.

Snapback commit `a5ed6ebd05766b10607937a1c010352d79eea4b0` publishes that runtime.
GitHub Actions local-proof run `29674515103` passed the action watchdog,
compartment red-team corpus, and canonical Linux proof on 2026-07-18.

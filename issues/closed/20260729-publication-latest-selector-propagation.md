# Closed: publication `latest` selector propagation barrier

**Opened:** 2026-07-29
**Closed:** 2026-07-29
**Systems:** Package publication, npm, release evidence
**Related:** LLP 0041

## Problem

Promotion run `30480479462` moved the complete nine-package direct dist-tag
vector to `0.1.1`, but fresh macOS and Linux GitHub-hosted installs both
resolved the public CLI alias to `0.1.0`. Exact-version registry tarballs and
direct dist-tag reads were already correct. npm's resolver-facing package
metadata had therefore not converged with the dist-tag view.

The promoter correctly rolled all changed tags back and closed authority epoch
8 as `rolled-back`, but it had no package-resolver propagation gate before
dispatching the expensive hosted proof.

A preceding attempt also showed that checkout/helper provenance was validated
only after tag mutation, causing a safe but avoidable rollback when a submodule
gitlink was dirty.

The first one-probe correction produced a complete local candidate closure,
then hosted run `30481827652` still selected the prior root on both platforms
roughly 20 seconds later. A publisher-region success is therefore a necessary
signal, not an adequate global stability window.

## Resolution

- Validate and freeze the closed proof plan, helper digest, clean checkout, and
  exact HEAD before authority acquisition; reopen it before dispatch.
- After tag convergence, install
  `@snapback/cli: npm:@ccheever/snapback-cli@latest` in a new temporary project
  with a unique empty npm cache and lifecycle scripts disabled.
- Validate the entire installed candidate closure with the same latest-root
  rules used by the hosted proof.
- Treat the publisher-region closure as necessary load shedding, not dispatch
  authority. Bind the signed prior CLI version, lease digest, and publication
  epoch through the closed v3 plan into both hosted proofs.
- On each hosted platform, retry only a successful structurally valid,
  uniform signed-prior closure. Remove install state and use a distinct empty
  npm cache per attempt under one 350-second wall bound and an 18-attempt cap;
  run the full product/browser proof once after the candidate closure appears.
- Reserve a 540-second dispatch budget (560-second hard cap) so the observed
  123–158-second hosted proof still fits after the cache window; include that
  full budget, verification, and rollback in the pre-dispatch lease check.
- Retry only an exact signed prior CLI root. Refuse resolver errors, missing or
  third roots, candidate roots with wrong transitive closure, registry or
  authority drift, and malformed observations.
- Fence the publisher probe with the complete vector and challenge-bound
  acquired head, enforce one absolute probe deadline, and preserve the hosted
  proof plus rollback lease budget.
- Retain each host's exact policy, ordered attempt classifications, cache
  identity digests, timing, lease identity, and final closure digest in the
  v2 cold receipt, v3 GitHub collection, and v2 post-promotion ledger.

Promotion-core, cold-install, latest-proof, authority, syntax, and diff checks
cover the correction. The next real promotion is the end-to-end acceptance
proof.

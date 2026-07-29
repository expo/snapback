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

## Resolution

- Validate and freeze the closed proof plan, helper digest, clean checkout, and
  exact HEAD before authority acquisition; reopen it before dispatch.
- After tag convergence, install
  `@snapback/cli: npm:@ccheever/snapback-cli@latest` in a new temporary project
  with a unique empty npm cache and lifecycle scripts disabled.
- Validate the entire installed candidate closure with the same latest-root
  rules used by the hosted proof.
- Retry only an exact signed prior CLI root. Refuse resolver errors, missing or
  third roots, candidate roots with wrong transitive closure, registry or
  authority drift, and malformed observations.
- Fence every attempt with the complete vector and challenge-bound acquired
  head, enforce one absolute probe deadline, and preserve the hosted proof plus
  rollback lease budget.
- Retain the bounded barrier witness separately from the closed tag-event and
  post-promotion-ledger schemas.

Promotion-core, cold-install, latest-proof, authority, syntax, and diff checks
cover the correction. The next real promotion is the end-to-end acceptance
proof.

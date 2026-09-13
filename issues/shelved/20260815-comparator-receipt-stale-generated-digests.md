# Committed comparator receipt is stale against current codegen output

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Comparator acceptance, Packaging, CI
**Date:** 2026-08-15
**Governing:** LLP 0123 (package seal custody)
**Related:** `issues/closed/20260815-linux-runtime-release-readiness-receipt.md`
(whose CI proof run surfaced this), the comparator seal recipe (clean worktree +
release build + prepack)
**Found while:** Supervised 2026-08-15 ticket-fix run (Linux workflow proof dispatch)

## Problem

`linux-runtime-package` dispatch run
[31924683184](https://github.com/expo/snapback/actions/runs/31924683184)
(pinned at `1c05bba66`) reached "Pack and cold-install the Linux public-alias
closure" and failed:

```text
SNAPBACK_COMPARATOR_RECEIPT_INVALID: comparator receipt executing-package
identity does not match the verifier package graph
  receipt  @expo/snapback-cli sha256:5b21124a…
  verifier @expo/snapback-cli sha256:46eb6295…
  filesOnlyInReceipt:  fixtures/comparator/app/snapback/generated/app.binding.9d44dd93….mjs,
                       …app.descriptor.6b743ba4….json
  filesOnlyInVerifier: fixtures/comparator/app/snapback/generated/app.binding.21dae7db….mjs,
                       …app.descriptor.989e74aa….json
```

The committed comparator receipt embeds digest-named generated fixture files
minted against older codegen output; the 2026-08-15 landings rotated the
generated shapes, so the packed CLI's fixture graph no longer matches. The
receipt gate is doing its job — the seal is genuinely stale.

## Desired outcome

Re-mint the comparator receipt with the seal recipe (clean worktree, release
build, prepack, mint) at a commit that includes the current codegen surface.
Note the in-flight take-limit generation change will rotate fixture digests
again — mint after it lands, not before. Consider whether the affected-scope
selector should force a comparator re-mint (or at least select the comparator
acceptance) when codegen output shapes change, so the next rotation is caught
at the originating landing.

## Acceptance

- `snapback accept comparator` passes in the packaged cold-install lane
  (the linux-runtime-package workflow reaches evidence upload green).
- The receipt's executing-package identity matches the packed verifier graph.
- A codegen-shape landing that rotates fixture digests cannot leave the
  committed receipt silently stale (selector or gate coverage).

# snapback-drift pre-push hook inherits the pusher's shell toolchain

**Status:** Resolved
**Impact:** 2
**Urgency:** 2
**Ease:** 3
**Confidence:** 5
**Systems:** Git hooks, Proof infrastructure, Developer experience
**Date:** 2026-08-06
**Related:** a18a1556e (hook landing); scripts/client-bundle-metrology.mjs
(method-pinned to Node 24.18.0/zlib 1.3.1)

## Problem

The drift-prone-gate pre-push hook runs its gates with whatever `node` the
pushing shell provides. Under Node 25.9.0 the client-bundle-metrology gate
fails its measurement-method pin (node/zlib mismatch) and the hook reports
`stale record: current.v1.json` — a misdiagnosis: the record was freshly
regenerated under the pinned 24.18.0 and `--check` passed there. The pusher
sees "regenerate" advice that cannot succeed under their shell, and the
workaround (`volta run --node 24.18.0 git push ...`) is undocumented lore.
Two pushes of the LLP 0176 G4-rerun landing were refused this way before
the mismatch was identified.

## Fix shape

The hook should self-pin its toolchain for method-pinned gates (invoke via
`volta run --node 24.18.0` or read the pin from the gate's own baseline
method record) instead of trusting the pusher's PATH, or at minimum
diagnose the node-version mismatch explicitly rather than reporting the
record as stale. There is no `volta` field in package.json — adding one may
be the simplest durable pin, if the repo owners want every tool pinned.

## Resolution

Resolved 2026-08-07. `.githooks/pre-push` now reads the repository's
`.node-version` and, when the ambient runtime differs, prepends the matching
Volta image bin directory to `PATH` (with a Volta resolution fallback). The
runner and every gate therefore inherit the pinned Node runtime without a
wrapper.

The implementation deliberately does not use `volta run` around the runner or
gate commands: Volta can translate a child's ordinary exit 1 into exit 126,
which the drift runner classifies as command-unavailable infrastructure. PATH
prepending preserves the gate's real exit status and fixes the original
toolchain mismatch.

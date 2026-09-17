# Snapback 4: Two-package npm publication cannot resume after partial success

Status: Open
Priority: P2
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (0.2.26)

## Evidence

Independent Sol review, code traced in scripts/publish.mjs. Platform package publishes first; if the client publication fails, rerunning unconditionally republishes the already immutable platform version and exits before publishing the missing client. Snapback 2 had the same issue in its closed 20260901 ticket.

## Acceptance

Make publication converge on the exact two qualified tarballs. Detect an already-published matching artifact and continue; reject mismatches and ambiguous registry failures. Preserve installed-consumer qualification and never skip verification simply because a version exists. Test platform-success/client-failure then retry, both-present match, mismatch, and non-404 registry failures through the existing publisher mock; do not publish real npm packages as a test.

# Snapback 4: Two-package npm publication cannot resume after partial success

Status: Closed
Priority: P2
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (0.2.26)

## Evidence

Independent Sol review, code traced in scripts/publish.mjs. Platform package publishes first; if the client publication fails, rerunning unconditionally republishes the already immutable platform version and exits before publishing the missing client. Snapback 2 had the same issue in its closed 20260901 ticket.

## Acceptance

Make publication converge on the exact two qualified tarballs. Detect an already-published matching artifact and continue; reject mismatches and ambiguous registry failures. Preserve installed-consumer qualification and never skip verification simply because a version exists. Test platform-success/client-failure then retry, both-present match, mismatch, and non-404 registry failures through the existing publisher mock; do not publish real npm packages as a test.

## Resolution — 2026-09-16

Implemented in `f6b514c35` as part of the complete project review.

The publisher durably stages both exact tarballs and integrity metadata before attempting publication. Explicit --resume repeats installed-consumer qualification, skips only registry artifacts with matching integrity and publishes each missing artifact independently. Mismatches and non-404 lookup failures refuse. Ordinary invocation refuses an existing stage to avoid stale-byte reuse after source changes. Publisher mocks pass; no live npm publication was performed.

Integrated qualification and independent repair review are recorded in
[the review index](../../llp/reviews/3000-complete-code-review-20260916.md).

Follow-up implementation: `7e0fc21da8d7675b4a5ec2a418604b2135c438a9`.
The retained format-2 receipt records its original successful source suite;
resume validates that receipt before commands and repeats installed-consumer
qualification. Unrelated current-source failures cannot strand the exact pair.

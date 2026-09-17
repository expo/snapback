# Snapback 4: Local client cannot recover from an oversized snapshot page

Status: Open
Priority: P1
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (0.2.26)

## Evidence

Independent Sol review. Existing http-bounds.test.mjs seeds 40 rows with 400000-byte bodies, proves /sync limit:100 returns E_BOUND, and proves limit:1 succeeds. local.ts always requests PAGE=4000; a nonretryable refusal becomes partitionDenied. Legal wide rows therefore wedge cold acquisition even when smaller pages are valid.

## Acceptance

On response-size E_BOUND, retry the same cursor/watermark with a smaller positive limit, finitely down to one. Never advance on a refusal, discard authority fencing or hide terminal failures. Exercise the real server and both device tiers with wide rows and single-row/indivisible refusal. This is a narrow repair, not a solution for an indivisible join/commit larger than the wire ceiling.

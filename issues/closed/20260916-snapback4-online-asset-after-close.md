# Snapback 4: Online asset fetch returns private media after client close

Status: Closed
Priority: P2
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (0.2.26)
Review: complete code review requested by Charlie Cheever; lead validation with independent Grok, Muse and Sol reviews.

## Evidence

Reproduced with a delayed fetch and `createClient().asset()`. Close the client before resolving the fetch; the pending call still resolves a usable blob URL (13 bytes in the probe).

## Implementation locations

Paths are relative to `snapback4/`: `packages/snapback4/src/client.ts:512` checks credentials only before `fetchAsset`. The success path does not recheck close/sign-out or credential revision. The local tier already revokes late results.

## Acceptance

Delay a successful asset response across close and sign-out; return the appropriate refusal and revoke the unused URL. Preserve refresh retries and never expose a result admitted under obsolete credentials.

## Resolution — 2026-09-16

Implemented in `f6b514c35` as part of the complete project review.

Online asset completion now checks client closure, credentials and credential revision on success as well as refusal. Obsolete object URLs are revoked; rotation retries under current credentials. Delayed-fetch regressions cover close, sign-out and rotation.

Integrated qualification and independent repair review are recorded in
[the review index](../../llp/reviews/3000-complete-code-review-20260916.md).

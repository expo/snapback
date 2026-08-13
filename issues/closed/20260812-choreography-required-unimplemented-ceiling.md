# Frozen choreography ships required-but-unimplemented checks; m2/m3 green is structurally unreachable

- **Status:** Resolved (2026-08-12)
- **Date:** 2026-08-12
- **Systems:** benchmarks (social-messenger instrument)
- **Found by:** P2 pilot (first flag); confirmed by all 14 lanes of the
  2026-08-12 seven-model sweep
  (`benchmarks/records/2026-08-12-social-messenger-model-sweep.md`)

`benchmarks/tools/social-messenger/choreography/` hard-coded four
required assertions per segment in m2 (image/video post delivery,
follow-unfollow projection, feed author avatar) and m3 (dm-live-avatar,
receipt transitions, group aggregate receipt, member removal) as
`implemented:false, required:true`. `aggregateChoreography()` fail-closes
on `requiredUnimplemented > 0`, so no lane can ever emit `green:true`
for m2/m3 regardless of the app. Every sweep lane recorded it honestly
but with divergent labels ("functionally green" vs "capability-failure"),
which the grader phase cannot score consistently.

**Fix before the P5 scored wave** (this was already the P2 pilot's
"harness defect to fix before scored waves"):

1. Implement the eight missing checks (they are ordinary Playwright
   observations against contract test IDs), or demote them to
   `required:false` with a recorded rationale per check.
2. Pin one recording convention for instrument-caused non-green in the
   run-record schema so lanes stop inventing labels.

Also fold in the sweep's related instrument notes: pin the reduced-run
milestone DAG wording (two lanes proceeded to M3 declaring it
independent of M2), and disambiguate follow-projection assertions for
posts entering Following via the viewer's own repost (sol's finding).

## Resolution

Implemented what the frozen contract can observe; demoted the rest with
durable skip reasons. No new `CONTRACT_TEST_IDS`.

Implemented (required):

- `follow-unfollow-live-projection` — Bob navigates `adapter.routes.profile`
  with Alice's handle, toggles `sm-profile-follow`, and Following vs Global
  membership of Alice's original flips both ways.
- `feed-author-avatar-and-display-name` — author **display name** text on
  `sm-feed-item`. Avatar is not inferred (no feed-avatar test ID).
- `repost-following-feed-surface` — now required: Alice's original must
  appear via the follow edge; a viewer-repost of unfollowed Alice is
  attributed `reposted by Bob` and is not a direct follow-projection hit.
- `dm-live-messages` — live DM text both ways via `sm-convo-bubble`.

Demoted (`required:false`, still emitted as skipped receipts):

- `feed-image-post-live-update`, `feed-video-post-live-update` — no compose
  media-picker test ID
- `dm-live-messages-and-sender-avatar` — no sender-avatar test ID
- `receipt-sent-delivered-read-transitions` — no semantic receipt token
- `group-receipt-waits-for-slowest-member`,
  `removed-member-live-cutoff-and-retained-history` — no group-member
  lifecycle controls

Recording convention: segment-summary (and the run-record milestone
extension) carry optional `nonGreenCause` (`suite-failed` |
`choreography-failed` | `required-unimplemented` | `instrument` |
`null` when green). Default is `null` when omitted; schema stays
`0.3.0-m8`. Lanes MUST copy the field; do not invent "functionally green".

Scoring DAG vs reduced-run protocol is pinned in the brief and the
choreography README: M3 requires M1 only; execute M1 then M2 then M3;
skipping M2 is non-conforming.

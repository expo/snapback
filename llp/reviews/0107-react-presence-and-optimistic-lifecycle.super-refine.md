# LLP 0107 super-refine run journal

## Round 1 — 2026-07-27

- Authorization: Charlie Cheever explicitly requested `/llp-super-refine`
  with Fable 5 input for substantive backend-bakeoff work in this thread.
- Topology: independent single-target round; LLP 0013 and LLP 0101/0102 are
  dependency context only. Two fresh, mutually blind reviewers receive the
  same structurally isolated capsule.
- Target: `llp/0107-react-presence-and-optimistic-lifecycle.spec.md`
- Target SHA-256:
  `c1d52efd6c130b6c6c3ad8c18a018a9d946384cfc3bfad12b3bfc999491311f2`.
- LLP 0102 dependency SHA-256:
  `c6dc88557f9fcf69437f57b90df24b420c67103445051125689b6523e923634a`.
- LLP 0101 dependency SHA-256:
  `bd1bb9aaaa4f9c9015039d09a716add5ea86dbc442d0954ff49b11931e9fb3ac`.
- Capsule SHA-256:
  `f76e1d0192fd1466719d8782c04d88fe360fb3804187e7ec775e2c63e7b8841f`
  (3,194 files; relative-path/content inventory hash).
- Instruction SHA-256:
  `f6fa6d45663997f5c7e3ec52ce076aff1eec48c59ded01656c74b75beda1138b`.
- Structural exclusion: all target-specific review artifacts, this journal,
  and orchestrator notes are absent from the capsule.
- Outbound inventory: the public tracked repository at the ticket checkpoint,
  the complete unredacted target and LLP 0101/0102 dependencies, current public
  React/client package sources, and imported public backend-bakeoff sources
  excluding ignored dependencies, build products, runtime state, and
  `.env.local`. No credentials, secrets, prior reviews, or unrelated
  working-tree changes are included.
- Claude reviewer: fresh Claude Code 2.1.220 session on the approved M4 Mac
  mini fleet lane, `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI 0.145.0 session,
  `gpt-5.6-sol`, reasoning effort `ultra`, read-only sandbox.
- Round budget: 3. Launch cap: 6 attempts per family. Growth budget: 20% net
  over the entering revision.
- Claude reviewer completed in fresh remote session
  `6f70b32d-2581-427b-bb29-f8c6e2b15a80` with `VERDICT: NOT READY`; its
  verbatim review is preserved in the Fable-family artifact.
- Codex reviewer completed in fresh local session
  `019fa6a8-a5c0-7dc2-8333-3a27d386f3ef` with `VERDICT: NOT READY`; its
  verbatim review is preserved in the Codex-family artifact.
- Round status: completed. The author revised key-mode totality, correlated
  query typing, closed state/publisher algebra, client-owned settled room
  handles, monotonic expiry and aggregate rate admission, optimistic ledger
  totality, provider ownership, caps, and exact executable evidence. Net
  target growth from the entering revision is 17.8%.

## Round 2 — 2026-07-27

- Topology: independent delta round; two fresh, mutually blind reviewers
  receive the same structurally isolated capsule.
- Target SHA-256:
  `443f38de7a59a9eea3b6c450c74bc6112837878a798f547948a54b2d5bfe7f05`.
- Capsule SHA-256:
  `0844ccc5b58af48decb1830e70843a9b36693b0237d575c647eb6faf7bb01a2f`
  (2,726 files; relative-path/content inventory hash).
- Instruction SHA-256:
  `f3cd50fa999bd83c2d3eacc0671d05d5a9a85a82ee7a726f353a5359de3bec1f`.
- Structural exclusion: all `llp/reviews`, run journals, and orchestrator notes
  are absent from the capsule.
- Outbound inventory: the public tracked ticket-checkpoint repository plus the
  current unredacted LLP 0101/0102/0105/0107 documents and public implementation
  tree. Ignored dependencies, build products, `.env.local`, credentials, and
  secrets are absent.
- Reconciliation target: connection-only references; correlated optimistic
  query types; discriminated state; settled client room handle; expiry/rate
  totality; token-bound publishers; transactional optimistic lifecycle;
  multi-root ownership; React-local caps; exact retained evidence.
- Claude reviewer: fresh Claude Code 2.1.220 session on the approved M4 Mac
  mini fleet lane, `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI 0.145.0 session, `gpt-5.6-sol`, reasoning
  effort `ultra`, read-only sandbox.
- Claude completed in fresh session
  `8326f3b5-e016-4c77-bbf2-00b22ce52a52` with `VERDICT: READY`; Codex
  completed in fresh session `019fa6bb-6520-7910-847a-b0f4e6791828` with
  `VERDICT: NOT READY`. Both verbatim reviews are preserved.
- Round status: completed. Reconciliation makes the canonical prepared query
  store and ephemeral admission map exact; totals room-handle cancellation,
  monotonic expiry carrier, publisher intent/failure/rate transitions, and
  optimistic rebase/pin/correlation behavior; and makes disconnect/cleanup
  evidence nonvacuous. Target size is 14,377 bytes, 19.4% above the
  12,044-byte entering revision and within the 20% net growth budget.

## Round 3 — 2026-07-27

- Topology: final independent delta round with a declared implementer lens; two
  fresh, mutually blind reviewers receive the same structurally isolated
  capsule.
- Target SHA-256:
  `99f34faa1ca1d1ef8655f221e3b26373320fd46a44bbcf7f51a682902d5f91ba`.
- Capsule SHA-256:
  `d6613c1187fac0ed34380b596826f5ab086f9c29f5b10383de28450268bc3e9a`
  (3,159 files; sorted relative-path/content-digest inventory hash).
- Instruction SHA-256:
  `157079b096962389b0e7b5ae6042293a87fc915ffe7d6a071ddedb1add88737f`.
- Structural exclusion: all `llp/reviews`, run journals, Git metadata, ignored
  dependencies/build/runtime state, and orchestrator notes are absent.
- Outbound inventory: the public working tree needed for review—the unredacted
  target/governing LLPs and current React, client, codegen, server, guide, and
  bakeoff sources. `.env*`, local secrets, credentials, private-key formats,
  retained runtime results, and the vendored Ibex runtime are absent.
- Lens: derive the named TypeScript/runtime contracts, owners, transition
  machines, and ten-check receipt from the document alone; materially divergent
  implementations are `NOT READY`, implementation mechanics are DETAIL.
- Reconciliation target: single prepared store/ledger; closed ephemeral
  admission; total room-handle cancellation; monotonic expiry carrier;
  publisher precedence/failure/rate transitions; total optimistic
  rebase/correlation/pinning; nonvacuous disconnect/cleanup evidence.
- Claude reviewer: fresh Claude Code 2.1.220 session on the approved M4 Mac
  mini fleet lane, `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI 0.145.0 session, `gpt-5.6-sol`, reasoning
  effort `ultra`, read-only sandbox.
- Claude completed in fresh session
  `cab84e94-196e-437a-a789-7596f95d3b2d` with `VERDICT: NOT READY`; Codex
  completed in fresh session `019fa6d5-8c95-75b1-b881-580af937858d` with
  `VERDICT: NOT READY`. Both verbatim reviews are preserved.
- Round status: completed; the three-round budget is exhausted.

## Terminal author reconciliation

The author-directed implementation revision is
`147c46e7e67d2d70d0ec862d3bb90eae84ab5fd7bcda82f33d2d68771cf87cb6`
(14,180 bytes, 17.7% over the 12,044-byte entering revision, within budget).
It is deliberately unreviewed after the terminal round and remains `Review`;
capability publication stays gated on the complete executable evidence.

Complete disposition:

- Both families' expiry-negotiation MATERIAL concern is closed by the exact
  closed connection-open `ephemeralExpiryProtocol: 1` offer/grant echo,
  lineage binding, stable unknown refusal, legacy omission/durable retry,
  conditional final-send stamping across HTTP/WebSocket/lane-P, and old/new
  cross-product gate.
- Fable's optimistic-result-carrier MATERIAL concern is closed by admitting
  the full generated/deployed result descriptor/hash privately into the one
  prepared store, requiring a non-unknown contract, and naming installation
  refusal. No descriptor is caller-authored.
- Codex's prepared-ephemeral DETAIL concern is closed by the exact private
  generated/deployed fields and static policy/projection digest; per-generation
  authority remains runtime-owned. Its latest-intent race is assigned to
  package tests, and the handle spelling is fixed as `started()`.
- Fable's DETAILS are closed by naming only newly generated `publishRate`,
  naming install/refusal paths, assigning a client-owned 5-second abort
  deadline, using LLP 0059's operation-appropriate gates, mapping room/store
  caps, restoring exact placeholder prefixes, registering the React
  republisher, and assigning the late-send/delete races to tests.
- Fable's pre-existing demo plumbing findings were repaired in the working
  tree: backend-bakeoff is in demo inventory, required surfaces carry exact
  build-target vocabulary, and packed/new package tests are in the canonical
  inventory. The presence/rollback migration remains an implementation gate.

Per the stop rule, no fourth launch is made. This is not dual-READY and no
acceptance claim is inferred from the reconciliation; implementation follows
the explicit final decisions behind an unadvertised capability.

## Implementation evidence reconciliation — 2026-07-27

The terminal author revision was subsequently implemented without claiming a
fourth review or dual-READY. The implementation closes the executable gate
named above: package-owned client expiry/room, shared result-validator, React
presence/optimistic, and generated-descriptor suites pass; Signal Desk uses
the first-class provider APIs; and its retained
`acceptance/results/react-presence.v1.json` records all ten required check ids
with zero skips. The guide publishes only the local-target Online capability,
while the hosted no-work refusal remains explicit. LLP 0107 therefore moves
from Review to Implemented on executable evidence, not on an invented review
verdict.

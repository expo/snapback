# Clique: the DM avatar assertion conflicts with the conditional UI contract

Status: Open
Priority: P3
Date: 2026-09-14
Systems: social-messenger benchmark, assertion manifest, choreography, independent grading
Instrument: frozen `social-messenger@0.3.8-m8`, commit `409954115f151a72dd95e897c5f00f36877f11e0`
Evidence status: conflicting frozen requirements and a received grading consequence

## Observation

The 0.2.10 Astra independent grade records `m3-a02` as fail because DM
bubbles do not render sender avatars. Its trace explicitly notes the
instrument ambiguity. Both earlier Astra grades (0.2.6 and 0.2.9) passed
this ID, so the changed classification is not a clean product comparison.

The frozen inputs conflict:

- `schema/social-messenger/assertions.json` says “DM messages render with
  sender avatars”; the brief's M3 acceptance item 1 also requires them.
- `CONTRACT.md:90` makes the sender-avatar node conditional. The shared
  `MessageBubble` renders it only for `!isMine && showSender`; the default
  1:1 layout leaves `showSender` false.
- `choreography/choreography.mjs:1697` sets the avatar check's `implemented`
  field from whether that node is rendered, with `required:false`. Absence
  in the default 1:1 layout is an explained skip, not a failed segment.

These paths are relative to the packet's immutable `instrument/` directory.
The [selected assertion, received result and file hashes](../benchmarks/runs/2026-09-14-snapback4-clique-0.2.10/astra/qualifications/avatar-contract-observation.json)
identify the exact evidence. The received fail remains unchanged.

## Prior work and prospective repair

The [observability revision's August 25 note](shelved/20260821-clique-instrument-observability-version-bump.md)
explicitly says the default no-avatar 1:1 layout stays conforming. It is
provenance for the conditional contract, but does not resolve the stale
assertion and brief. The older [required/unimplemented check issue](closed/20260812-choreography-required-unimplemented-ceiling.md)
concerned missing observability; this is a remaining disagreement between
the published requirement and its grading mechanism.

In a new instrument revision, make the brief, assertion manifest, UI
contract and grader instructions agree on whether DM avatars are required.
Check both a default 1:1 layout and an opted-in avatar layout: the same
declared policy must produce consistent choreography and grade outcomes,
and a rendered avatar must still identify the correct sender.

Do not edit this run's frozen instrument or retroactively rescore it.
Until resolved, report this assertion's method difference beside any
cross-pin grade comparison. This is benchmark maintenance discovered during
[LLP 3000.007 §10.3](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#10.3),
not a Snapback engine defect or an author ruling about the desired UI.

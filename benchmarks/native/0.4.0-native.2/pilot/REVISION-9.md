# Revision 9 — Preserve unowned simulators during cleanup admission

Authority remains the Lane P3 instruction: Apartment mini and dedicated
`3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B` only. Revision 8 passed all 79 macOS
self-tests and packet readiness. Before starting any chain or measurement,
its added admission check refused because other simulators had booted since
the completed builder's baseline. Those devices have no demonstrated ownership
by this harness. Their presence must neither authorize their shutdown nor
prevent this dedicated-device continuation.

Remove that admission condition. `ProcessOwner.cleanup` continues to stop only
its owned PID/start identities; it records and preserves other simulators.
The inherited assumption that every newly booted simulator on the host belonged
to this builder is removed. The normal operator/driver still uses only the
dedicated UDID. No other simulator is stopped, erased, installed or launched.
The additional regression proves cleanup issues no simulator mutation command
when an unrelated device appeared after the baseline.

Preserve the revision-8 seal as `PACKET.v8.sha256` and its source/metadata under
`preparation/revision9/prior-packet/`. Bind the exact delta, prior seal and
original admission refusal in `metadata/revision-9.json`. Revision 8's sealed
reclassification and zero setup reruns remain unchanged. No resumed chain or
attempt existed when revision 9 was prepared. Repeat macOS self-tests, readiness
and admission, then use the same one-use continuation described in revision 8.

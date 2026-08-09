# Outbox queued-write invisibility: {queued:true} resolves like success (convergent pilot finding)

THE strongest convergent product finding of the Clique pilot — hit
independently by two contamination-shielded sessions:
1. Builder: a transient connectivity-classified refusal silently queued
   a mutation ({queued:true} resolving like success, no error, no
   diagnostic); every later mutation queued behind it; a screen with no
   outbox drain wedged for hours ("the worst hours of the run"). Fix
   required an app-wide OutboxFlusher. Lesson recorded: "a queued write
   is indistinguishable from a committed one at the mutate() call site
   unless you check result.queued."
2. M7 session: an offline vote queued durably but the settlement
   promise REJECTED with SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED — a
   rollback-on-error handler erased the pending marker while the intent
   settled fine on reconnect.

The settlement facts exist (clients.mutation-outcomes, shipped); the
defect is the DX default: queued outcomes are silent at the call site,
and the queued-but-rejected promise shape invites rollback bugs. Ask:
(a) a loud, documented diagnostic class for queued-at-mutate; (b) either
resolve queued optimistic installs as {queued:true} or document the
rejection contract prominently; (c) a default/one-line app-wide drain
affordance so every screen need not hand-build outbox awareness.
Related: issues/20260731-js-arm-lease-custody-and-sessions-outbox.md,
LLP 0043/0063. Evidence: p2-pilot snapback-lane run-log.md + m7-log.md.

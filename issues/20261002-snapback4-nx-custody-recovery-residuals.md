# Snapback 4 NX: remaining crash-recovery limits after round 8

Status: Open
Date: 2026-10-02
Scope: cleanup-only follow-up; no export correctness relaxation
Related: LLP 3000.030 §15; lane NX round-8 report

The operator directed that remaining crash-recovery limitations unrelated to
export correctness be ticketed after this round. The ordinary driver death,
stalled launcher, final-snapshot joiner and exited-anchor paths have regressions
on Darwin and Linux. This ticket does not describe an observed surviving child
in those final regressions.

Remaining limits:

- Recovery holds the guardian's reaping lock and verifies the leader's birth,
  including an unreaped zombie. Another actor can still kill that guardian;
  external reaping and complete group-number reuse between the final birth
  observation and numeric group signal form a residual window on Darwin and
  Linux 6.8. Missing/mismatched birth refuses cleanup. The normal watchdog path
  owns its unreaped child and does not have this reuse window. Legacy groups
  without a retaining guardian depend on their external parent not reaping
  during that same interval.
- A process that changes its session/group escapes process-group custody.
  The supported launchers and preparation workers inherit the group; this is
  an honest-project lifecycle mechanism, not containment of hostile code.
  An unrelated external actor joining after both final empty observations also
  lies outside this ownership guarantee.
- WD (2026-10-03) removes `ps` from group inspection and adds progress-based
  deadlines: Darwin uses libproc, Linux reads `/proc`. The drain budgets still
  cannot preempt a stalled kernel inspection or uninterruptible kernel I/O;
  a stopped watchdog with no group exits times out with recovery required. Missing
  custody or a nonempty group leaves recovery deferred, not a verified finish.
  Simultaneous destruction of the watchdog and its anchor is not guaranteed to
  clean all descendants autonomously.

Any future work should measure one of these concrete cases and preserve all
birth, group, publication and lease controls. Do not add a broad PID kill or
turn failed cleanup into export success. Social's open 25-second timing target
is tracked separately in `20261002-snapback4-nx-round5-social-warm-timing.md`.

# Snapback 4: retain process-group identity after unexpected watchdog death

Status: Open
Date: 2026-09-29
Priority: Low
Source: WK round-2 Grok review, completed during WK round 3

`worker_process.rs` reserves the Node leader's PID with WNOWAIT while its watchdog
is alive. After an unexpected watchdog death, `dev_worker.rs` instead kills the
retained numeric group ID before replacing the worker. If the original group has
fully exited and its numeric ID has been reused as another group before that
fallback, the signal could target the replacement group. The existing SIGKILL
witness keeps the original Node leader alive and does not force ID reuse.

Grok classified this as nonblocking; the round-3 change does not claim a fix.
Investigate an identity-bound group cleanup mechanism on Linux and macOS that
still handles surviving descendants after the leader exits. A pidfd for the
leader alone does not express a group-wide kill. Do not drop descendant cleanup
or claim WNOWAIT still reserves a child after its watchdog has died.

Evidence: [complete review and disposition](../snapback4/reports/20260929-wk-supervised-workers/round3/REVIEWS.md).

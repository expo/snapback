# Snapback 4: token inspection can refuse healthy files on shared hosts

Status: Resolved (2026-10-03)
Date: 2026-10-03
Scope: Snapback 4 qualification runner; QF Grok follow-up and Round 3
Related: LLP 3000#publication-suite-under-contention

The inherited-token sweep closes ordinary native session escapes when process
environments are readable. On shared hosts, some new same-user candidates have
unreadable or kernel-redacted environments. The Grok follow-up failed closed
on an unproven candidate, preventing a clean qualification even when assertions passed. The operator superseded that policy
in Round 3: a single opaque candidate is not provably ours, not a file failure.

The Grok follow-up's single eb1000 suite refused 13 ordinary files on
`/proc/<pid>/environ` EACCES; all 5,814 ordinary client assertions passed and the
ten conditional skips were unchanged. The final combined mini focused run also
passed all 29 assertions but refused its outer file on two redacted candidates.
These are introduced inspection refusals, not baseline product-test failures.
The candidates had exited before later metadata probes, so their identities
and ownership are not inferred after the fact.

Darwin 27 additionally redacts `/bin/sleep`'s environment from both a successful
KERN_PROCARGS2 call and `ps -E`. The Grok follow-up native-orphan regression
required a file-level refusal in that case; Round 3 instead requires a diagnostic, no
refusal and no runner signal. The fixture reaps its own known orphan. The
runner cannot safely kill a process whose ownership it cannot prove.

Current positive exclusions are causal: unchanged pre-launch identities,
descendants of unchanged non-ancestor processes, and a still-existing
pre-launch session. The mini observer proves the last exclusion for a new
`mdworker_shared` in session 1. The file's own session remains owned even after
its token is cleared; tokens cover a new session when retained. Mechanism
failures, including enumeration, ps/helper exit or timeout and malformed output, remain fail-closed. A candidate's EACCES, EPERM or redacted
environment emits one PID/executable/start-time diagnostic per identity per
file and is skipped without signalling. Readable matching tokens still require
cleanup and TEST_FILE_LEAK. No executable allowlist or host security change is
used.

The residual limitation is an escaped process (new session or group, lost
ancestry) whose environment is unreadable/redacted, or which removed its token:
it is undetected outside group/session custody. On macOS this includes
restricted system executables such as /bin/sleep. A cleared-token child still
in the owned session remains covered. This is a deliberately scoped ownership
check on a shared host, not an arbitrary-daemon cleanup guarantee.

The [Round 3 report](../../snapback4/reports/20261002-qf-qualification-flakes/REPORT.md#round-3--shared-host-token-inspection-2026-10-03)
records the implementation and qualification. Historical refused checks remain
in the Grok follow-up section. Resolution evidence follows here.


## Resolution — Round 3

Implemented the operator's diagnostic-only policy for single opaque candidates,
while preserving mechanism refusals and readable-token/session/group cleanup.
Focused checks passed without file refusals: Linux 30 passed with six Darwin-only
skips; Apartment mini 36/36 passed, including the real restricted /bin/sleep
regressions that reap their own recorded children.

The single eb1000 full suite exited 0 with exactly
`== 0 failure(s) in 1593 s`. All categories and all 286 file results passed:
5,903 assertions passed, zero failed, 16 skipped. Eighteen distinct unreadable
host candidates were diagnosed and skipped, plus one intentionally denied
regression candidate. All diagnostic lines and failure classifications are in
the Round 3 report. The accepted escape limitation above remains explicit.

Two later stress background executions refused unparsed proc-stat metadata; that
is the retained mechanism policy, not this permission-denial defect. Its cause
is unresolved and tracked in the
[separate metadata-diagnostic ticket](../20261003-snapback4-malformed-proc-stat-during-stress.md).
Do not suppress that guard as part of closing this issue.

The final 24-file stress completed worker 200/200 and replacement 200/200
without target failures; all 1,953 background executions finished. The two
mechanism refusals remain recorded, with zero assertion failures.

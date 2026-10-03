# Snapback 4: token inspection can refuse healthy files on shared hosts

Status: Open
Date: 2026-10-03
Scope: Snapback 4 qualification runner; QF Grok follow-up
Related: LLP 3000#publication-suite-under-contention

The inherited-token sweep closes ordinary native session escapes when process
environments are readable. On shared hosts, some new same-user candidates have
unreadable or kernel-redacted environments. An unproven candidate correctly
fails closed, but this prevents a clean qualification even when assertions pass.

The Grok follow-up's single eb1000 suite refused 13 ordinary files on
`/proc/<pid>/environ` EACCES; all 5,814 ordinary client assertions passed and the
ten conditional skips were unchanged. The final combined mini focused run also
passed all 29 assertions but refused its outer file on two redacted candidates.
These are introduced inspection refusals, not baseline product-test failures.
The candidates had exited before later metadata probes, so their identities
and ownership are not inferred after the fact.

Darwin 27 additionally redacts `/bin/sleep`'s environment from both a successful
KERN_PROCARGS2 call and `ps -E`. The retained native-orphan regression requires a
file-level refusal in that case; the fixture reaps its own known orphan. The
runner cannot safely kill a process whose ownership it cannot prove.

Current positive exclusions are causal: unchanged pre-launch identities,
descendants of unchanged non-ancestor processes, and a still-existing
pre-launch session. The mini observer proves the last exclusion for a new
`mdworker_shared` in session 1. The file's own session remains owned even after
its token is cleared; tokens cover a new session when retained. No permission
error, redaction, empty helper output or unknown process is treated as clean.

Next work must obtain stronger ownership or inspection evidence for remaining
opaque candidates without signaling unrelated processes or suppressing errors.
Do not whitelist executable names, convert EACCES/redaction into an empty
result, disable SIP, or claim arbitrary daemon cleanup. Preserve the three
native escape shapes, cleared-token/same-session case, two stable empty
snapshots, and exact progress bounds. A complete cleanup claim remains blocked
when the host cannot expose the required ownership evidence.

The [Grok follow-up report](../snapback4/reports/20261002-qf-qualification-flakes/REPORT.md#grok-follow-up)
retains all refused runs, source custody, probe output and the full-suite result.

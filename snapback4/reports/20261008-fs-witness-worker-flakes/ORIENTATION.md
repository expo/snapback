# FS context pack — 2026-10-08

Scope: witness smoke/store ownership, preparation leases, publication/recovery unit tests, worker admission and relayed-log tests.

Governing context: LLP 3000 (current), §7 “Publication suite under contention”; LLP 3000.019 (current), §3.4; LLP 3000.030 (current), §15; LLP 3000.009 (current), §5.3. Snapback 4 uses its own fence; root foundation gates for older Snapback versions do not apply. Read snapback4/AGENTS.md, NOT-DOING.md, JOURNAL tail, rules/RULES.md, LLP 3000, and the LLP 2000.000 design brief; followed the source refs and the current witness guide.

Constraints: state observations decide correctness, independent guards detect hangs (LLP 3000#publication-suite-under-contention). Store custody is the sidecar flock, never the address hint or the SQLite inode (LLP 3000.019#3.4). Fork-inherited open-file descriptions remain custody until exec/exit; an explicit unlock would incorrectly release another holder. Wrapper fd 3 is intentional inheritance; recovery requires the run, export and publication leases and matching identities (LLP 3000.030#15). Workers require independent seats, redaction, restart and owned cleanup (LLP 3000.009#5.3).

Risk: libtest neighbours fork during a test's lease lifetime. Immediate last-close assertions require a process with known fork holders. Linux cannot execute Darwin-only driver coverage. EM's report and ticket were absent from the starting tree; exact names were requested while independently investigating recovery.

Likely doc updates: append JOURNAL, report measurements and controls, reconcile the scoped tickets, extend the existing §15 testing explanation. No new design/registry/gate or product surface is proposed. Hand-off: none.

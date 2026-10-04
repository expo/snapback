# Chromium GPU threads can escape a taskset-only benchmark boundary

**Status:** Open
**Date:** 2026-10-04
**Scope:** Snapback 4 browser measurement and contention harnesses
**Source:** LU round 1, eb1000; Chromium 151.0.7922.34

A LU process-tree/thread audit found 278 threads on the requested CPUs 80–89
but 16 `Thread<00>`…`Thread<15>` workers on CPUs 0–9. Those workers belonged to
the owned Chromium GPU process launched with `--use-angle=swiftshader-webgl`.
Burners remained confined. Parent-process affinity and `/proc/stat` samples on
the chosen CPUs alone therefore do not prove complete browser confinement.

LU stopped and excluded the affected run. Its formal harness and suite witness
now launch through `reports/20261003-lu-live-update-latency/tools/confine.py`:
taskset chooses at most 16 CPUs, then an unprivileged inherited seccomp filter
refuses affinity changes before Node/Chromium launch. Rendering flags are
unchanged. A self-test checks syscall denial; a corrected audit found all 284
threads on 80–89. A user systemd AllowedCPUs probe did not enforce a cpuset on
this host, so it cannot replace validation.

Audit other CPU-scoped browser harnesses before treating their launch mask as
a confinement proof. Prefer an enforced cpuset where available, or reuse the
inherited guard; verify every live thread. Also check exclusions used to keep
normal test browsers off a benchmark's physical cores. This ticket does not
claim that every historical run or browser version escaped, or invalidate
unrelated functional tests.

Evidence and qualification scope: [LU Round 1 report](../snapback4/reports/20261003-lu-live-update-latency/REPORT.md#confinement-correction).

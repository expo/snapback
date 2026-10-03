#!/bin/sh
# Real process inspection plus the exact synthetic dry-run-7 regression row.
/bin/ps "$@" || exit $?
if [ -n "${SB4_PS_SHIM_HITS:-}" ]; then
  printf 'ps\n' >>"$SB4_PS_SHIM_HITS" || exit $?
fi
printf '%s\n' '  889     1   889    -2 Wed Sep 30 06:38:25 2026     S    /usr/sbin/distnoted'
# A Linux regression host need not have PID 889. Optionally repeat the row of
# the caller-owned live fixture PID with Darwin's signed UID presentation, so
# the old parser cannot dismiss the injected metadata as an already exited PID.
if [ -n "${SB4_PS_NOBODY_PID:-}" ]; then
  /bin/ps -p "$SB4_PS_NOBODY_PID" -o pid=,ppid=,pgid=,uid=,lstart=,stat=,comm= |
    awk '{$4 = "-2"; print}'
fi

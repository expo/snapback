These are synthetic, recorded `ps -axo pid=,ppid=,pgid=,uid=,lstart=,stat=,comm=`
tables, using C locale. They contain no user process data. The distnoted row is
exactly the system row supplied with QF Round 8 from dry run 7. Other rows cover
the specified loaded-M5 shapes plus platform boundaries; they are not a captured
M5 process table. Large tables are derived in the tests, not checked in.

Darwin: signed uid_t formatting; PID/PPID/PGID zero for kernel rows; state/flags
Ss, S+, SN, Rs, S<, SNs, U, I, T, Z and ?; padded and variable lstart spacing;
comm paths with spaces and parentheses, and zombie `<defunct>`.
Linux: unsigned UID values through 2^32-1; kernel PGID zero; D, I<, t, Zs, SL,
Ssl and R+; command names with spaces and parentheses. Only Z is nonliving.

Field audit sources: Apple's [ps field definitions](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/keyword.c)
and [printers](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/print.c),
and the procps [ps manual](https://man7.org/linux/man-pages/man1/ps.1.html).
PID-family fields are decimal pid_t; UID accepts the signed Darwin and unsigned
Linux presentations. C-locale lstart has five tokens, with widths and padding
separate from meaning. State is one token (platform flags are allowed); comm
is the remaining text. Identity uses normalized lstart spacing on Darwin and
/proc start ticks on Linux. UID and comm never authorize signaling.

`ps-nobody.sh`, copied as `ps` into a directory placed first on PATH, invokes
/bin/ps and appends the exact distnoted row. Set SB4_PS_NOBODY_PID only to a
caller-owned, still-live fixture PID to also emit that process's real row with
UID -2. This makes the pre-fix regression decisive even when PID 889 is absent
on Linux: the old parser otherwise dismisses that synthetic row as vanished.
The CLI regression uses its own test process for this additional row.

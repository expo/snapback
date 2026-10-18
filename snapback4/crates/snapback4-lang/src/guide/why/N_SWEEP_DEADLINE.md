# Time: now, durations, calendar days and the dev clock — N_SWEEP_DEADLINE

`N_SWEEP_DEADLINE`: A scheduled job compares a row deadline with time and writes a status. A mutation
tests that status, or tests and writes a flag also tested by the job, without a
direct comparison of that row deadline with now.
Between sweeps the status can lag; a scheduled job is not an exact deadline.

If this is an operation deadline, compare the named row deadline with now inside
the mutation. Notification-only sweeps need no extra guard. Choose the
opening/closing direction and equality boundary explicitly; keep the sweep
for notifications or cleanup. Review row identity and helper guards before changing behavior.
This syntactic advisory can miss helper-mediated transitions or warn when a
helper already guards time, or correlate unrelated rows/branches. It proves neither a vulnerability nor safety.

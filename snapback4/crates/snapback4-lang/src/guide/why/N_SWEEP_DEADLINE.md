# Time: now, durations, calendar days and the dev clock — N_SWEEP_DEADLINE

`N_SWEEP_DEADLINE`: A scheduled job changes a status from a time comparison, but a mutation tests
that status without directly comparing the same row deadline with now.
Between sweeps the status can lag; a scheduled job is not an exact deadline.

Compare the named row deadline with now inside the mutation. Choose the
opening/closing direction and equality boundary explicitly; keep the sweep
for notifications or cleanup. Review helper guards before changing behavior.
This syntactic advisory can miss helper-mediated transitions or warn when a
helper already guards time. It proves neither a vulnerability nor safety.

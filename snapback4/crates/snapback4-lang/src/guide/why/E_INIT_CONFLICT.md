# Language — E_INIT_CONFLICT

E_INIT_CONFLICT means `init` found files or package entries it would
overwrite, and wrote nothing. To add a starter beside your own files, rerun
with `--skip-existing`: every existing file (including `snapback/*.q`) is kept
exactly as it is and only the missing files are written. Starter screens call
the starter schema's operations; adapt them to your schema after `check`.
Otherwise rename the listed files, then rerun `snapback4 init --web` (or
`--expo`). Reconcile named package.json entries in either case. Never init
into another directory and copy it over yours: that overwrites your schema.
Unrelated files and symlinks can stay. An existing README.md stays intact;
the starter writes its setup instructions to README.snapback.md instead.

Your `snapback/*.q` is never a conflict: init keeps it and leaves the
starter's schema out. When the listed files are the starter an earlier init
wrote, run `snapback4 init --adapt` instead: it removes the todo starter's
unmodified fixtures and rewrites its unmodified screen for your schema's
sign-in.

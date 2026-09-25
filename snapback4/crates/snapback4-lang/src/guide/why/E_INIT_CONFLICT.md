# Language — E_INIT_CONFLICT

E_INIT_CONFLICT means `init` found files or package entries it would
overwrite, and wrote nothing. Rename the listed files or reconcile the
named package.json entries, then rerun `snapback4 init --expo` (or `--web`).
Unrelated files and symlinks can stay. An existing README.md stays intact;
the starter writes its setup instructions to README.snapback.md instead.

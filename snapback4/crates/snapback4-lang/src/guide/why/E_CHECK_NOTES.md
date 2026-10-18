# E_CHECK_NOTES

E_CHECK_NOTES means the project’s snapback/check-notes.json is invalid or cannot be read or written. Inspect and repair it or remove it, then rerun check --ack-notes after reviewing the current findings. Unsupported versions and malformed digests refuse instead of silently hiding notes. Errors cannot be acknowledged. See guide programs.

After reviewing the current compiler findings, run `snapback4 check --ack-notes`.
It writes `snapback/check-notes.json`, which can be committed with the schema.
Normal check prints only new notes and a reviewed-count summary; `--verbose`
shows all findings. Any edit, addition or removal in the project's
`snapback/*.q` source set invalidates the reviews, as does a changed diagnostic.
`--fix --ack-notes` reviews the successfully checked result after applying fixes.
Store adoption and fixture/readiness notes remain live and cannot be acknowledged.
Errors cannot be acknowledged, and malformed review files fail with E_CHECK_NOTES:
inspect and repair or remove the file, then review again. There is no automatic
overwrite of an invalid file. Notes still do not change check's success status.

JSON retains all Diagnostic findings in `notes`; `newNotes` and
`acknowledgedNotes` are disjoint arrays of those same findings whose union is
`notes`. Search certificates remain separate. Stale entries do not count as
reviewed. The file hashes lexically sorted module filenames and exact source
text; it contains no absolute machine paths or package-version pin.


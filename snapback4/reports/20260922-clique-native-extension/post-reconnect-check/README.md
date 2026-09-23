# Post-reconnect stopped-store evidence supplement

This fresh read-only inspection supplies a standalone receipt for the final
candidate acquisition's 248-membership count. It does not rewrite the frozen
native evidence packet or attribute the membership count to the offline phase.

The existing checker ran on an APFS copy of the preserved stopped Documents
snapshot. The preserved original was only hashed, never opened with SQLite.
Every source file was hashed before and after; both manifests match exactly.
`receipt.json` records argv, UTC times, exit status, checker/fixture identities,
snapshot identity and stdout/stderr hashes. `stdout.json` is the actual
unmodified checker output: 10,000 exact messages and 248 membership rows.
The source snapshot's database, WAL and SHM all participate in its manifest.

The inspection clone remains on M5 in this directory's
`stopped-documents-inspection-copy/`; it is not copied into this small supplement.
No app, simulator, backend, build or provider worker was started. The source
report and frozen final-candidate packet were not modified.

# Charter — align client-package test doubles with the strict reference-kind gate

**You do not commit.** Use apply_patch. Touch ONLY packages/snapback-client
test files (*.test.mjs) and, if truly required, test helper modules — never
production sources.

The strict LLP 0238 D1 gate (commit fc31cf716) now refuses any non-string
reference object whose kind is missing/unknown/malformed, BEFORE transport.
`packages/snapback-client/package.test.mjs:334` fails: it (and possibly
other suites in the chain) builds minimal reference doubles without a
runtime kind. These doubles predate the gate; the gate is correct.

Task: find every test double in the client package chain that now trips the
gate (run the full chain to flush them out:
`env -u FORCE_COLOR SNAPBACK_CLIENT_RQS_DIR=/tmp/rqs-fix npm test
--workspace @expo/snapback-client`) and give each double the correct kind
discriminant for the verb it exercises (kind: 'Query'|'LiveQuery'|
'Mutation'|'Action'|command descriptor shape) — do NOT weaken the gate, do
NOT special-case test mode in production code.

Verify: the COMPLETE client chain passes; also re-run
reference-kind.test.mjs to prove the gate tests still pass. Report
(REPORT-doublesfix.md): every double fixed (file:line, verb, kind added),
chain tail verbatim.

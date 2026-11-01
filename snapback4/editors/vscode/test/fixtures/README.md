# Captured security envelopes

Captured from the real `snapback4/target/debug/snapback4` (0.4.50), built in this
lane on 2026-10-30. These are unedited `check --json` stdout, not constructed
security reports. `security-loosened.q` is the source of both captures.

In a temporary project, put that source at `snapback/schema.q` and put
`{"id":"note-1","owner":"dev:security-a"}` followed by LF in
`fixtures/notes.jsonl`. First replace `read <- allow` with
`read <- .owner = viewer` and run the real binary's `check --ack-notes --json`
from the project directory (exit 0). Restore the broad rule while keeping the
owner-only invariant, then run `check --json` (exit 1):
`security-loosened.json`. Finally write `{}` to `snapback/security-reviews.json`
and run `check --json` again (exit 2): `security-notes-error.json`.
The scenario is `a_security_refutation_never_acknowledges_compiler_notes` in
`crates/snapback4/tests/check_notes.rs`.

The wrapper tests replay these captured envelopes through a temporary executable
so no security campaign runs on each editor test. The pending-review-only test
is separately labelled synthetic; it uses the disposition fields from
`verbs/security_reviews.rs`. No compiler source or acceptance rule changed.

Round 2 adds `security-synthetic.q` and `security-synthetic.json`, captured on
2026-10-30 from the same real 0.4.50 binary. Put the source at
`snapback/schema.q` in an otherwise empty temporary project and run
`snapback4 check --json` from that project. No fixtures or acknowledgments are
needed. Exit 0 and `ok: true` accompany the refuted invariant at `schema.q:8:1`
whose reachability is `synthetic-operation`; the JSON is unedited stdout.
This is the schema from `synthetic_refutation_is_visible_but_does_not_fail_acceptance`.
The replay must print no `E_SECURITY_INVARIANT`. Separate constructed variants
cover both failing reachabilities, `trusted-seed-only`, a missing counterexample,
and same-index acknowledged notes (including absent review dispositions).

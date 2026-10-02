# Round-2 failure ledger

No baseline failure is claimed without a current-main reproduction.
Raw evidence named below may have a `.gz` suffix for lossless storage.

| Invocation | Classification | Disposition |
|---|---|---|
| Initial edit/test launch from `snapback4/` with root-relative paths | Ours, orchestration | Python and log redirection reported missing paths before any edit/test ran; corrected the working directory/path. |
| First affected Rust compile (`affected-compile-error.log`) | Ours | New blocked-worker test had an unconstrained channel type, E0282. Specified `channel::<()>`; the next complete binary test run passed 225/0 (four ignored). |
| First baseline build (`base-build-missing-inputs.log`) | Ours, incomplete build input | The archived baseline omitted `apps/chat` and `apps/chat-expo`, causing 23 `include_str!` errors. Added those exact files from 9845a1f013 and rebuilt. This is not a baseline product failure. |
| Round-1 partial-exit negative control (`partial-exit-negative.log`, exit 101) | Expected falsification | New test with round-1 pool source times out with `queued request stranded`; the same test passes with the fix. |
| Doctor with injected scheduling failures (`doctor.log`) | Expected refusal | Both child CLI calls exit 1 and name the failure class/time plus independent startup evidence; the controlling probe exits 0. |
| Copy of the old temporary Darwin wrapper after qualification | Environmental artifact cleanup | `/tmp/ct-macos-check` had disappeared. The successful check log remains; unchanged round-1 wrapper templates are retained under `inputs/` with `REPOSITORY_ROOT` substitution. No product/check failure is attributed to this cleanup. |

The one complete-suite invocation exited 0 and reported exactly
`== 0 failure(s) in 1364 s`. Every phase passed; client tests were 5,742 passed,
0 failed, 10 skipped, and client models were 79 passed, 0 failed. All final
affected/guide/lifecycle/KA and harness checks passed. No complete-suite failure
or baseline product failure is claimed, so no historical result is used as a
substitute for current-main verification.

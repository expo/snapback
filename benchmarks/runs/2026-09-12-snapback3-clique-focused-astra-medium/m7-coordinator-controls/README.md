# Bounded M7 coordinator controls

These are separate coordinator observations after grading, not a new grade or a
repair. The app and fixed SDK were unchanged. [Inputs](inputs.json) bind fresh
copies to the frozen grader snapshot and preserve the original browser profile
identity. Databases, browser profiles and authentication material remain private.

## Observations

The original operation `731cbc48-b0ea-4e0a-819d-a74e5bc59a19` reports **parked**
with `S3_OPERATION_CHANGED`: “This saved change uses an older application. Review
it before submitting a new change.” Both `client.operation(id).getSnapshot()`
and the client's pending list expose that status. It was already parked when
the copied profile reopened offline and remained so during **25,036 ms** online.
There was no terminal receipt. Complete fresh server DM queries before and after
returned six rows at sequence 41; message
`m7-old-client-53b5260a-4163-4f90-bc91-5e937ce2d100` was absent.
This bounded observation does not establish an indefinite wait. The operation
was not replaced, retried under a new identity, modified or dismissed.

Dave's four explicit `polls.get` refreshes for the existing grader bounds poll
returned **status `denied`, fresh `true`, complete `false`, error `NOT_MEMBER`**
at sequence 186, with no data. The original helper discarded status/error;
its output cannot establish endless loading. The old-client helper similarly
read nonexistent `OperationSnapshot.state` instead of `status`.

The [fixed SDK source excerpt](source-facts.json) shows `dismissOperation`
rejecting entries without a receipt with `S3_OPERATION_PENDING`. No destructive
dismissal probe was performed. This contradicts the guide's claim that the method
can acknowledge parked work; it does not show that safe parked-intent recovery
was implemented by this experiment.

See [raw observations](results.json), [process cleanup](cleanup.json), and
[the exact executed probe](probe.mjs). All recorded owned process identities
were absent or exited after cleanup, and ports 54910/54903 were free.

## Custody and reproduction

Private packet: `/home/ccheever/snapback3-clique-focused-20260912/packet` on EPYC.
Preparation copied `snapshots/m7-grader-final/grading/app-oldclient` and
`grading/app-final` into
`lanes/astra-snapback3-m7-coordinator-controls-20260912`, made only those copies
writable, and copied the frozen closed `grading/private/oldclient/old-client-profile`.
The completed grade lane's unchanged `dist` supplied static assets; copied app
symlinks resolve to that copied `dist`. No app source was rebuilt. The original
old-client DB and bounds-mutated DB differ, so they remain separate controls:
54910 serves the former, 54903 the latter. There was no cross-database profile
substitution. Dependency and authentication helpers come from the completed
grade lane, with credentials kept outside these public artifacts.

From the packet, the executed command was:

```sh
/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node \
  lanes/astra-snapback3-m7-coordinator-controls-20260912/probe.mjs \
  lanes/astra-snapback3-m7-coordinator-controls-20260912 \
  lanes/astra-snapback3-m7-grade \
  lanes/astra-snapback3-m7-grade/scripts/api-lib.mjs
```

The first helper attempt polled `/health` instead of `/api/health`. Both owners
were ready, but the helper timed out before any browser or poll observation.
[Its source](probe-attempt-1.mjs), [failure results](attempt-1-results.json) and
[PID/start-tick cleanup receipt](attempt-1-cleanup.json) are retained. After exact
owned-process cleanup, the single corrected retry used new copies of the frozen
inputs. The first private lane remains under the same path with `-attempt-1`
appended. No product failure is inferred from that helper mistake.

No DB, browser session/profile, credentials, or raw model stream is public here.
The collection manifest hashes every published artifact; private paths in the
receipts describe custody, not downloadable public files.

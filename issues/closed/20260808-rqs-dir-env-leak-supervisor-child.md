# Supervisor child inherits SNAPBACK_CLIENT_RQS_DIR and silently blocks binding-receipt persistence

**Status:** Resolved 2026-08-10
**Filed:** 2026-08-08 (run-6 N≥3 series residue, round 4; diary 0072; record 2026-08-08-messaging-0115-n3.md)

When `SNAPBACK_CLIENT_RQS_DIR` is set in the supervisor's environment, the dev supervisor's internal JS client inherits it and takes the file store's single-writer lock; `commitReactBindingReceipt` then terminally refuses with `SNAPBACK_REACT_BINDING_RECEIPT_NOT_PERSISTED { result: false }` and nothing names the other-process-writer cause. Diagnosed from package source by the C-bare lane; fixed by scrubbing the env var from child processes.

**Ask:** either scrub/namespace the var for supervisor children, or make the refusal name the competing writer (pid/path), per the errors-as-docs bar (LLP 0193).

## Resolution (2026-08-10)

Both diagnostic and isolation sides are implemented. The Expo supervisor
constructs one child environment with `SNAPBACK_CLIENT_RQS_DIR` removed and
uses it for the backend, authority helper, forwarding, Metro, and watch
assessment without mutating the parent environment. If another writer still
owns a file store, `SNAPBACK_REACT_BINDING_RECEIPT_NOT_PERSISTED` now includes
the competing PID when known, competing instance id when available, lock
path, and store path. Same-process and live foreign-writer tests pin both
shapes.

## Resolution — 2026-08-10

The Expo supervisor derives one child environment with
`SNAPBACK_CLIENT_RQS_DIR` removed (caller env not mutated) and passes it to
the backend, authority helper, device/forwarding helpers, Metro, and watch
assessment. The file-store binding-receipt refusal now names the competing
writer: `SNAPBACK_REACT_BINDING_RECEIPT_NOT_PERSISTED` carries competing PID
(when known), instance id, lock path, and store path; same-process and live
foreign-writer cases covered (rqs-store-file suite 15/15; Metro advisory
suite green).

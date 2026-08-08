# Supervisor child inherits SNAPBACK_CLIENT_RQS_DIR and silently blocks binding-receipt persistence

**Filed:** 2026-08-08 (run-6 N≥3 series residue, round 4; diary 0072; record 2026-08-08-messaging-0115-n3.md)

When `SNAPBACK_CLIENT_RQS_DIR` is set in the supervisor's environment, the dev supervisor's internal JS client inherits it and takes the file store's single-writer lock; `commitReactBindingReceipt` then terminally refuses with `SNAPBACK_REACT_BINDING_RECEIPT_NOT_PERSISTED { result: false }` and nothing names the other-process-writer cause. Diagnosed from package source by the C-bare lane; fixed by scrubbing the env var from child processes.

**Ask:** either scrub/namespace the var for supervisor children, or make the refusal name the competing writer (pid/path), per the errors-as-docs bar (LLP 0193).

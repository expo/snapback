# A cold-installed package fails `doctor` by racing its own auth-mode transition

Status: open
Date: 2026-08-25
Systems: snapback-cli, snapback-auth
Related: issues/20260819-security-gates-expected-red-until-f1.md,
  llp/0283-post-rearchitecture-followups.plan.md

## Symptom

The F-3 npm closure install witness fails deterministically. Run twice from fresh temporary
application directories:

```sh
node scripts/snapback-package-cold-install.mjs --receipt dist-publish/cold-install-receipt.json
```

Both runs failed identically:

```text
snapback-package-cold-install: .../node_modules/.bin/snapback doctor --json failed (1)
```

with the packaged doctor reporting:

```text
SNAPBACK_DEV_SERVER_SEED_FAILED: seed load failed
SNAPBACK_AUTH_MODE_PENDING: app-data admission is closed for an auth-mode transition
```

## Where it comes from

| Step | Location |
|---|---|
| Witness invokes doctor | `scripts/snapback-package-cold-install.mjs:2694` |
| Non-zero subprocess becomes the harness failure | `scripts/snapback-package-cold-install.mjs:161-163` |
| CLI labels the native seed failure | `packages/snapback-cli/index.mjs:5017-5026` |
| Runtime constructs the underlying refusal | `crates/snapback-auth/src/auth/admission.rs:1443-1448` |

## Diagnosis

This is a real deterministic sequencing bug, not a missing environment. The packed runtime launches
correctly and with the right clean-release identity — that part of the chain is healthy. The packaged
`doctor` then immediately performs an unversioned seed reset **while auth-mode admission is closed
for a transition**, and that path has no wait or bounded retry for `SNAPBACK_AUTH_MODE_PENDING`.

The consequence stated plainly by the lane that found it: *a correct environment cannot make this
gate reliable.* No amount of machine configuration fixes it; the doctor activation sequence needs
synchronization or a bounded retry.

## Why this matters beyond the gate

This is the **first-run path for a new install**. Someone who installs the package and runs the
documented first command hits it. The F-3 gate is how we found it, but the gate is not the victim —
the user is.

## What the fix must not be

A blind retry loop would make the gate green while leaving the ordering undefined. The question to
answer first is *why* admission is closed at that moment: whether `doctor`'s seed reset legitimately
races an activation it should wait for, or whether it should not be seeding at that point at all.
Bounded retry is acceptable as the answer only if waiting is genuinely correct and the wait is
bounded and reported.

## Adjacent facts established at the same time

- The publication ledger is **not** a publish-host-only artifact. The producer is
  `node scripts/snapback-publish.mjs`, which packs the host closure, runs `npm publish --dry-run`,
  writes `dist-publish/publish-ledger.json`, and publishes nothing. It requires
  `SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build --release --bin snapback` first;
  `scripts/assemble-runtime-package` alone yields a contributor-source binary that the publisher
  correctly refuses with `SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED`
  (`packages/snapback-runtime-darwin-arm64/prepare-runtime.mjs:188` via
  `scripts/runtime-package-authority.mjs:119-125`). After the public-package build, packing produced
  13 rows all `dry-run-ok`, bound to a clean commit with `sourceDirty:false`.
- A current-commit **published** smoke cannot run before publication — the staged closure is `0.1.0`
  and the registry returns E404 for `@expo/snapback-cli@0.1.0`. As an environment control, the
  published `0.1.27` ancestor passes `scripts/published-closure-boot-smoke.mjs --version 0.1.27`.

## Resolution (2026-08-25)

The unversioned seed is a legitimate compatibility input for the `todo-contract` fixture. The
ordering bug was earlier: doctor started an empty dev-mode runtime, provisioned the generated
sessions deployment after bind (which correctly staged the mode change and closed app-data
admission), then attempted that legacy seed before the required sessions restart.

Doctor now gives a sessions deployment to the runtime's cold-start artifact carrier and waits up
to 15 seconds for the runtime ready file. That file is written only after pre-bind auth activation,
so it is the actual readiness signal rather than a retry heuristic. The bundle-load diagnostic
reports the requested mode, readiness signal, bound, and carrier choice. Doctor skips the redundant
post-bind schema/function provision, loads the legacy seed after readiness, and performs its query,
mutation, and live checks through a temporary real session. Cleanup now closes session custody
before stopping the runtime and tolerates the documented transient recursive-removal race.

The deterministic regression wraps the native runtime and injects
`SNAPBACK_AUTH_MODE_PENDING` if a legacy seed reset arrives without the sessions startup carrier.
Before the production change it failed with one failed test and
`SNAPBACK_DEV_SERVER_SEED_FAILED` wrapping the injected `SNAPBACK_AUTH_MODE_PENDING`; after the
change it passes. A fresh `todo-contract` debug reproduction exits 0 and reports
`SNAPBACK_DOCTOR_BUNDLE_LOAD_OK` with `signal: runtime-ready-file`, followed by query, mutation,
live, and shutdown OK diagnostics. `node scripts/check-inventories.mjs` passes with 354 package
tests, 29 script tests, 31 demos/catalog entries, 487 publication leaves, and 157 guide pages/1871
snippets. The F-3 packed witness is recorded in the follow-up note below after running from the
clean resolution commit.

### F-3 follow-up

The single bounded F-3 attempt used clean commit `eaab3919c`. The public-package release build
finished successfully, and `node scripts/snapback-publish.mjs` produced 13 `dry-run-ok` rows with
`sourceDirty: false`. The cold-install witness passed the packaged doctor point that originally
failed and advanced to the later scaffold `npm run prove` step. It exited 1 there because the
checked-in starter acceptance returned incomplete registered-path evidence:
`SNAPBACK_VERIFY_COVERAGE_PATH_INCOMPLETE` for `list-todos` and `create-todo`, followed by
`SNAPBACK_VERIFY_STARTER_ACCEPTANCE_FAILED`. No cold-install receipt was minted. That acceptance
fixture/proof mismatch is outside this ticket; the one-attempt bound was honored and the witness was
not rerun.

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

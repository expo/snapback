# F-3 npm closure: the exact 13-package witness is blocked on a Linux artifact

**Status:** Open
**Filed:** 2026-08-21
**Relates:** LLP 0283 F-3 item 3 (npm closure pack + install witness), LLP 0041

## What is actually proven today

Verified on Darwin arm64, unsandboxed, after `2fa5b1fc8` fixed the
build-identity regression that was making the assembler reject its own binary:

- The sealed Darwin runtime assembles with no ambient identity overrides.
  `snapback build-identity` reports the exact HEAD commit with
  `gitDirty: false`.
- The host closure — 12 of 13 packages — packs and passes `npm publish
  --dry-run`.
- A scratch install resolves the CLI's complete Darwin closure, scaffolds and
  generates an app, launches the sealed binary, and creates the restricted
  Hermes handler VM.
- `packages/snapback-runtime-darwin-arm64/package.test.mjs` passes, including
  the regression asserting an unstamped executable is still rejected.

No publication occurred. `npm publish` was only ever invoked with
`--dry-run`; `SNAPBACK_PUBLISH_CONFIRM` was never set.

## What is not proven, and why

`scripts/qualified-staging-assemble` requires BOTH
`SNAPBACK_STAGING_LINUX_ARTIFACT` and `SNAPBACK_STAGING_DARWIN_ARTIFACT` to
bind one exact source-revision closure. Without it there is no
`dist-publish/publish-ledger.json`, and `scripts/snapback-package-cold-install.mjs`
correctly refuses (exit 1, "publication ledger is missing") rather than
proving a partial closure.

So the canonical cold-install proof has never run, and cannot run here:

- No container runtime is installed (docker, podman, colima, orbstack all absent).
- Every machine in the fleet is Darwin arm64. There is no Linux host.

This is an infrastructure gap, not remaining engineering. The honest state is
"Darwin-complete, Linux-unproven" — a Darwin-only ledger must NOT be
synthesized to make the gate green, because the gate's whole purpose is
binding two independently built runtimes to one source revision.

## Concrete unblock

Produce the Linux artifact on a Linux runner — GitHub Actions is the obvious
candidate since CI already runs there — publish it as a build artifact, then
run `qualified-staging-assemble` with both artifacts and execute
`snapback-package-cold-install.mjs` against the resulting ledger.

Until then, any npm closure claim must be scoped to Darwin and must say so.

## Related

- `issues/20260803-linux-hermes-release-carrier-gap.md`
- `issues/20260810-linux-runtime-glibc-symbol-version-baseline.md`

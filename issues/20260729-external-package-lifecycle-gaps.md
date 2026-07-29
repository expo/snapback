# Make the external package and lifecycle path self-contained

**Status:** Open  
**Area:** Package publication, client declarations, installed runtime lifecycle  
**Found by:** LLP 0102 final Snapback confirmation  
**Date:** 2026-07-29  
**Governing:** LLP 0041, LLP 0102; remediation item SB-015

## Problem

The exact frozen source completed all five application confirmations from
staged packages on macOS and Linux, but clean external projects still needed
product-external adaptations:

- `@snapback/client/online` is a published export without a TypeScript
  declaration, so ordinary external builds fail with TS7016;
- installed start/readiness/provenance/stop requires custom orchestration and
  knowledge of sessions inspection headers;
- `snapback stop` removes the server, ready marker, and impersonation carrier
  but leaves its owner-only `.secret-read-root` for outer directory cleanup;
- Linux package preparation needed lane-local ICU/curl development files,
  exact Hermes patching, and an explicit Volta binding under isolated HOME;
- a correctly refused group-writable startup artifact did not identify the
  rejected mode, ownership, or ACL predicate; and
- the tested packages are an immutable dry-run closure, not a public registry
  release.

These are product-distribution and lifecycle findings. They do not invalidate
the package-only runtime results or turn staged packages into a public-release
claim.

## Required outcome

- Every public package export ships matching TypeScript declarations.
- A documented package-owned helper starts an exact installed runtime, waits
  for readiness, reports nonsecret binary/bundle identity, negotiates the
  active public inspection profile, and stops it.
- Stop either retires every process-bound secret sidecar it created or returns
  a typed cleanup plan naming deliberately retained state.
- Secure artifact refusals identify the failed inode predicate without
  disclosing contents.
- Fresh supported macOS and Linux hosts can prepare and consume the published
  runtime without manual system-package extraction, implicit sibling
  checkouts, or tool-manager discovery.
- A public package publication/installation proof replaces the staged-only
  closure before public availability is claimed.

## Evidence

- `demos/backend-bakeoff/reports/final-confirmation/package/`
- `demos/backend-bakeoff/arms/todo/snapback/final-confirmation-handoff/linux-x64/`
- `demos/backend-bakeoff/arms/chat/snapback/final-confirmation-handoff/linux-x64/`
- `demos/backend-bakeoff/arms/linear/snapback/final-confirmation-handoff/`
- `demos/backend-bakeoff/arms/partiful/snapback/final-confirmation-handoff/`
- `demos/backend-bakeoff/arms/research-room/snapback/final-confirmation-handoff/`
- `diaries/0027-todo-backend-bakeoff.diary.md`
- `diaries/0028-chat-backend-bakeoff.diary.md`
- `demos/backend-bakeoff/reports/deep-remediation.v1.json`

## Acceptance

On fresh supported macOS and Linux machines with empty caches, install the
public packages into external Todo and Chat projects, typecheck every public
subpath without ambient shims, generate and build offline, start and verify the
exact package/bundle identities through the supported helper, then stop. The
helper's final receipt reports no process, listener, impersonation carrier, or
secret-read sidecar. No repository-relative import, sibling checkout, or
manual host dependency extraction is present.

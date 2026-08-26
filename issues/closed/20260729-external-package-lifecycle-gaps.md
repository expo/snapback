# Make the external package and lifecycle path self-contained

**Status:** Closed
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

## Triage freshness note (2026-08-01 sweep) — 3 of 6 bullets landed

Landed since filing: (bullet 1) ./online ships types
(packages/snapback-client/package.json → online.d.mts, guarded by
scripts/check-package-export-types.mjs; closed via
issues/closed/20260730-move5-runtime-qual-and-types-sweep.md); (bullet
3) .secret-read-root teardown fixed
(issues/closed/20260801-0137-g1-orphaned-secret-read-root-sidecar.md);
(bullet 6) the staged-only closure is superseded by the public 0.1.7 and
0.1.8 publications (253cb838). Still open: the packaged
readiness/identity half (now owned by issues/20260801-0137-g1-guide-gap-
packaged-runtime-readiness-receipt.md), the Linux host-prep bullet, and
the inode-predicate refusal bullet. Note sweep-report.md lists
'external-package lifecycle' among the frozen-epoch verdicts REVERSED on
the merits — the ticket's framing predates that.

## Narrowing (2026-08-01, backlog lane P) — bullet 5 fixed; 2 remain

Of the three bullets the 2026-08-01 sweep left open:

- **Inode-predicate refusal bullet: FIXED.** Secure startup-artifact
  refusals now identify the failed inode predicate without disclosing
  contents. `crates/snapback/src/secure_file.rs` names the observed kind for non-regular
  files, observed-vs-effective uid for ownership, observed octal mode
  against the required 0600 (or clear group/other-write bits for
  executable artifacts), and the observed hard-link count; the extended-ACL
  refusals already named their predicate. The packaged lifecycle's JS
  surface (`managedAdminToken`, packages/snapback-cli/index.mjs) reports
  the observed mode and the exact failed predicate list on its
  owner-only-carrier refusal. Witness: `cargo test --lib secure_file`
  (10/10) and `--lib owner_only` (9/9); cli package suite green.
- **Packaged readiness/identity helper half: owned elsewhere** —
  issues/20260801-0137-g1-guide-gap-packaged-runtime-readiness-receipt.md
  carries it; it is no longer tracked by this ticket.
- **Linux host-prep bullet: still open, needs a Linux lane.** Removing the
  lane-local ICU/curl development files, exact Hermes patching, and
  explicit Volta binding from fresh-host preparation is Linux
  runtime-packaging work that cannot be exercised from a macOS lane; this
  is now the ticket's only remaining scope.

## Resolution

Closed 2026-08-26 (July/early-August leftover sweep) as **absorbed**.

All six original bullets have landed or moved:

1. `@snapback/client/online` types — landed (see 2026-08-01 note).
2. Packaged readiness/identity helper —
   `issues/closed/20260801-0137-g1-guide-gap-packaged-runtime-readiness-receipt.md`.
3. `.secret-read-root` teardown — landed.
4. Linux *consumer* ICU/curl self-containment —
   `issues/closed/20260808-linux-runtime-icu-dynamic-link-portability.md`
   (0.1.18). Builder-side residuals live in
   `issues/20260810-linux-runtime-glibc-symbol-version-baseline.md` and
   `issues/20260803-linux-hermes-release-carrier-gap.md`.
5. Inode-predicate refusals — landed (2026-08-01 narrowing).
6. Public registry publication — 0.1.7 onward; newest closure 0.1.27.

Do not reopen this umbrella. Follow the two remaining Linux-builder tickets.

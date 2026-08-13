# Default file RQS/outbox store is created world-readable

**Opened:** 2026-08-12 · **Severity:** P2 (security; local multi-user hosts) · **Area:** client / store / secrets

## What

Default Node store is `~/.snapback/rqs`. `writeFile` / `writeFileExclusive` in `packages/snapback-client/rqs-store-file.mjs:163-166` pass no `mode`. With umask `022` blobs are `0644`. Contents include RQS resume tokens and the v3 outbox (mutation args, authority descriptors). Comments defer encryption to Q4 and claim “OS-level protection,” but never set `0600`.

CLI secret files elsewhere *do* use `0o600` (`src/secure_file.rs`, `src/owner_only_file.rs`, `src/cli.rs`).

## Why it matters

On a shared Unix host any local user can read resume tokens and pending mutation payloads.

## Fix

`writeFile(..., { mode: 0o600 })`, `mkdir(..., { mode: 0o700 })`, and `chmod` existing blobs on open. Same for lock files. At-rest encryption remains the Q4 follow-on.

## Confidence

High. Not covered by the existing outbox-writer ticket (`issues/20260811-authority-scope-outbox-writer-and-party-wall-live-wall-reds.md`).

## Resolution (2026-08-12)

The default Node files adapter now creates the store directory with mode
`0700` and blobs, atomic-write temporaries, and lock files with mode `0600`.
Store open best-effort chmods an existing directory, identity blob, and lock;
adapters with missing or unsupported chmod semantics remain available. Q4
application-level encryption remains intentionally open.

Coverage asserts the live directory/blob/lock modes, simulates permissive
legacy carriers and verifies chmod-on-open, and proves an `ENOTSUP` chmod does
not fail store use. The final affected-suite command reported verbatim:
`tests 128`, `pass 128`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0`.

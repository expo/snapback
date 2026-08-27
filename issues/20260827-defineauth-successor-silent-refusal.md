# `defineAuth` `minimumLength` change silently refused through the successor flow (silent-degradation class)

**Status:** Open
**Opened:** 2026-08-27
**Systems:** Auth catalog, Schema successors, Diagnostics
**Source:** Clique benchmark matrix (published Snapback 0.1.29), glm-snapback-explicit lane

## Problem

A lane changed a `defineAuth` password `minimumLength` bound and applied it through the
normal successor flow. The change **silently refused to apply** — signup kept enforcing
the OLD bound — and only took effect after a full store reset. No diagnostic was emitted.

Quoted (`glm-snapback-explicit`): a `defineAuth` `minimumLength` change "silently refused
to apply through the normal successor flow"; signup kept returning the old bound until a
full store reset.

## Why this is worth a ticket (silent-degradation class)

This is the failure mode Snapback otherwise avoids well. The same matrix praised Snapback's
diagnostic precision repeatedly ("the platform told me exactly what was wrong every time")
and every OTHER auth/schema refusal in the run was loud and coded
(`CODEGEN_MODULE_EVALUATION_FAILED`, `SNAPBACK_AUTH_PROGRAM_INVALID`,
`SNAPBACK_SEED_MIGRATION_REQUIRED`, etc.). A change that is **neither applied nor loudly
refused** is the worst outcome: the author believes the new bound is live when it is not.
It should either apply through the successor, or fail with a specific
`SNAPBACK_AUTH_*` / successor diagnostic explaining that an auth-catalog change of this
kind requires a store reset (or whatever the real constraint is).

## Verification plan

On published 0.1.29: scaffold auth with a password mechanism at `minimumLength: N`; apply a
successor changing it to `minimumLength: M`; attempt a signup with a password of length in
`[N, M)`. Observe whether the new bound applies, is loudly refused with a coded diagnostic,
or silently no-ops (reproducing the report). If it silently no-ops, that is the bug: the
successor path for auth-catalog value changes needs either application or a loud refusal.

## Related

The auth-catalog successor semantics may intentionally not support in-place value changes
for some fields; if so, the gap is a **missing diagnostic**, not a missing feature — but
silence is still wrong. See also the familiar-profile custody/auth docs gaps recorded in
the matrix synthesis.

## Owner

Auth catalog / schema successors. Reproduce before classifying as bug-vs-intended; if
intended, the fix is a loud diagnostic + a guide note.

# Password provider's 12-character minimum is not obviously configurable

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lane `sol-snapback-simplified` (0.1.21) ·
**Systems:** Auth, Guide

## Problem

The built-in password provider defaults to a 12-character minimum. Clique's
product spec requires accepting 8+, and the lane recorded the mismatch as
friction — it either couldn't find a policy knob or there isn't one. Either
way the fix is small: if the minimum is configurable, the auth guide page
and the refusal text should say how; if it is not, add a bounded policy
option (with 12 staying the default).

## Evidence

- `lanes/sol-snapback-simplified/diary.md` M1 ("the password provider
  defaults to a 12-character minimum even though Clique specifies at least
  eight").

## Suggested fix

Confirm whether a policy knob exists; add one if not; document it either
way on the auth guide page next to the password program example.

## Resolution

Resolved 2026-08-15. No public policy knob existed. Password mechanisms now
accept `minimumLength` from 8 through 128, with 12 remaining the default; all
declared password mechanisms must agree on the app-wide value. Codegen carries
the selection into the startup schema, startup constructs the provider from
that selected artifact, and policy refusals report the effective minimum plus
the `defineAuth` configuration path without echoing the secret.

Codegen tests prove validation/default behavior, and focused Rust tests prove
both first-boot startup selection and admission/refusal details for a configured
eight-character minimum. The auth guide and generated manifest schema now
describe the setting and restart boundary.

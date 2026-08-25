# Q23 — development-mode impersonation: decision brief

**Status:** Open — needs an author decision
**Systems:** Auth, Engine, Kernel
**Date:** 2026-08-25
**Related:** LLP 0303 (Q23, "still open — approved in part only"),
  `issues/20260824-q04-membership-writer-route-enumeration.md`

## Why this is on the critical path now

LLP 0303 parked Q23 as a product decision. It has stopped being parkable: an executable review
defeated **Q04** — the highest-footprint lane in the programme, which took the privilege-surface
ratchet from 105 to 44 in its branch — through exactly this arm. From a **default-feature dependent
crate, no features enabled**:

```
ResolvedAppAuthority::DevImpersonation { forged-user, local_dev_only: true }
  → DbRead::admit_membership_authority → membership_writer_for_function → plan/commit
```

It committed two rows to the first database and another to a second. Q04 cannot fully close while
this arm's policy is undecided.

## What the ruling already settled

> Approved: it must be **impossible, and tested as impossible**, for development mode to be active in
> a deployed environment.

That half is ruled and is being implemented. It is not what is blocked.

## What is actually open

> Open: whether in-development impersonation is **unrestricted, owner-bound, or fixture-bound**.

## What the code does today

`ResolvedAppAuthority::DevImpersonation { user_id, local_dev_only }` is one arm of the resolved
authority enum, treated alongside `Session` and `RevalidatedPrincipal` at the sites that extract a
user (`crates/snapback-engine/src/local/engine.rs:7101`, `:13776`, `:13807`) and grouped with
`Anonymous`, `AdminBypass` and `System` where authority kinds are classified (`:4974`).

`local_dev_only` is a **plain `bool` field carried on the value** — `crates/snapback-kernel/src/data_patch.rs:40`,
`crates/snapback-sync/src/auth/invocation.rs:359` — set `true` at the host-op construction sites
(`crates/snapback-engine/src/host_ops.rs:433`, `:445`, `:457`, `:482`) and `false` at one (`:469`).

**That is the crux.** `local_dev_only` is a claim the value makes about itself, not a fact the
environment enforces. A caller who can construct the enum sets the flag to whatever it likes, which
is why the exploit needed no features. Whatever policy is chosen below, the flag has to stop being
self-asserted.

## The three options

**1. Unrestricted in development.** Any user may be impersonated when development mode is genuinely
active. Simplest, matches most local dev tooling, and puts the entire weight on the
deployed-environment impossibility proof. Risk: a single failure of that proof is total, and the
programme has now seen several "impossible" claims fall to an executed composition.

**2. Owner-bound.** Impersonation is limited to principals the developer already controls — the app
owner, or users within a project they administer. Preserves most local ergonomics and means a mistake
in the deployed-mode gate is bounded to the developer's own users rather than arbitrary ones. Costs a
real ownership relation at the impersonation site.

**3. Fixture-bound.** Impersonation only works for users created by a test fixture and marked as
such. Strongest containment: forging a *production* user's identity is unconstructible rather than
merely refused. Costs the most in ergonomics — anyone wanting to impersonate a real local user must
first mark it — and may not fit how the demos and acceptance suites actually work.

## What I would recommend, and why it is not mine to decide

On the evidence of this programme, **(2) owner-bound** is the best trade: it keeps development
workflows usable while making the blast radius of any deployed-mode gate failure the developer's own
principals instead of anyone's. **(3)** is defensible if you weight containment over ergonomics; the
programme's history of defeated impossibility claims argues for it.

It is not a supervisor's call because it trades product ergonomics against containment, and the wrong
choice in the permissive direction re-creates precisely the false-assurance failure this programme
exists to fix.

## Whichever you choose

`local_dev_only` must become environment-derived rather than value-asserted. A boolean the caller
supplies alongside the identity it authorises is the same defect this whole ruling is about — an
authority validated for liveness while the subject rides alongside it.

# LLP 0315: Security profile boundary — the two-profile ruling

**Type:** Decision
**Status:** Active
**Systems:** Auth, Security, Kernel, Storage, Server
**Author:** Claude (Opus 5), supervising the LLP 0283 F-1 program. Recorded as a
supervisor assumption pending the author's ratification (see §6).
**Date:** 2026-08-27
**Revised:** 2026-08-27 (initial)
**Related:** LLP 0283, LLP 0303, LLP 0313 §8, LLP 0284, LLP 0311, LLP 0165,
`issues/20260826-root-identity-mechanism-survey.md`,
`issues/20260826-landing-a-cannot-establish-file-wide-authority.md`,
`issues/20260826-step-up-claimant-root-requires-new-ceremony.md`,
`issues/20260826-security-gate-is-an-instance-of-the-defect.md`

## 1. The decision

LLP 0313 §8 requires Landing C to choose a boundary. It offered two. **This
ruling takes both, names them, and makes the choice explicit at runtime rather
than in the specification:**

- **`trusted-same-uid`** — the default profile for local development. Snapback
  protects authority construction through its supported APIs and
  Snapback-controlled connections. It does **not** resist arbitrary code or
  processes running as the database-owning OS user with raw filesystem or
  SQLite access.
- **`externally-rooted`** — an opt-in profile requiring a deployment-provided
  root. It may claim same-UID resistance **only** while that root is present,
  and every root-derived operation fails closed without it.

This is rank 1 of the ten costed mechanisms in the root-identity survey. The
survey's bottom line is the reason: *Snapback cannot provide a portable,
transparent same-UID-proof root in its current local-development shape.* A
single universal claim is therefore not available to be chosen. The only
options were one honest narrow claim, one dishonest broad claim, or two honest
claims with the boundary named. This takes the third.

**Never silently degrade.** A `externally-rooted` deployment whose root is
absent refuses; it does not fall back. Falling back to `trusted-same-uid`
without an explicit operator act would reproduce exactly the defect LLP 0303
names — deriving authority from something the caller can author.

## 2. What this costs, stated plainly

The survey's own strongest counter-argument stands and is accepted, not
rebutted: **this leaves the most common local experience without the property
that motivated F-1.** Landing C can no longer make one universal "durable
forgery cut" claim. Every proof, receipt, guide page, and review must preserve
the profile qualification, and an accidental production launch under
`trusted-same-uid` is a real configuration hazard that the implementation must
make loud.

The second counter-argument — that multiple roots create a permanent semantic
matrix — is accepted as a *future* cost and deliberately deferred. This ruling
requires only that `externally-rooted` exist as a fail-closed profile with a
named root interface. It does **not** require implementing any specific strong
backend (rank 2–8) to close F-1. Implementing one is separate, later work under
its own design.

## 3. Consequence for the landing sequence

LLP 0313 §8's Landing C–E claims are rewritten as follows.

| Landing | Claim under this ruling |
|---|---|
| C | Durable forgery cut **within `trusted-same-uid`**: every supported writable connection goes through one closed gateway, cooperating processes use the instance lock, and arbitrary raw same-user file access is explicitly out of scope. LLP 0311 resource custody remains a prerequisite or atomic part. |
| D | Earliest closure candidate, **profile-qualified**. |
| E | F-1 may close as: *authority construction is un-forgeable through Snapback's supported surface under `trusted-same-uid`, and additionally same-UID-resistant under `externally-rooted` when its root is present.* |

F-1 closure does **not** require a working strong root. It requires that the
profile be explicit, that the weak profile's claim be narrow and accurate, and
that the strong profile fail closed rather than pretend.

## 4. Consequence for the security gate — the scoping rule

This is the load-bearing operational consequence, and it is what makes the
adversarial review loop finite.

`issues/20260826-security-gate-is-an-instance-of-the-defect.md` records that the
workspace security gate is itself an instance of the DERIVE-over-VERIFY defect:
it validates an authority for liveness while the subject it acts on is supplied
independently. Sixteen adversarial rounds against that gate each closed a
reported vector and were defeated by the next. That is not a run of bad luck.
The gate runs as the same UID as its attacker, so by the survey's bottom line
**the regress has no local terminator** and the loop is provably
non-terminating on this machine.

**Rule.** The gate is scored under `trusted-same-uid`, the same profile as the
product it gates. Therefore:

1. An attack that requires **only** Snapback's supported surface — the wrappers,
   the launcher, the dispatcher, argv, the pinned toolchain resolution, the
   attack inventory, the scorers, the fixtures — is **in scope**. It must be
   closed, and its regression witness must be shown to fail when the protection
   is removed.
2. An attack that requires the caller to act as **arbitrary same-UID native
   code** — overwriting a trusted toolchain binary, racing a trusted executable,
   loader injection ahead of the entrypoint, replacing checked-out program bytes,
   or otherwise authoring the root — is **out of scope for scoring**. It is
   recorded as a named residual, not as a blocking finding.
3. A residual must be *named and specific*. "Same-UID code can do anything" is
   not a residual; it is an excuse. Each residual names the exact capability
   assumed and why no local mechanism removes it.

Rounds 4 through 16 are re-read under this rule in §5.

**This rule cannot be used retroactively to dismiss a finding that was fixed.**
Everything already closed stays closed; the rule governs what future rounds may
block on.

## 5. Disposition of the sixteen rounds

Under §4 the reported vectors sort as follows. This is a scoping judgement, not
a claim that the out-of-scope items are harmless.

**In scope, and correctly fixed** — Cargo configuration loading, toolchain
channel path traversal (`path.resolve` discarding the prefix on an absolute
channel), the mtime-trusted AST helper cache, unsanitized native compiler
inputs, the caller-authored Cargo cache supplying the test executable, sourced
wrappers forging `$0`, the non-specific Node pin, the common dispatcher
accepting a preloaded Node, explicit pre-taint Perl startup, and the round-15
inventory substitution.

**In scope, and outstanding** — the round-15 finding: inventory rows are not
bound one-to-one to their witnesses. Round 16 is fixing it.

**Out of scope, recorded as named residuals** — overwriting the final trusted
toolchain binary; racing a trusted executable at the same UID; non-SIP Linux
loader injection ahead of shell entry; unauthenticated checked-out program
bytes; a caller-owned exact regular script satisfying the root check in a
synthetic repository root. Each of these was already disclaimed honestly by the
lane that found it; this ruling makes the disclaimer load-bearing rather than
advisory.

**Not a residual, and not dismissible** — the false-witness class. A regression
test for a security property must be shown to fail when that property is
removed (`issues/20260826-regression-tests-must-fail-when-reverted.md`). Round
11 found two witnesses that passed with or without their claimed protection.
Scoping does not touch this: a witness that cannot fail is worthless in every
profile.

## 6. Status of this ruling, and how to reverse it

This decision was made by the supervising agent, not by the author. It is
recorded here rather than deferred because the program had four of five landings
blocked on it and an adversarial review loop with no local terminator, and
because the survey establishes that the alternative — one universal claim — is
not available at any price short of adopting a rank 2–8 mechanism as a
precondition for closing F-1.

**To reverse:** the reversal is cheap by construction. The profile name is a
single declared value; the narrow claim wording lives in this document, LLP 0313
§8, and the gate's residual list. Choosing instead to mandate one deployment
model means deleting `trusted-same-uid`, selecting one rank 2–8 mechanism, and
accepting its adoption cost as a precondition for F-1 — the work in Landings
C–E does not change shape, only what it may claim.

The author should ratify or overrule. Until then, work proceeds under this
ruling with the profile qualification attached to every claim it produces.

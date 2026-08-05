# LLP 0172: Explicit function authorization requirements

**Type:** RFC
**Status:** Review
**Systems:** Authorization, Auth, Code generation, Diagnostics, Packaging, Testing
**Author:** Codex (gpt-5.6-sol) / Charlie Cheever
**Date:** 2026-08-04
**Related:** LLP 0010, LLP 0058, LLP 0061, LLP 0108, LLP 0134, LLP 0170, LLP 0173

## Summary

In a sessions-mode app, every user-authored function should explicitly choose
one existing authorization requirement: `public`, `optional-user`, or
`authenticated`. Today, omission becomes `optional-user` in codegen and
manifest loading. That compatibility default is difficult to distinguish from
an intentional anonymous-capable operation and is not surfaced during
generation.

This RFC proposes explicitness, not a new default. During one published
compatibility phase, each omission produces a stable per-function warning with
the exact edit. In the next phase, omission fails generation. Explicit
`optional-user` remains valid. The meanings and runtime enforcement of all
three values remain LLP 0058's; this RFC does not claim that
`authenticated` scopes returned rows or makes an operation safe.

## Verified current behavior

`packages/snapback-codegen/index.mjs` and `define.mjs` admit exactly the three
requirements. Generated identities, public function entries, and validation
diagnostics use `def.auth ?? 'optional-user'`. LLP 0058 specifies the same
legacy rule: absence means `optional-user`.

The requirements answer only whether resolved user authority is required:

| Requirement | Runtime admission |
|---|---|
| `public` | Anonymous or user-bearing authority after validating any presented credential. |
| `optional-user` | Anonymous or user-bearing authority after validating any presented credential. The handler may branch on whether a user exists. |
| `authenticated` | Refuse before handler execution unless authority contains a resolved user. |

`public` and `optional-user` are not interchangeable declarations even where
their admission sets overlap: `optional-user` declares that behavior may vary
with caller authority; `public` can participate in authority-independent
profiles only when their additional rules hold. A cron target cannot require
`authenticated`, because scheduled `system` authority has no user. None of
these facts changes here.

## Proposal

### 1. Scope

The rule applies when the schema's auth mode is `sessions` and codegen emits a
user-authored function into the application function manifest: Query,
LiveQuery, Mutation, or Action, including functions targeted by cron or jobs.
Each definition must carry `auth` or obtain an explicit derived requirement
from a higher-level generator whose own closed contract fixes that value.

Framework-owned host operations that are not application function definitions
are outside this rule. A standard-pattern generator may emit
`origin: "derived"` only when its versioned constructor fixes the requirement;
silently inheriting the legacy default does not count as derivation.

Dev-mode applications retain the compatibility default. Dev mode is a trusted-
local authoring profile, and changing it provides little security value while
doubling migration noise. An author may still spell `auth` there.

### 2. Closed requirement provenance

Codegen carries one provenance fact beside the effective requirement:

```text
explicit | derived | legacy-default
```

- `explicit`: the author supplied `auth` on the function definition;
- `derived`: a versioned generator contract fixed the value; and
- `legacy-default`: no declaration or closed derivation supplied it.

This provenance is generation/review evidence. It does not alter runtime
admission and does not enter handler-visible context. The function's
implementation identity continues to include the effective authorization
requirement; changing only the provenance without changing effective authority
must still change the review projection so migration is visible.

LLP 0173 consumes this fact. The public runtime inspection surface may expose
the effective requirement as it does today; it need not expose migration
provenance to ordinary clients.

### 3. Compatibility phases

The migration is closure-based rather than date-based.

**Phase W — warning closure.** A sessions-mode function with
`legacy-default` generates, but codegen emits one stable warning:

```text
SNAPBACK_AUTH_REQUIREMENT_IMPLICIT
```

The diagnostic names the function, source span, effective legacy value
(`optional-user`), and all three valid edits. The ordinary generation summary
lists every affected function; zero omissions produce no warning. The warning
must survive packaged codegen, `snapback dev`, and CI generation so a consumer
cannot miss it by choosing a different entry point.

**Phase E — enforcing closure.** The same condition is a generation error with
the same code and repair. Codegen writes no outputs, following its existing
fail-closed contract.

The release/promotion owner records the first W closure and first E closure in
the publication ledger. E may not become `latest` until the repository's
required demos and package consumer fixtures contain no `legacy-default`
sessions functions. There is no simultaneous ownership-declaration migration;
LLP 0170 rejected that mechanism.

### 4. Explicit `optional-user` remains valid

The author may deliberately choose anonymous-or-authenticated behavior:

```js
auth: 'optional-user'
```

That edit resolves the diagnostic. This RFC makes omission reviewable; it does
not prohibit the operation class or silently strengthen it to
`authenticated`. Reviewers can then distinguish intentional optional
authority from legacy drift through LLP 0173.

System-triggered actions still need a value compatible with system authority.
Choosing `public` or `optional-user` does not make such an action internal-only
or prevent client invocation. A true internal-only application operation is a
separate authority design and is deliberately not approximated here.

## Diagnostics

`SNAPBACK_AUTH_REQUIREMENT_IMPLICIT` has:

| Field | Value |
|---|---|
| subsystem | `auth` |
| severity | `warning` in Phase W; `error` in Phase E |
| details.function | exact generated function name |
| details.authMode | `sessions` |
| details.effectiveLegacyRequirement | `optional-user` |
| details.allowed | `['public', 'optional-user', 'authenticated']` |
| sourceSpan | the function definition when codegen can identify it |

Unknown explicit values continue to fail with the existing invalid-requirement
diagnostic. An explicitly `authenticated` cron target continues to fail under
LLP 0058's system-authority rule; explicitness never overrides compatibility
or runtime authority.

## Non-goals

- No ownership or membership inference. `authenticated` without a row filter
  can still return every row.
- No change to request-body identity closure, session resolution, live-query
  invalidation, or membership enforcement.
- No internal-only function class.
- No table or column write policy.
- No claim that `public` or `optional-user` is unsafe in itself. The defect is
  indistinguishable omission.
- No generic “default-deny” label; the final API has no default in sessions
  mode.

## Acceptance

1. In Phase W, a sessions-mode function omitting `auth` generates with exactly
   one `SNAPBACK_AUTH_REQUIREMENT_IMPLICIT` warning naming the function, source
   span, effective legacy value, and three valid repairs.
2. In Phase E, the identical fixture fails generation with that code and writes
   no generated output.
3. Explicit `public`, `optional-user`, and `authenticated` fixtures generate in
   both phases and preserve their current runtime admission behavior.
4. An anonymous caller reaches the explicit `optional-user` fixture; a missing
   user is still refused before an explicit `authenticated` handler runs.
5. An explicit `authenticated` cron target remains invalid; choosing an
   explicit compatible requirement does not create an internal-only claim.
6. A versioned standard-pattern fixture proves `origin: "derived"` from its
   constructor; mutating the emitted object to erase the owning derivation
   cannot fall back silently.
7. A dev-mode omission retains current behavior and is reported as
   `legacy-default` in the review projection without warning or error.
8. `snapback generate`, `snapback dev`, source-checkout codegen, and the packed
   consumer fixture produce the same diagnostic code and effective result.
9. The promotion gate refuses Phase E while any required sessions-mode demo or
   package fixture still emits `legacy-default`.

## Open questions

1. Which published closure is Phase W? The RFC fixes ordering and evidence, not
   a version number before implementation and package qualification exist.
2. Should runtime operator inspection expose requirement provenance, or is the
   committed review projection sufficient? This does not block the migration;
   effective runtime authority remains visible either way.

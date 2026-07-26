# Codegen attributes the runtime-clock dependency per bundle, and handler modules cannot share code

**Filed:** 2026-07-26 · **Source:** building `demos/partitime/backends/snapback`
**Status:** open

## What happened

A `handlers.mjs` containing both queries and mutations, where only the
*mutations* call `ctx.runtime.now()`, fails codegen on the *queries*:

```
[error] SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY (auth) guestList:
        protected result depends on denied mutable input RuntimeNow
[error] SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY (auth) eventWall: …
[error] SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY (auth) myRsvp: …
```

Confirmed by substitution: replacing `ctx.runtime.now()` with a literal makes
all three errors disappear. The dependency is attributed at source-module
granularity, so one clock call poisons every `auth: 'authenticated'` query
declared from that file.

## Why the workaround is bad

The fix is to split into a clock-free read module and a write module. But
bundled handler modules **cannot import anything**, not even a sibling file in
the same app directory. The split therefore forces verbatim duplication of the
shared helper block (~80 lines of validation plus the
`ctx.auth.userId -> profile` lookup) across the two files. That duplication is
the ugliest thing in an otherwise clean backend and exists only because of the
analysis granularity.

## Fix candidates

1. Attribute the diagnostic to the *symbol* that introduced the dependency
   (naming the mutation, not the query that merely shares its file), so the
   repair is obvious.
2. Narrow the analysis to the reachable call graph of each declared export.
3. Allow handler modules to import from a declared in-app `shared/` directory —
   the bundler already inlines the module, so this is a resolver policy, not a
   new capability.

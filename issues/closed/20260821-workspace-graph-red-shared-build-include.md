# `workspace-graph` is red on main: a shared build-script include has no source home

**Status:** Resolved
**Filed:** 2026-08-21
**Introduced by:** `7c8e43657` ("fix: harden sealed runtime assembly")
**Resolved:** 2026-08-21
**Landing SHA:** 05e6efd70

## The red

```
SNAPBACK_WORKSPACE_GRAPH_VIOLATION: unmatched Rust file outside a member
source home: crates/snapback-types/build_identity.rs
```

Bisected: `check-workspace-graph.mjs` PASSES at `7c8e43657^` and fails at
`7c8e43657`. Surfaced by the complete battery, which reaches this gate now that
it can run past its earlier stopping points.

## Why it is not a simple revert

`7c8e43657` factored 219 lines of build-identity emission out of three build
scripts into one file. All three include it:

- `crates/snapback-types/build.rs` — `include!("build_identity.rs")`
- `crates/snapback-tools/build.rs` — `include!("../snapback-types/build_identity.rs")`
- `crates/snapback/build.rs`

So the split is real deduplication, not churn. Inlining it back would triple
the duplication and reintroduce the drift risk it removed.

## Why the existing escape hatches do not apply

`scripts/check-workspace-graph.mjs` accepts exactly three shapes:

- `crates/<member>/(src|tests|examples|benches)/**.rs`
- `crates/<member>/build.rs` — the literal build script only
- a declared generated source home

A shared build-script include matches none. The membership-exception mechanism
with burn-down tickets does not help either: the unmatched-file assert fires
before ownership assignment, so an exception is never consulted.

## Options, none of which should be chosen casually

1. Move it under a path the gate already accepts, e.g.
   `crates/snapback-types/src/build_identity.rs`. Cheapest. Slightly dishonest:
   it lives in `src/` while not being part of the compiled lib, and the other
   two crates still reach across a crate boundary to `include!` it.
2. Teach the gate about build-script includes. Must be a DECLARED set, not a
   blanket `build_*.rs` allowance — the gate exists precisely to stop files
   escaping ownership, and a wildcard would reopen that.
3. Promote it to a real shared build-dependency crate. Architecturally
   cleanest, removes the `../snapback-types/` cross-crate reach, heaviest.

Option 3 is probably right long-term; option 2 is the smallest change that
keeps the gate's meaning intact. Option 1 trades a real red for a misleading
file location.

## Note

This is another session's regression, recorded rather than silently patched so
the ownership decision is made deliberately by whoever owns LLP 0276's
projection, not improvised to turn a gate green.

## Resolution

The workspace-graph check now derives shared build-script source homes from
literal `include!` calls in workspace-member `build.rs` files. A referenced
file is accepted only when its resolved path is a `.rs` file directly under a
member root. No filename allowlist or wildcard was added: an unreferenced
member-root `.rs` file still fails, and an include cannot grant the shape to a
nested non-source path.

Coverage includes the real three-build-script positive, a synthetic literal
and raw-literal positive that rejects comment/string examples, an unreferenced
member-root negative, and a referenced nested-path negative.

**Review notes (dual review, 2026-08-21):** grok: clean. codex raised one
medium and two lows, disposed as follows rather than fixed: (1) an
`include!` token inside another macro's unexpanded input (`stringify!`,
unused `macro_rules!` bodies) would be counted as a real include — refuted
as out of this check's threat model, which guards against *accidental*
stray files; deliberately obfuscated blessing inside a reviewed build.rs is
covered by code review and the other gates, and full token-tree parsing is
disproportionate for this guard. (2) `include! { }` / `include! [ ]`
delimiters and (3) cooked-string escapes are not recognized — both fail
CLOSED (a legitimate unusual spelling re-reds loudly and lands here as an
ordinary papercut), accepted by design.

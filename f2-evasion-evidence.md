# Orchestrator-verified evasion evidence (baseline commit ede899a20)

All probes were applied to a clean tree, run, and reverted; `git status` confirmed
0 modified files after each. These are OBSERVED results, not assertions.

## Baseline: both text-scan gates PASS on clean main while all three F-1 escalations are live
    node scripts/check-kernel-raw-sql-api.mjs        -> rc=0 "ok (4 audited non-commit seams)"
    node scripts/check-cross-crate-path-includes.mjs -> rc=0 "cross-crate #[path] gate: ok"

## EVASION 1 (CONFIRMED) — by-value Connection return evades check-kernel-raw-sql-api
Planted at the end of `crates/snapback-kernel/src/push.rs`:

    pub fn leak_connection_probe() -> rusqlite::Connection {
        rusqlite::Connection::open_in_memory().unwrap()
    }

Result: `rc=0`, gate reports ok. A public kernel function handing out an owned writable
SQLite connection is invisible to the gate. Cause: the signature regex requires
`&Connection` / `&mut Connection` / `Connection` followed by `>`, `,` or `)`; a bare
by-value return type `-> rusqlite::Connection {` matches none of those.

## EVASION 2 (CONFIRMED, with control) — raw-string #[path] evades check-cross-crate-path-includes
Planted `crates/snapback-services/src/evasion_probe.rs`:

    CONTROL  #[path = "../../snapback-kernel/src/push.rs"]   -> rc=1  CAUGHT
    ATTACK   #[path = r"../../snapback-kernel/src/push.rs"]  -> rc=0  EVADED

Both spellings are valid Rust that compile the kernel's source into another crate with
different features and statics. Cause: the pattern
`/#\s*\[\s*path\s*=\s*"([^"]+)"\s*\]/g` has no raw-string (`r"..."`, `r#"..."#`) alternative.

## EVASION 3 (confirmed by reading, not yet executed) — symlink resolved lexically
`auditCrossCratePathIncludes` realpaths the CRATE ROOTS (`crateRoots` -> `realpathSync`)
but resolves the #[path] TARGET with plain `resolve(dirname(source), match[1])` and never
realpaths it. A symlink inside the crate pointing at another crate's source therefore tests
as `inside()` and passes. The rewritten gate must realpath the resolved target too.

## Additional finding not in LLP 0283 — a false claim in a load-bearing comment
`crates/snapback-engine/src/push.rs:27` states: "The kernel fact is intentionally not
re-exported through the public façade, so callers cannot assert `System` themselves."
Both halves of that are false today:
  1. `KernelCommitAuthority::admit_system_push()` is `pub` (`crates/snapback-kernel/src/push.rs:43`),
     so any crate holding the claimable root calls it directly, façade or no façade.
  2. `ResolvedAppAuthority` is a PUBLIC enum with PUBLIC variants
     (`crates/snapback-sync/src/auth/invocation.rs:297`), so `ResolvedAppAuthority::System`
     is freely constructible by any crate — the exact "public enum" anti-pattern named in
     LLP 0283's Method lesson 1.
This comment is the failed reasoning of Corollary A written down as if it were an invariant.
The gate suite must be able to falsify claims like it.

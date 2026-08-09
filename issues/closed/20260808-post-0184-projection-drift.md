# Post-0184 projection drift: host.restart refusal and auth.mintSession catalog row lie about shipped CLI verbs

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P1 · **Area:** host_ops / control-catalog generator / CLI

From the 2026-08-08 agentic surface audit (LLP 0202 theme 2); each half found
independently by two auditors. Both are projections that actively misdirect
an agent to a worse path, and both postdate LLP 0184's completion — the drift
class its rules were written against.

1. **`host.restart` HTTP refusal denies a shipped CLI verb.**
   `src/host_ops.rs:1968` returns `SNAPBACK_HOST_OP_CLI_ONLY` with "There is
   no `snapback restart` CLI command yet — use the composed
   `snapback_restart` MCP tool." The verb exists (`src/cli.rs:755-761`,
   dispatch `:2203`), is documented (`guide/operating/host-ops.md:122-140`),
   and the catalog row records `cli: "snapback restart"`,
   `surfaceAccess: native`. The stale doc comment at `src/host_ops.rs:88-100`
   ("does not exist yet — do not describe one as shipped") is the same drift
   and contradicts LLP 0184's own 2026-08-06 Phase 2 delivery record.

2. **The catalog hides `snapback session mint`.**
   `control-catalog/generated/control-catalog.v1.json` records
   `auth.mintSession` as `surfaceAccess: "apiOnly"`, `projections.cli: null`,
   `intents: []`, `guide: null` — but the CLI verb shipped 2026-08-05
   (`1b12f939c`; `src/cli.rs:1955-1963`, `:2395-2399`) and is documented at
   `guide/operating/host-ops.md:100-102`. Root cause: the generator's
   `CLI_PROJECTIONS` map (`scripts/generate-control-catalog.mjs:98-153`) was
   never updated, and the gap its own comment promises to "call out" is
   called out nowhere. If instead the row is *meant* to stay `apiOnly`
   because of `responseSensitivity: CredentialSecret` (the way
   `auth.mailbox.read` is pinned with a `pinReason`), then the CLI verb is
   the thing out of policy — either way the current state, where both exist
   and disagree, is wrong.

## Fix

- Rewrite the `host.restart` refusal to name
  `snapback restart --ready-file <path>` (better: derive the CLI spelling
  from the embedded catalog row rather than hardcoding prose); delete the
  stale comment block.
- Add `auth.mintSession` to `CLI_PROJECTIONS`
  (`'snapback session mint --email <address>'`) with intents and the
  host-ops guide anchor — or author the `apiOnly` pin and remove/gate the
  CLI verb; pick one.
- **Prevent the class:** add a test asserting every `CLI_ONLY_HOST_OPS`
  refusal string names a CLI command that resolves in the catalog's
  `projections.cli`, and that every shipped CLI verb reachable from a host
  operation has a matching non-null catalog projection.
- Record as a dated amendment to LLP 0184 / LLP 0024 when landing.

## Resolution (2026-08-08)

Resolved by binding CLI-only host-operation refusals to the embedded control
catalog, adding the exact `host.restart` and `auth.mintSession` CLI
projections, and adding class-preventing coverage in `src/host_ops.rs` and
`tests/host_ops_v0.rs`. Dated amendments in LLP 0184 and LLP 0024 record both
projection repairs.

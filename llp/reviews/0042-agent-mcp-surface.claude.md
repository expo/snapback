# Review: LLP 0042 — Agent MCP surface

**Reviewed:** `llp/0042-agent-mcp-surface.rfc.md` (working-tree revision, 2026-07-07 draft)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Fable 5
**Date:** 2026-07-07
**Redacted:** No — reviewed locally; nothing sent beyond the model serving this
session.
**Method:** Single-session independent read, verified against LLP 0024 (parent
spec) and the code (`src/host_ops.rs` operation ids, envelope kind, authority
modes; `src/server.rs`). Same-family sub-agent passes assisted verification;
this artifact is **one** family's review.

> **Independence (LLP 0005).** Draft authored by Charlie Cheever / Codex
> (GPT-family); genuine cross-family review.

## Overall assessment

The principles are all correct — same envelopes, no second API dialect, no
hidden authority, catalog from the manifest not filenames, MCP tool failures
reserved for transport. The execution has one disqualifying-if-unfixed defect:
the draft claims to "select the first built subset" of LLP 0024 and then
silently renames **every tool** in a table 0024 explicitly *pins*
(`snapback_start` → `snapback_host_start`, `snapback_load_schema` →
`snapback_schema_load`, …), drops the pinned `snapback_restart`, and reduces
0024's five authority modes to four informal names — while the code implements
0024's strings literally (`"none"`, `"devUser"`, `"devAdminBypass"`). A slice
RFC does not get to quietly amend its parent's pinned vocabulary; it adopts it
or amends it explicitly.

## Strengths

- "The MCP surface should expose the same truth Snapback already has, not
  create a second API dialect" is the exact right thesis, and matches 0024's
  one-envelope architecture as built.
- The unimplemented-op rule (exposable only if returning the same structured
  unimplemented diagnostic) matches runtime behavior
  (`SNAPBACK_HOST_OP_UNIMPLEMENTED`).
- Hosted mutation gating on service principals, rejected honestly until
  LLP 0011 pins scoped tokens, matches 0024 verbatim.

## Concerns

1. **[HIGH] Pinned-vocabulary drift** (see above). *Resolves with:* adopt
   0024's seven pinned tool names plus `snapback_restart`, and 0024's five
   authority mode ids (including `none`, and `devAdminBypass` requiring a
   recorded `reason`).
2. **[HIGH] "Map 1:1 to host-ops operations" is false for lifecycle tools.**
   `host.start`/`host.stop`/`host.restart` are CLI-only by design ("a running
   server cannot start itself over its own HTTP surface"); the MCP server must
   embed the CLI-side process-lifecycle logic (spawn, `--ready-file`
   descriptor, `startupNonce`-verified stop), not proxy HTTP. The draft never
   mentions the asymmetry.
3. **[MEDIUM] Catalog under-specifies against 0024's pinned entry shape:**
   deterministic `snapback_fn_<functionId>` naming with sanitization/collision
   hash, `outputSchema`, `dryRunSupported`, `authorityRequired`,
   `catalogKind: "appDataMcpCatalog"` — the draft's looser metadata list reads
   as a lossy restatement.
4. **[MEDIUM] Security posture unstated for standing authority and
   destructive tools:** the MCP server holding the auto-minted local admin
   token is standing admin authority; `snapback_reset` is destructive and
   callable by any wired-in agent (0024 already requires recording the
   authority tuple for resets); `snapback_stop` in a multi-root workspace can
   kill another project's server. MCP tool annotations
   (read-only/destructive) should be declared.
5. **[LOW] Acceptance gaps vs 0024's own bar:** 0024 requires the catalog to
   contain one query *and one mutation* tool with schemas derived from args
   validators, and a denied mutation to carry a machine-readable `next` hint.
6. **[LOW] The static-vs-served catalog open question duplicates an existing
   0024 open question** — cite it, or claim the decision explicitly.
7. **[LOW] Dependency-status honesty:** 0024 is itself `Draft`; a sentence
   acknowledging the slice builds on a Draft spec (and that landing it
   effectively ratifies the pinned tables) would match corpus practice.

## Recommended next step

Revise and stay `Draft`. All fixes are vocabulary/spec alignment; the design
itself is sound.

## Revisions applied (2026-07-07, at the author's request)

Applied to the draft: 0024's pinned tool names + `snapback_restart` adopted
(concern 1); lifecycle asymmetry stated (concern 2); catalog bound to 0024's
pinned entry shape (concern 3); authority modes restated as 0024's five ids,
admin-token custody, destructive-tool annotations, multi-root stop-safety
(concern 4); mutation-tool + `next`-hint acceptance criteria (concern 5); OQ
deduplicated to cite 0024 (concern 6); Draft-parent sentence (concern 7);
LLP 0039 added to Related. Status left untouched.

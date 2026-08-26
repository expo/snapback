# Tooling robustness papercuts (P3 batch) from the full-repo review

**Opened:** 2026-08-08 · **Severity:** P3 · **Area:** snapback-cli / snapback-codegen / snapback-vite / scripts

A batch of low-severity, individually-verified robustness papercuts surfaced by
the full-repo review. Grouped to keep the tracker manageable; each is
independently fixable.


## Triage (2026-08-26 leftover sweep)

Still open. One original item looks fixed (audit `roots()`-in-loop). Remaining from this sweep: MCP mutation gate dropped on catalog miss; corrupt manifest is raw `JSON.parse`; `generatedAtMillis` still `Number(...)`; Vite buffers whole body; verify scratch `.snapback-verify-`; drift-runner hardcoded source; `bash -lc` in `scripts/verify-local-proof`; maturity fallback silent `HEAD^..HEAD`; Fly `Number(timestamp) || 0`; Windows `SNAPBACK_CONTROL_STORE_UNSAFE`.

## snapback-cli / control
- Inconsistent exit-code propagation across `deploy status`/`apply`/`rollback`/
  `target add` (index.mjs:4031-4058, 3731) — scripts may read failed results as
  success.
- First-start/restart teardown sends SIGTERM/SIGKILL without awaiting exit before
  respawning → DB-lock races (index.mjs:2276-2287, 2643-2658). (See also the
  process-teardown cluster ticket.)
- Audit-chain append is O(n²): `roots()`'s 10-dir security sweep runs inside the
  per-event loop (deployment-control.mjs:1066-1090).
- `existsSync`-then-`linkSync` yields raw `EEXIST` instead of idempotent reuse
  for content-addressed plans/receipts at 5 sites (deployment-control.mjs);
  `addTarget` (1238) already handles it right.
- POSIX mode-bit gates throw `SNAPBACK_CONTROL_STORE_UNSAFE` on Windows with no
  explicit unsupported-platform code (deployment-control.mjs:505-517).
- TOCTOU between adapter-driver digest verification and `spawnSync`
  (deployment-control.mjs:611-680 vs 1310/1510/2289) — re-hash via an open fd and
  exec via that fd.
- Fly driver coerces unparseable event timestamps to epoch 0, passing the
  `sinceMs:0` filter → misdated audit logs (adapters/fly-machines-vm-driver.mjs:272).

## MCP
- `snapback_run_function` drops the mutation authority gate when the catalog is
  missing/stale (mcp-control.mjs:2067).
- Corrupt `functions.manifest.json` crashes MCP server construction with a raw
  exception, no `SNAPBACK_MCP_*` diagnostic (mcp-control.mjs:216).

## codegen
- Case-insensitive filename collision check covers contract modules but not
  operation-schema files → macOS overwrite for `doThing` vs `dothing`
  (index.mjs:6042, 4541).
- `generatedAtMillis` propagates `NaN`→`null` from a malformed
  `SNAPBACK_GENERATED_AT_MS`/`SOURCE_DATE_EPOCH` (index.mjs:11371).

## vite / agent-setup / verify
- Vite relay buffers the entire request body in memory (allowlisted
  `/assets/tus/{id}` PATCH included) with no size cap, twice on retry
  (proxy.mjs:176-178) — dev-scale acknowledged in-comment.
- `agent-setup` writes user-owned `.mcp.json`/`.cursor/mcp.json`/
  `.codex/config.toml` non-atomically (agent-setup.mjs:342/352/435/456); sibling
  modules use tmp+rename.
- `verify` freshness scratch dir (`.snapback-verify-*`, a full backend copy) is
  created in the project tree and leaks on hard kill with no sweep
  (verify.mjs:259).

## scripts (non-fail-open portability/hygiene)
- `drift-backstop-runner` has no lock on its shared dedicated clone (races a
  manual run) and hardcodes `default_source=/Users/ccheever/projects/snapback`
  (:8) — fall back to `git rev-parse --show-toplevel`.
- `admin-acceptance` gate runs under `bash -lc` (login shell), sourcing the
  user's dotfiles into an otherwise-hermetic gate (verify-local-proof:578) — drop
  `-l`, pass explicit PATH.
- `check-capability-maturity.mjs:28-40` silently narrows to `HEAD^..HEAD` when
  `origin/main` is unresolvable — print a one-line degraded-range warning.
- `ref-check` silently skips >2MB or non-UTF-8 files and mishandles `~~~` fences
  — count skipped files in the summary line so exclusions are visible.

## Confidence

Each verified by the reviewers with file:line evidence; all P3. Close
opportunistically or as a dedicated hygiene sweep.

## Progress (2026-08-08)
Lane F landed the mechanical subset: exit-code propagation, atomic agent-config writes, idempotent EEXIST for content-addressed writes, and the teardown/URL-encoding overlap. Deferred (need product judgment): audit O(n^2), Windows mode policy, adapter TOCTOU, Fly timestamp, MCP mutation-catalog gate, corrupt-manifest diagnostics, case-insensitive op filenames, malformed generated timestamp, Vite body limits, verify scratch sweep, drift-runner lock/root, login-shell hermeticity, maturity-range warning, ref-check exclusions.

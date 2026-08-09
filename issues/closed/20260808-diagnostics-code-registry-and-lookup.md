# No code→doc lookup path for SNAPBACK_* diagnostics; LLP 0193's sizing is off 5–10×

**Status:** Resolved
**Opened:** 2026-08-08 · **Severity:** P1 · **Area:** guide reference / CLI guide lookup / LLP 0193

From the 2026-08-08 agentic surface audit (LLP 0202 theme 4).

Measured population: **~2,418 distinct `SNAPBACK_*` literals** in production
sources (1,248 in `src/**/*.rs`, 1,316 in `packages/**/*.mjs` excluding
tests/fixtures/templates, overlapping) — of which **296 (~12%) appear
anywhere in `guide/`**. The documented lookup verb dead-ends: on a miss,
`snapback guide <CODE>` prints "No embedded Guide sections matched … Start
with the capability index" (`src/cli.rs:2155`), and the capability index is
not a code registry. `guide/operating/diagnostics.md` has no code-index
section; the only machine-checked registry is the Rust-test status table
(`src/server.rs:42505`, 27 codes, unreachable from any doc surface).

Consequences documented elsewhere in the audit: agents hit codes like
`SNAPBACK_AUTH_SESSION_EXPIRED` (undocumented, along with 137 more
core-client codes) with no lookup path, exactly the routing failure class
LLP 0187 diagnosed.

Also: **LLP 0193's Phase 1 header estimates "200–500 codes"**
(`llp/0193-errors-as-docs-completeness.plan.md:49-51`). The measured
population is 5–10× that, which materially changes that plan's grading
fan-out and should be corrected in the plan (as a dated amendment, landed
with the first 0193 execution slice — note the working-tree 0193 is
currently in a deliberate author-input restore state; amend the committed
text when that settles).

## Fix

1. Generate `guide/reference/diagnostics.md` (or a
   `diagnostics-registry.json` + per-family pages) from source, reusing the
   `scripts/generate-symbol-registry.mjs` machinery that already produces the
   847-symbol API reference — keyed by code, carrying subsystem, emitting
   site(s), HTTP status class where the server table knows it, and a guide
   anchor where one exists. Serve it under `/_snapback/guide/reference/`.
2. Make `snapback guide SNAPBACK_*` hit the registry exactly *before* the
   markdown search — the exact-lookup-precedes-search hook already exists at
   `src/cli.rs:2143`.
3. Correct LLP 0193's population estimate before its lanes are sized; the
   graded-ledger design in 0193 remains the right owner for message-quality
   grading — this ticket is the lookup substrate it needs anyway.

## Resolution (2026-08-08)

Added `scripts/generate-diagnostics-registry.mjs`, which deterministically
inventories production Rust, package JavaScript, and Swift source into
`guide/reference/diagnostics-registry.json`, the human
`guide/reference/diagnostics.md`, and the generated client diagnostic-code
union. Records are code-keyed and carry subsystem, all emitting sites, known
HTTP status/class, and authored Guide anchors. Guide generation, checking,
embedding, HTTP/MCP/docs-site projection, and the frozen-record drift policy
now bind those bytes.

Both native and package CLI exact-reference lookup load and identity-check the
diagnostics registry before symbol lookup and Markdown search, with bounded
JSON/text results and acceptance coverage for
`SNAPBACK_AUTH_SESSION_EXPIRED`. LLP 0193 has the requested dated amendment:
the 200–500 estimate is superseded by the measured ~2,418-code intake, with
the audit's scan/exclusion/deduplication method recorded without restructuring
the plan.

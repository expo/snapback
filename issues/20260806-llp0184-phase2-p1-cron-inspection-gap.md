# LLP 0184 Phase 2 P1: no read-only cron inspection route exists to project

**Status:** Open

LLP 0184's "### P1: read and diagnose" (`llp/0184-agent-accessible-control-plane.rfc.md`)
lists as item 4: "**Cron/job inspection:** list/show plus dry/status
projections (CLI + MCP) before any mutating controls exist (mutations are a
different agent's Phase 2b scope — don't build cron tick/run-one or job drain
here, just inspection)."

**What landed:** `jobs.list`/`jobs.show` (`GET /_snapback/api/jobs`,
`GET /_snapback/api/jobs/{id}`) already existed as read-only routes and now
have direct CLI (`snapback jobs list|show`) and control-MCP
(`snapback_jobs_list`, `snapback_jobs_show`) projections — both are
`(native, direct)` in the catalog.

**What's missing:** there is no read-only cron *inspection* route at all.
`src/admin.rs` registers only two cron routes, both mutating:
`POST /_snapback/api/cron/tick` (force every due job) and
`POST /_snapback/api/cron/{name}/run` (force one job) — see
`admin_cron_tick`/`admin_run_cron_job`. Both are explicitly out of this
slice's scope (Phase 2b territory per the parent task). There is no
`GET /_snapback/api/cron` or equivalent that lists declared cron job
definitions, last-run status, or next-due time; `cron.tick`'s catalog row
records only "shipped but lacks a direct control CLI/MCP projection" for the
*mutating* operation, and neither `functions.load` nor any other read
projects the cron-definition list back out today (cron job identities are
loaded from the generated functions manifest and are not separately
queryable at runtime).

**Why this wasn't built here:** the RFC's Phase 1 P1 slice is explicitly
"pure-projection" — it wraps existing routes, and does not add new storage or
server semantics (see the parallel constraint on `data.scan`'s cursor: "a
stable/snapshot-bound cursor is a new storage semantic ... stays out of this
pure-projection phase"). A cron-listing endpoint does not exist to project,
so building one is a new server-side capability, not a CLI/MCP wrapper, and
is out of this pure-projection pass by the same reasoning.

**How to apply:** either (a) LLP 0028 (cron)/LLP 0024 (host-ops) gain a
read-only `cron.list`/`cron.status` operation exposing declared job
identities plus last-run/next-due facts, which this program's CLI/MCP
pattern (already proven for `data.scan`/`config.*`/`jobs.*`) can then wrap
in a follow-up slice; or (b) the RFC's Phase 2 P1 cron-inspection item is
narrowed to "jobs only" and the RFC text amended to reflect that cron has no
inspection surface yet. Whoever picks this up should also check whether
LLP 0028 already covers this gap in its own backlog before adding new
semantics here.

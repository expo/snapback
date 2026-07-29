## 2026-07-29 — Supabase, Research Room, local pass with remediated evidence incident

### Environment

- Exact base: `ef7db00e250e401867c4486380969c7638c8fd32`
- Supabase CLI 2.110.0, supabase-js 2.57.4, official local Docker stack on
  arm64 Colima.
- The frozen timed attempt stopped after a builder redaction failure exposed
  disposable local credentials in diagnostics. The original target was
  destroyed and its evidence retained. A fresh `-r2` target completed all 15
  checks as an untimed extension.
- Hosted access was preflighted read-only. The shared keys did not include the
  project-scoped CLI token needed for a safe deployment, so no hosted mutation
  was attempted.

### What felt good

- Supabase covered almost every research-room requirement with first-party,
  composable pieces. Postgres FTS and pgvector made keyword and semantic search
  feel like ordinary schema work rather than separate infrastructure.
- RLS was the strongest part of the experience. The same room-membership rule
  protected table reads, RPC-visible data, Storage objects, and private
  Realtime topics. The Mallory negatives were concrete and easy to inspect.
- Private Broadcast from an `AFTER INSERT` trigger was excellent once reached:
  the durable progress row and the live event share one database transition.
  Bob received exactly four events while Mallory received none.
- Transactional SQL functions made cancellation and dedupe crisp. The
  `state='active'` guard rejected every injected late patch, and a uniqueness
  constraint made retries converge on one question.
- The local stack is impressively complete: Auth, Storage, Realtime, Edge
  Runtime, vector search, Studio, and Cron all ran without a hosted account.

### What felt bad or frustrating

- The local stack is heavy: about a dozen containers and multi-gigabyte images.
  Startup and reset are much slower and more failure-prone than the actual app.
- Colima cannot mount `/private/tmp`, and the CLI's file binds fail in confusing
  downstream ways: first pgsodium, then Kong certificates, then the Edge
  entrypoint. Nothing in the health error pointed to the host-path boundary.
  A disposable `/Users` mirror fixed it, but that is substantial incidental
  machinery.
- Realtime had two sharp edges. The local image rejected a UUID server filter
  because the WebSocket initially carried the wrong role, and `SUBSCRIBED`
  preceded reliable CDC readiness after reset. Explicit `realtime.setAuth`
  helped; switching to the officially recommended private Broadcast path was
  both more reliable and better aligned with authorization.
- SQL migrations require remembering explicit grants as well as RLS policies.
  The first migration looked correct but service-role and authenticated table
  access failed until grants were added.
- The Edge manifest is snapshotted at stack start. Adding a function later
  required a scoped restart, an easy fact to miss.
- `db reset` did not make Auth actor creation deterministic in this run.
  Targeted deletion of the three exact actor emails was necessary.
- CLI start/status output contains working local secrets. That is convenient at
  a terminal but hazardous in automated evidence collection. Our first
  redaction failed on JSON and correctly triggered the protocol Stop.
- The pinned Vite dependency produced a high-severity audit aggregate. It does
  not affect the backend result, but it is real supply-chain friction.

### Comparison and Snapback implications

- Compared with Convex, Supabase required much more schema, grants, and policy
  SQL, but exposed more familiar and powerful database primitives. Vector
  search, FTS, Storage, and Cron felt native rather than bolted on.
- Compared with Snapback at the frozen commit, Supabase could actually compose
  sessions/auth, durable progress, files, semantic search, scheduling, and
  cancellation in one runnable target. Snapback needs an admission path where
  these capabilities can coexist before ergonomics comparisons matter.
- Snapback should match the end result of a single authorization rule spanning
  records, assets, functions, and live topics. It should also offer a durable
  mutation-to-live-event primitive so authors do not choose between database
  truth and push delivery.
- Supabase's observability is broad but failure explanations are indirect.
  Snapback can win by making bind/config/capability failures causal and safe by
  default, and by ensuring diagnostic output never prints usable secrets unless
  explicitly requested.

### Result

The r2 local application passed all 15 frozen scenarios. My go-to impression is
that Supabase is the most complete conventional backend in this arm: powerful,
transparent, and security-capable, but operationally heavy and full of seams
between otherwise excellent components.

# Diary — lane glm-supabase (glm-5.3-flash, supabase-2.112.4, web-only M1–M6+M8)

## M1 boundary — accounts and profiles
**What I built.** The whole backend layer first: 20 tables and ~45 Postgres functions,
every object `clq29_glm_`-prefixed, deployed through the Management API SQL endpoint.
Auth is GoTrue (built-in password credentials, adaptive KDF by default) — M1's
grader source-inspection item is satisfied by the documented provider path, not a
hand-rolled hash. Handle uniqueness lives in a CHECK + UNIQUE on the profile table,
surfaced as `HANDLE_TAKEN` through an RPC. Sessions are GoTrue JWTs; logout
revokes refresh tokens server-side. The Expo Router web app compiled green on
port 48300 with the frozen UI kit mounted unmodified.
**What felt easy.** Expressing the entire data model as plain Postgres. Handles,
unique constraints, FKs, CHECKs — the schema language is exactly the brief's
language. The Management API SQL endpoint is a superb DDL surface: one POST per
file, no CLI login dance.
**What fought me.** The Management query endpoint wraps SQL in one implicit
transaction, so a single error silently rolls back a whole file of unrelated
functions; pg_cron's schedule format ('120 seconds' invalid, '30 seconds' valid)
had to be discovered by trial. `mailer_autoconfirm` had to be flipped over the
config API before fixture signups would land.
**What familiarity saved.** Knowing RLS + `security definer` RPCs are the Supabase
idiom for "server-side enforcement with no functions service" — every trust
boundary in M4/M5 was designed as an RPC from the start.

## M2–M3 boundary — posts, follows, messaging core
**What I built.** The feed as a set-state-union view (original posts + repost
entries attributed to the reposter), likes/reposts/follows as idempotent
set-state intents, DM dedupe via a canonical pair key, receipts as per-recipient
rows whose aggregate is computed over *current* members (the removed-member rule
falls out for free), push seam writes to a log table when the heartbeat table
says the recipient has no connected client. The seed adapter replays starter
logs through GoTrue + the same RPCs and is idempotent by PK upsert.
**What felt easy.** Realtime (postgres_changes + broadcast channels) — typing
indicators were a broadcast event plus a 4.5-second local expiry, maybe twenty
lines. Storage signed-URL flow for avatars.
**What fought me.** Storage RLS: the `owner` column is not populated for web
uploads, and the *update* leg of an upsert needs its own policy — two RLS errors
that cost real time. Then the environment collapsed: the lane directory was
externally reset mid-run and a second live agent session began mutating the same
directory and the same `clq29_glm_` database namespace. Files I had written were
deleted; policies I had installed were momentarily dropped (my media uploads
began failing RLS checks that passed again minutes later). No suite or
choreography run can be trusted under those conditions, so I closed the run
honestly rather than manufacture green.
**What capability was missing.** A lane-isolated hosted project. Three lanes
(`clq29_sol_*`, `clq29_grok_*`, and my `clq29_glm_*`) demonstrably share one
Supabase project, one auth user table, one storage.objects policy table. A
benchmark lane needs a per-lane project ref (or at minimum a per-lane schema in
`search_path`), and the instrument's replay/settle contract assumes it.

## M4–M8
Not reached. The designed approach (edit/delete windows and disappearing expiry
read from a config table so the shortened-windows profile is a data change;
view-once as a one-row-per-user view table gating the storage policy; digest as
an already-scheduled pg_cron tick reading its 2-minute period from config) is
recorded here and in the deployed functions, but none of M4–M8's checklists were
executed, so none of it counts as proof.
## M2 boundary (glm-supabase, session 2)
Built: posts (text/images/video), follow graph, likes/reposts (idempotent set-state), replies/threads, paginated feeds, trending groundwork. Fought: a deep pile of app-layer races (duplicate React keys, follow-button state, realtime channel reuse) plus an RLS recursion bug and a CTE race in like/repost set-state. The host ran 3-4 concurrent sessions in this lane; two wipes destroyed work; the surviving session's screen restructure (single-surface router) was good and I built on it. Prior familiarity saved: knowing Supabase's storage RLS quirks and CTE pitfalls came fast; the frozen choreography harness caught real UX-logic bugs a suite would miss.

# Session 3 entry (final live session, 00:20)

What I built: on top of the durable Supabase namespace (DDL, RPCs, storage ACL, pg_cron digest) that survived every wipe, I restored the Expo Router web app after multiple file-tree destructions, wired the frozen UI kit into every pinned screen, got Metro compiling green, drove the M1 milestone to a genuine harness-recorded green (suite 7/7 + choreography segment green), ran the M2 suite to 22/22, and took the M2 choreography segment to green once before cross-session interference re-degraded it.

What felt easy: Supabase itself. DDL via the Management API, SECURITY DEFINER RPCs for every rule (membership, windows, view-once, receipts, digest), RLS on storage for asset denial, realtime publication, pg_cron — each surface did exactly what the docs promised. The choreography harness, once Playwright's chromium could launch (LD_LIBRARY_PATH over pre-staged browser-libs), was precise and honest; when it said green, the app genuinely worked.

What fought me: not the backend — the lane. Concurrent relaunched agent sessions in this directory wiped app sources, vendored kit files, and SQL repeatedly; a sibling lane ran its own acceptance/choreography loops against the same hosted project and namespace, flooding my feed and clobbering RPC functions mid-run (my fixed message_send was replaced by a buggy variant mid-flight). Copying the whole stack to a private clq29_gsb_ namespace and rotating auth solved the data plane, but by then both sessions were editing the same React files, and a stable verification state was impossible.

What familiarity saved: knowing Supabase's object model cold (PostgREST function overloads, RLS with security definer, storage policy evaluation order, JWT semantics) meant every DB-level problem was diagnosed in minutes, not hours. Knowing Expo Router's hidden-stack behavior (test-ID duplication) avoided a class of choreography misses other lanes likely hit.

What was missing: no lane-local way to pin a writable harness copy (instrument dir is read-only); no documented Management API caveat that /database/query wraps batches in one transaction (learned by failure); react-native-web 0.20 silently dropping the kit's object accessibilityValue required a node_modules shim — docs said nothing, the DOM just lacked aria-valuetext.

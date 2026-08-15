# Diary 0080: Clique 0.1.21 Supabase exploratory lane

**Date:** 2026-08-14

**Run:** Clique 0.1.21 exploratory sweep on the Durand M4 Pro Mac mini

**Raw lane artifacts:** `/Users/ccheever/clique-0121-20260814/lanes/sol-supabase/`

**Lane:** `sol-supabase`

**Model:** GPT-5.6 Sol, high effort

**Backend:** Supabase 2.112.3

## 1786749964 — M1 boundary (`aborted`)

What was built: I authored the Expo Router shell, persistent Supabase Auth session provider, sign-up/sign-in/logout flows, exact profile fields, profile edit/view routes, avatar upload to a private bucket, signed media reads, and cross-client profile subscriptions. The same foundation includes the normalized M2/M3 schema because the RLS relationships and foreign keys had to be designed together: profiles, posts, follows, likes, reposts, conversations, membership, messages, receipt snapshots, and typing expiry. The app typechecks and produces an iOS Hermes bundle.

What felt easy: Supabase's client API made the client-facing Auth calls, PostgREST mutations, signed Storage URLs, and Postgres Changes subscriptions compact. PostgreSQL constraints were a natural fit for handle uniqueness and the rest of Clique's set-state identities. The frozen UI kit removed most visual ambiguity and gave the route shells reliable automation hooks.

What fought me: the provider packet's first Supabase block is placeholders, including the only database URL. The active block has a hosted project URL and modern publishable/secret keys, enough for Auth/Data/Storage calls but not DDL. The Data API's OpenAPI description confirmed there was no pre-installed generic SQL or migration RPC and no `solsb_` object. I tried the signed-in SQL editor route, but this run had no connected browser session. Official Management API documentation confirmed that its query endpoint needs a PAT or scoped OAuth token, neither present. This is backend ownership/authority friction rather than an application-schema defect: a project secret bypasses data RLS but intentionally does not confer project administration.

Documentation that saved time: the official password Auth page clarified hosted confirmation defaults; the RLS guide pinned `auth.uid()` as the policy primitive; Realtime docs gave the publication DDL and Postgres Changes subscription shape; Storage docs clarified object ownership and that service keys must never reach clients. Published package metadata corrected my initial mismatch between registry-latest React Native and Expo 57's React Native generation.

Workarounds and corrections: I made secret parsing reject placeholder values; kept secrets Node-only; tried browser-based SQL installation; probed the project OpenAPI read-only; and authored a fail-closed setup command with a precise authority error. Separately, the frozen UI kit's local package is symlinked, so TypeScript and Metro needed explicit symlink/peer resolution. The first iOS export failed on that package boundary; the Metro watch-folder correction produced a Hermes bytecode bundle on retry. The acceptance run and choreography were preserved as failures, not promoted to green.

## 1786749964 — M2 boundary (`blocked-by-M1`)

M2 was not started as an executable milestone because M1 did not establish its required deployed backend. During the shared M1 foundation work I did author the M2 client and schema surfaces: text/image/video post writes, Storage uploads, Following and Global projections, follow/unfollow, live likes and reply counts, repost attribution, thread-only replies, link-only rendering, and paging-oriented indexes. I also authored all M2 suite mappings. None were executed against a deployed `solsb_` schema, so there is no M2 acceptance or choreography claim and no M2 platform-proof artifact.

The main design tradeoff is that the reduced starter feed is projected in the client from normalized rows. It keeps the model legible and the assertions testable, but it is not the query plan I would carry to the full scale envelope; that would need server-side paged feed RPCs. Supabase makes the underlying relational model straightforward, while PostgREST's compositional limits make richer feed unions more comfortable in a SQL function than in a chain of client queries.

## 1786749964 — M3 boundary (`blocked-by-M1`)

M3 was also not started as an executable milestone. The source already contains server-authoritative DM dedupe, group creation with duplicate-membership groups, admin-only member removal, prior-history semantics for removed members, quoted-message validation, send-time recipient snapshots, receipt promotion, a Realtime-driven conversation UI, quoted-excerpt jump behavior, and typing rows that expire client-visible state before the five-second ceiling. The seed replayer covers the frozen M3 segment through normal scoped RPCs. These surfaces remain unverified because no database objects could be installed.

Realtime was pleasant for durable row changes but less direct for ephemeral typing. I chose short-lived, member-scoped Postgres rows rather than a public Broadcast channel or a second private-channel authorization system. That is a candid backend-specific workaround: it adds write amplification and cleanup debt, but keeps authorization inspectable in one RLS model. No M3 acceptance, choreography, or iOS artifact was produced after the prerequisite block.

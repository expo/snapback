# Diary 0079: Clique 0.1.21 Snapback Familiar exploratory lane

**Date:** 2026-08-14

**Run:** Clique 0.1.21 exploratory sweep on the Durand M4 Pro Mac mini

**Raw lane artifacts:** `/Users/ccheever/clique-0121-20260814/lanes/sol-snapback-familiar/`

**Lane:** `sol-snapback-familiar`

**Model:** GPT-5.6 Sol, high effort

**Backend:** Snapback Familiar 0.1.21

This is N=1 exploratory evidence only. It is not scored, claim-eligible, or a promotion/default decision.

## 1786744488 — M1 start

The run packet fixed the account/profile shape, test IDs, suite-versus-choreography split, and the requirement to use Snapback's password sessions rather than invent identity. The frozen authoring packet made the critical profile choice explicit: Familiar TypeScript modules only, generated server/API values, and no explicit `.mjs` entrypoints. No workaround is in use at this boundary.

## 1786745872 — M1 green

Built password signup/sign-in, durable web session custody, eight idempotently seeded personas, public profiles, unique handles, editable profile fields, avatar selection/storage, logout, and live cross-client profile reads. The complete M1 acceptance suite passed 7/7 required assertions and the frozen choreography passed all 3 implemented checks; this remains N=1 exploratory evidence, not a score or promotion/default decision.

The Familiar table/query/mutation authoring itself felt compact, and the served auth and generated-artifact guides saved time by specifying the exact password program and client custody split. The friction was in boundaries between generated artifacts and adjacent tooling: Familiar emitted `_generated` while `dev` opened `generated`; a compatibility symlink triggered a watcher loop; dotted Familiar operation exports were accepted by codegen but rejected by the canonical client unless they used CRUD leaf names; generated `app.mjs` used quoted exports that Metro could not transform; and headless `closeAuth` retained a realtime lease. Workarounds were a post-codegen mechanical generated-directory copy followed by server restart, CRUD operation names, importing the manifest through generated `api.mjs`, and process-owned in-memory custody for one-shot scripts. Avatars are persisted as bounded data URLs because the reduced Familiar surface has no generated asset mutation; that is a backend-specific media ownership compromise, though its server validation and profile authority remain backend-owned. Native custody is currently in-memory while web uses IndexedDB, so native process-restart persistence remains a known product gap outside the browser choreography proof.

## 1786745872 — M2 start

M2 extends the same generated Familiar surface with backend-owned posts, follow edges, likes, reposts, replies, counters, and cursor-shaped paging. The frozen action log and assertion registry remain authoritative for initial data and acceptance coverage.

## 1786747586 — M2 green

Built text/image/video posts, Global and Following projections, explicit follow edges with implicit self-feed membership, live follower counts, idempotent likes and reposts, attributed repost projections, direct-reply threads, linkified URLs without unfurls, and 20-row feed pages. Acceptance passed all 22 suite-required assertions. The frozen browser harness passed all 7 checks it implements; its two media-compose checks remain structurally unimplemented and non-required because the frozen contract exposes no media-picker test ID. This is N=1 exploratory evidence only, not scored or claim-eligible.

Familiar made indexed set-state mutations and live read models straightforward, and the M2-specific guidance correctly called out implicit self-feed logic as application-owned. What fought the build was lifecycle/tool coupling: scalar object query results could not lower and had to become one-row arrays, generated closed inventories required clean copies rather than overlays, and repeated short-lived authenticated clients could stall the fixture runner until replay was grouped by persona and process phase. The official asset guide documented the canonical asset pipeline, but Familiar’s derived same-profile intent is image-only and a top-level explicit video intent cannot be named through the two-segment Familiar export namespace. The workaround stores the exact small fixture video as three independently bounded backend fields and reconstructs it in the live projection; this preserves bytes but is a clear backend-specific media capability compromise. Another self-owned correction was adding feed navigation on profile surfaces and ensuring Stack routes do not retain a second contracted composer in the web DOM.

## 1786747586 — M3 start

M3 adds deduplicated DMs, distinct groups, server-authoritative membership, quoted text messages, receipt records, and ephemeral typing. The frozen M3 log seeds one Alice/Bob DM and one four-member group.

## 1786748472 — M3 green

Built one-per-pair direct messages, distinct group conversations, server-owned memberships and admin mutation checks, member-only message writes, quoted replies with excerpt and jump behavior, monotonic sent/delivered/read receipt records, retained history for removed members, and canonical ephemeral typing presence. The M3 acceptance suite passed all 7 required assertions. The frozen browser harness passed all 3 checks it implements. Four non-required checks remain structurally unimplemented: semantic sender-avatar inspection, semantic receipt transitions, group aggregate receipts, and removed-member lifecycle. Their exact contract limitations are recorded in the raw receipts. This is N=1 exploratory evidence only; it is not scored, claim-eligible, or a promotion/default decision.

The Familiar query/mutation model again made the durable data plane compact, particularly unique DM keys, membership indexes, and live message projections. Canonical ephemeral presence was available within the same profile, so typing required no backend escape. The most useful documentation was the complete Familiar authoring packet: it established the generated server/API values, closed export inventory, and the supported ephemeral extension before implementation began.

The difficult part was authority representation and lifecycle semantics. Familiar schema validation rejected principal values nested inside structured arrays, so recipient snapshots are server-authored string IDs rather than client-supplied principal objects. Computed member access was also not available as a declarative rule, so every conversation, membership, message, and receipt handler performs its own active-member or admin check. The first typing implementation kept renewing while the draft remained nonempty; memoization alone did not express user inactivity. The final product-owned workaround records last-keystroke activity and stops publication after 3.5 seconds while retaining the draft. Repeated headless authentication churn also stalled a few acceptance/choreography retries, requiring exact-PID backend restarts. No explicit-profile module or alternate backend was introduced.

Across the reduced run, the persistent known gaps remain native process-restart session custody and canonical video asset intent. Web custody is durable in IndexedDB; native custody is in memory. The exact small video fixture is reconstructed from three bounded backend fields because the Familiar-derived asset intent is image-only and its two-segment namespace cannot name the explicit top-level video intent. These compromises are disclosed rather than treated as invisible success.

# Make admitted query retention the default on qualified JS clients

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 2
**Confidence:** 5
**Systems:** React, Expo, Headless client, Retained query facts,
Authorization, Client storage
**Date:** 2026-08-16
**Governing:** LLP 0190 §3.1 and Stages D3.2–D3.6, LLP 0270
**Related:** LLP 0053, LLP 0090, LLP 0155, LLP 0166, LLP 0209;
`issues/20260815-local-first-defaults-audit.md`

## Problem

Browser React and Node/browser headless clients resolve a persistent store by
default, and live handles default `persistResume` to `true`
(`packages/snapback-client/index.mjs` and
`packages/snapback-client/rqs-store-default.mjs`). That does not retain an
ordinary query. Expo uses the same query-admission contract after its separate
filesystem registration, so carrier qualification alone would not remove this
gap. `guide/sync/offline-and-retention.md` documents the current per-query
opt-ins shared by the JS arms:

- public declarative queries require
  `defineLiveQuery({ auth: 'public', authorityIndependent: true })`;
- protected generated queries require `retainable: true`; and
- unmounted durable demand requires
  `client.registerQuery(ref, { registrationId: '...', retentionRequest: 'durable' })`.

The guide accurately says an application receives zero offline retention
until a query declares eligibility. This makes a shipped persistence carrier
look default while its useful facts remain opt-in.

## What default means

On a qualified durable store, every owner-admitted query should request and
maintain retention without an application selecting a retention option. Expo
inherits this posture only after its first-party carrier qualifies under
`issues/20260816-qualify-expo-local-first-carrier.md`:

1. codegen/host derives public authority independence and closed-inputs
   eligibility where the operation already proves it; app-authored
   `authorityIndependent` must not become authority;
2. generated protected queries request retention when the server has issued
   the exact class, lease, activation, and custody facts required by LLP 0053;
3. a mounted live handle owns active demand automatically, while an explicit
   durable registration remains only for genuinely unmounted/background
   demand; and
4. unadmitted queries continue online with a stable refusal. Stored bytes do
   not create eligibility and memory fallback does not claim restart survival.

The migration must rotate identities where a declaration or owner class
changes. It must not relabel predecessor entries offline.

## Consequence classification

**Semantic consequences — not SAFE as a wiring-only flip.** Default retention
changes device storage, stale/offline rendering, privacy custody, eviction,
logout and principal-switch work, and protected-data lease behavior. It must
follow LLP 0270 and LLP 0190's risk-class receipts. Public exact facts may
graduate before protected facts; absence of a proof stays an honest refusal.

## Acceptance

- A fresh React, Expo, or headless app on a qualified carrier retains every
  owner-admitted mounted query without a retention declaration.
- Public, protected, opaque-handler, memory-carrier, policy-change, logout,
  user-switch, expiry, corrupt-store, and predecessor-identity cases match LLP
  0190's admission/refusal matrix.
- Restart with the server unreachable renders only admitted facts with
  `freshness: 'retained'`; unproved completeness renders `unknown`/nothing.
- Existing explicit options remain compatible during migration and cannot
  widen owner admission.

## Resolution (draft — public-exact slice)

Implemented LLP 0190 D3.2 / LLP 0270 rollout wave 3 only. Codegen and the
local/Ibex server now derive `single_table_v1` / `rqsEligible` from a public,
closed,
ambient-free declarative single-table plan without consulting the app-authored
`authorityIndependent` flag. That flag remains a compatible validated
assertion for its existing uses and does not widen the owner proof. The
owner-derived fact also selects the authority-independent live/bundle
namespace and is carried in persisted React binding receipts.
Cloudflare remains on its validated `authorityIndependent` conjunction; LLP
0092 records that owner-derived port as a pending target row.

On qualified browser IndexedDB and headless Node-file stores, a mounted query
in this public-exact class automatically owns an active durable-retention
request. No `persistResume`, `retainable`, `authorityIndependent`, or
programmatic registration declaration is required. A fresh client can render
the proof-validated result with `freshness: 'retained'` while the server is
unreachable. Explicit durable `registerQuery` remains the API for demand that
must exist with no mounted handle. Owner/class identity changes continue to
rotate the generated composition/plan/QMK identity; predecessor bytes are not
relabelled offline.

Regression coverage pins that protected and opaque-handler declarations do
not derive the public class, memory carriers do not request or claim durable
retention, absent proof remains `unknown`/nothing, policy and authority
barriers delete/refuse before render, expiry/corruption fail closed, and
explicit public assertions reach only the same owner-admitted class.

Status remains Open. LLP 0190 D3.6 / LLP 0270 rollout wave 5 is still required
to make owner-admitted protected retention automatic after D3.3–D3.5. This
slice does not change protected admission, lease custody, logout/user-switch
semantics, Expo carrier qualification, or opaque-handler eligibility. It does
close a pre-existing external-bearer implementation hole by invoking the same
durable predecessor wipe on logout/user-switch even when no AuthCoordinator is
present.

---

**Public-exact slice landed 2026-08-16** (LLP 0270 wave 3; LLP 0190 D3.2):
codegen/host-derived eligibility (no app declaration) with owner-bound
admission (recomputed plan/node hashes; signature-validated owner proof for
no-lease commit AND render), default retention for mounted owner-admitted
public-exact queries on qualified durable carriers (browser React,
headless), external-bearer authority-transition wipe with a predecessor
fence + writer-wake for shared-store followers, identity rotation, honest
refusals. Demo witnesses migrated: metricsFeed/todosFeed are now the
positive no-declaration witnesses; new opaque protected fixtures own the
refusal boundary in both custody phases. Three-round dual-family review
converged (codex r3 with live fence repro, grok r2 with hash-recomputation
repro); an in-loop fence regression on the evaluation floor was caught by
the full-suite rerun and fixed. Cloudflare remains flag-gated (LLP 0092
scoped honestly). **Ticket stays OPEN for the protected slice (D3.6, LLP
0270 wave 5)** — see the rollout order in LLP 0270. Expo remains gated on
its carrier ticket. The Chrome witness was updated by inspection; its
browser receipt re-run rides the next witness execution
(playwright unavailable in this environment).

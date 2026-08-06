# Diary 0065: Rematch bakeoff — published-closure Snapback vs Convex, first token-metered run

**Date:** 2026-08-06
**Demo:** `demos/rematch-bakeoff/` (`snapback/` and `convex/` arms)
**Brief:** identical to Diary 0058 — WhatsApp-shaped messaging app: DMs and
group chats, text and image messages, emoji reactions, reply pointers
without threads, seeded data, typing indicators, offline-readable history,
fast test-persona switcher; Expo client; live backend, iOS Hermes export,
image send end-to-end in-app, offline cold-start proof, scripted acceptance.
**Method:** two cold-context builder agents, run serially on the same
machine (M5 Max), same model (Claude Fable 5), same brief text, no access
to this repository or to each other. Wall-clock from epoch stamps; token
and tool-use counts from the orchestration harness — **the first bakeoff
with real token numbers** (Diary 0058 could not measure them). Scores
below are the orchestrating agent's judgment from the two lane reports,
against Diary 0058's rubric and weights.

**Basis change vs 0058 (read before comparing):** the Snapback arm was
restricted to **published surfaces only** — `@expo/snapback-*@0.1.10` from
the npm registry, the served guide/`llms.txt`, CLI help, and published
package source. No repository checkout, no LLP corpus. 0058's Snapback arm
built from the source checkout with guide/LLP orientation excluded from
its clock. This run is therefore the first honest external-consumer
measurement, and its numbers are not directly comparable to 0058's — the
model also differs (0058 ran on Codex). The within-run Snapback-vs-Convex
ratio is the primary result.

## Measurements

| Metric | Snapback (published) | Convex | Ratio |
|---|---:|---:|---:|
| Wall time | 36m33s (2,193s) | 12m27s (747s) | **2.94x** |
| Tokens (agent, total) | 330,034 | 101,281 | **3.26x** |
| Tool invocations | 174 | 57 | 3.05x |
| Correction loops | 8 (4 framework / 2 self / 2 tooling) | 3 (2 framework / 1 self-caught) | — |
| Proofs | UI 10/10, headless 9/9 (re-passed after backend restart), offline cold start pass | API 16/16 (re-passed after restart), UI 13/13, offline 6/6 | — |
| iOS Hermes export | 3.7 MB `.hbc` (magic verified) | 1.8 MB `.hbc` (magic verified) | 2.1x |

Baseline (Diary 0058, in-checkout, Codex): 26m03s vs 11m15s = 2.32x.

## What the 0.1.9/0.1.10 fixes bought — confirmed working

The entire first-15-minutes plumbing that dominated 0058's loss is
**gone**. From the lane's report, with zero corrections: `npm install` of
the coherent published closure (no `file:`/overrides ceremony), `snapback
new` scaffold whose AGENTS.md points at the served guide, codegen, and
`snapback dev` with ready-file — the managed loop that was 0058's "biggest
Snapback detour" worked first try. Discovery — the class three prior
bakeoffs failed at — **worked**: the served capability index routed the
agent to `useSnapbackPresence`, the relational/queries pages, the exact
ImagePicker → `expo/fetch` → Blob upload recipe, and the session-mint
broker pattern. The lane singled out CLI `--help` quality, codegen
diagnostics, and `session mint`/`data scan`/`assets list` as strengths,
and needed **no web searches**. Image send worked end-to-end in-app —
0058's arm never achieved that.

## Where the remaining 3x lives — new walls only an npm consumer hits

1. **The published closure fences out the offline-retention contract.**
   `authorityIndependent: true` requires `single_table_v1`, which the
   published runtime refuses as an experimental/GAP surface. The guide
   teaches platform-retained offline as the paved path; an npm consumer
   cannot reach it. The lane shipped an app-level history cache instead —
   structurally the same workaround as the Convex arm. **This forfeits
   Snapback's largest scoring advantage** (0058 offline: 94 vs 62).
   Ticket: `issues/20260806-published-closure-gates-offline-retention.md`.
2. **Expo-web asset uploads are unpaved.** Browser TUS `PATCH` is blocked
   by CORS — the server's `access-control-allow-headers` omits
   `upload-offset`/`tus-resumable`; the paved browser answer is the Vite
   relay, which an Expo-web app doesn't have. The lane wrote its own ~80
   line relay. Ticket: `issues/20260806-tus-cors-headers-expo-web.md`.
3. **`useSnapbackAssetImage.src` defaults to the strict-delivery URL**,
   which a plain `<img>` cannot fetch on a sessions server (needs a
   protocol header) — empty image bubbles until the lane switched to the
   public-immutable URL plus a rendition-publication-race retry. Ticket:
   `issues/20260806-asset-image-src-strict-url-sessions.md`.
4. Smaller: manifest-only `prepareReactBinding` refuses generated
   ephemeral references (descriptor needed — cost a loop plus a stale-
   Metro mask); headless `liveQuery` defaults to manual-poll transport
   (documented, but the default surprised); Metro on this machine never
   watched files under `/private/tmp` (environment, not framework).

The token asymmetry mirrors the loop asymmetry: Snapback's 4 framework
loops each cost diagnosis-plus-workaround cycles (the CORS relay and the
offline fallback were real engineering), while Convex's 2 loops were
resolved from its own error messages in minutes. Convex's lane also spent
almost nothing on orientation — prior model familiarity supplied the API
shapes, precisely the training-data advantage LLP 0186 predicts context
injection must offset.

## Convex arm notes

Anonymous local mode remains the standout (zero-auth, self-port-managing,
wrote the client env var). Its frictions: the local backend dies with the
CLI process (undocumented-feeling lifetime); no built-in offline cache
(hand-rolled ~60-line layer — and its offline *image* pixels came from the
browser HTTP cache, not the app layer, which the lane flagged honestly);
emoji-as-field-name refused by the value validator — a real sharp edge for
chat; N+1-ish reads in `listMessages` fine at demo scale.

## Scores (0058 rubric and weights; judged from lane reports)

| Dimension | Weight | Snapback | Convex | Rationale |
|---|---:|---:|---:|---|
| Functional completeness | 20% | 95 | 97 | Both complete; Convex first-run-passed everything. |
| Realtime + typing | 10% | 95 | 80 | Ephemeral typing is still native vs hand-built durable machinery. |
| Offline behavior | 20% | 66 | 62 | **The flipped dimension:** published Snapback = app-owned cache, near-parity with Convex's; the platform contract exists but is unreachable from npm. |
| Images/assets | 10% | 78 | 93 | Snapback's in-app path now works (0058: never did) but needed the CORS relay + URL workaround; Convex worked immediately. |
| Data model + type safety | 10% | 94 | 90 | Generated contracts stricter; Convex's emoji-key refusal dinged. |
| DX, docs, setup | 15% | 72 | 95 | **Biggest Snapback gain (was 55):** install/scaffold/discovery/dev-loop clean; three framework walls keep it from parity. |
| Testability + diagnostics | 5% | 90 | 88 | Operator CLI verification praised; codegen diagnostics precise. |
| Operations + maturity | 10% | 70 | 96 | Real published closure now (was 62); capability gating honesty costs the rest. |
| **Weighted overall** | **100%** | **81** | **86** | Convex still wins the external-consumer build; Snapback's loss is now concentrated in two fixable walls instead of diffuse plumbing. |

## What this means for LLP 0186

- W0 is **validated**: the fixes it targeted are confirmed absent from the
  friction list, and discovery went from three-for-three misses to fully
  working. The remaining gap is *not* the old gap.
- The next two highest-leverage items are now unambiguous: **ship the
  offline-retention capability in the published closure (or honestly
  fence the guide's offline pages for npm consumers — an author call)**,
  and **pave Expo-web assets** (CORS headers or a first-party relay).
  Together they own most of the 4 framework loops and the forfeited
  offline scoring edge.
- Convex's near-zero orientation cost is the training-data advantage in
  its purest measured form (no docs fetched, API shapes from prior
  familiarity). The W2 authoring skill is the counter; this diary is its
  requirements document.
- Token metering worked and should be standing: tokens tracked loops
  almost linearly, making correction-loop count the best cheap proxy when
  metering isn't available.

## Ratchet note

First calibrated W1 data point with tokens: **2.94x wall / 3.26x tokens**
(published-consumer basis). The W1 ratchet should target this basis going
forward; the 0058 in-checkout number stays as historical context only.

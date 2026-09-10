# Clique score — grok wave (grok-4.6 xhigh scorer) — snapback2@0.0.21

```json
{
  "scorer": {
    "family": "grok",
    "model": "grok-4.6",
    "basis": "own lane's narrative files (Snapback 2 only)"
  },
  "backends": {
    "snapback2": {
      "overall": {
        "score": 72,
        "note": "Quarry expressed Clique's model, auth, media, jobs, and M7 backfill directly; the published Expo-web live/offline surface made M5\u2013M8 prove reads and writes twice (essay)."
      },
      "setup_and_docs": {
        "score": 71,
        "note": "Guide covered identity, merge, once, schedule, and successor; the packaged Expo template is a single App.tsx, with no recipe for Expo Router fetch-bind, a second owner, or live:false (M1/M6 diaries)."
      },
      "data_modeling": {
        "score": 88,
        "note": "Unique handles, follow caps, merge feeds, maintain counts, and mutation intents are schema lines; reserved `read`, indexes ending in `id`, E_BOUND, and maintain-cannot-where were new compiler classes (essay, M3/M7)."
      },
      "authorization": {
        "score": 73,
        "note": "`use identity` and membership `read <-` mapped chats; Bob's `bumpUnread` lookup of Alice's `inboxState` saw null and `insert if absent` no-op'd with no proc diagnostic (M8 diary, final-report)."
      },
      "queries_and_live": {
        "score": 62,
        "note": "Live queries are the default, but `oncePhoto` vanished from `useQuery` while `createClient().query` still returned it; insights were 0 vs 3; M7 poll tallies used a 400ms poll (essay, M5/M8)."
      },
      "writes_and_transactions": {
        "score": 84,
        "note": "`insert if absent` plus `intents { mutationId }` made seed, scale replay, likes, reactions, and poll votes idempotent; edit/delete windows are schema `require` on server `now` (essay, M6, M7)."
      },
      "offline_sync": {
        "score": 53,
        "note": "Web `indexedDbRangeStore` hung `client.mutation` past 15s versus 54ms on a token-only client; M6/M8 dual-offline and M7 m7-a05 flushed the outbox through an aux client (essay, diaries)."
      },
      "media_assets": {
        "score": 80,
        "note": "Passing a File into `sendOncePhoto` returned `{ id, width, height }` with 410 `E_ASSET_VIEWED` on the second fetch; `once` is image-only and live joins go null (essay, M4/M5)."
      },
      "background_work": {
        "score": 90,
        "note": "`schedule expireMessage on messages at .expiresAt`, `schedule cliqueDigest every 2m`, `connected[]` push gating, and `emit notify` were first-class; `job setReplayMode` disabled the seam for scale (M6/M8, digest.q)."
      },
      "client_integration": {
        "score": 50,
        "note": "Certified hooks exist, but Expo web required binding `globalThis.fetch`, a second `createClient` without IndexedDB, and DOM file inputs the App.tsx template does not document (essay, M1/M6, `_layout.tsx`)."
      },
      "diagnostics_dev_loop": {
        "score": 66,
        "note": "`snapback2 check` and `E_BOUND`/`E_STRUCTURAL_FANOUT`/`CONFIG` fail loudly; auth-filtered proc lookups and hung IndexedDB mutations fail silently (M8 unread, M6 hang, M7 successor report)."
      },
      "scale_and_limits": {
        "score": 78,
        "note": "167157 actions in 1497s matched posts/messages/follows exactly; `E_BOUND` forbade nested members, `E_STRUCTURAL_FANOUT` forbade history backfill, and scale needed a copied directory owner (final-report)."
      },
      "operations": {
        "score": 74,
        "note": "M7 successor installed generation 366192ba with `backfilledMaintains: 2` and intact sm0001\u2013sm0015; `reset --empty` drops `appConfig`; isolation is a directory, not a URL (M7 diary, M6)."
      },
      "verdict": "Snapback 2 made Clique's server program a Quarry file, then spent the saved time making subscribed snapshots and the web offline store agree with one-shot queries.",
      "would_use_again_for": "A native-first product that wants Convex-like live queries with column-level once/caps/uniqueness and in-language jobs, not an Expo-web dual-tab messenger that must be boring on day one."
    }
  },
  "notes": [
    "What helped most was Quarry as product vocabulary: unique handles, follow caps, merge feeds, maintain counts, once columns, insert-if-absent intents, and schedule-on-column expiry compiled instead of being four drifted artifacts.",
    "M7's additive successor (generation 366192ba, backfilledMaintains: 2, intact sm0001\u2013sm0015) is the brochure experience the rest of the stack did not match.",
    "What hurt most was treating live useQuery and one-shot createClient().query as two backends for once photos, insights totals, groups.get, and poll tallies (M5, M8, M7).",
    "The web indexedDbRangeStore stalling mutations past 15s forced a token-only aux client for online writes and offline flush, including dual-Alice and m7-a05.",
    "Expo Router was off the paved App.tsx path, and one-owner-per-directory plus no live:false recipe added operational ceremony the compiler never charged for."
  ]
}
```

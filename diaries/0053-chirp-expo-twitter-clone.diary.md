# Diary 0053: Chirp — Expo Twitter clone

**Date:** 2026-08-03
**App:** `demos/chirp`
**Stack:** Expo SDK 57, Expo Router, React Native, Snapback

## Build log

Built a universal Twitter-style app with a live home timeline, profiles,
people search, composing, replies, likes, connection-state disclosure, and
seeded social data. The same route tree exports for web and runs on iOS and
Android. The app imports `@expo/snapback-client`, codegen, and React bindings
directly from this checkout so it exercises the repository's latest code.

Snapback felt especially good at the typed seam. Generated references gave the
Expo hooks exact argument and result types, including branded post ids. The
server-side profile join also kept the UI simple, and a single live query is a
pleasant model for a social feed.

The generator immediately refused ambient `Date.now()` with
`BUNDLE_UNSUPPORTED_TIME`. `guide/backend/trusted-runtime-values.md` gave the
exact repair (`ctx.runtime.now()`), so this was productive friction rather
than a guide gap. The 280-character invariant lives in the mutation, and the
headless suite proves refusals do not write.

The rough edge is deployment. The React/Expo client is shipped, but the guide
still classifies the hosted Snapback target as partial. EAS Hosting can serve
the universal Expo client but cannot host this checkout's local Rust/Ibex
backend. Consequently a public static deployment cannot be represented as a
working hosted Snapback product; native and local-web verification use the
local target.

Compared with React plus Convex or Supabase, the local generated contract and
headless proof are unusually strong, but obtaining a public end-to-end preview
is materially harder until Snapback has a supported hosted target. Expo Router
made the three-platform UI straightforward, while native semantic colors
needed a small web fallback and typed color casts at tab-icon boundaries.
The first iOS render also exposed duplicate React resolution across the
monorepo watch folder (`useMemo` read from a null dispatcher). Pinning Metro's
`react`, `react/jsx-runtime`, and the Snapback React source alias to the
app-local SDK 57 install fixed the carrier boundary; this is a familiar
monorepo sharp edge rather than a Snapback API problem.

Browser verification caught another useful strictness boundary: the first
compose implementation passed `replyToId: undefined` for a top-level post.
Snapback correctly rejected that as a non-canonical client value. Omitting the
optional key entirely fixed composition while preserving the generated exact
argument type.

The first like interaction exposed a UI-authority mistake: the card added a
local `+1` while the live query independently delivered the authoritative
increment, briefly rendering a two-count jump. An intermediate repair made
the count server-only but left the heart in component state; that avoided the
symptom without using Snapback's reconciliation model. The final version makes
`liked` a viewer-aware query result and uses `useSnapbackMutation`'s built-in
optimistic projection to toggle `liked` and `likeCount` together. Its
`isAuthoritative` matcher recognizes the mutation result in later query data,
so response/query reordering cannot apply the increment twice and rejection
automatically rolls the projection back.

The React guide does document optimistic projections, so the initial miss was
primarily an implementation-judgment failure: I reached for familiar local
React state before modeling the viewer-specific fact in the live query. The
guide could steer harder with a canonical favorite/like recipe and an explicit
warning against combining a local counter delta with a live authoritative
counter. This demo also revealed a less-covered design point: the same entity
appears in timeline and profile query stores, while one optimistic mutation
targets one exact canonical store. Chirp uses a small wrapper per query surface;
the guide should show that pattern and its tradeoffs.

The packaged `snapback dev` path failed after schema load because its host-ops
consumer saw a non-JSON response, so native verification used the documented
headless app harness to provision and hold an isolated server. That workaround
was reliable but is more ceremony than the intended one-command loop.

Device testing exposed two local-development details. A profile pushed from a
tab had no visible exit affordance on web, so the shared root stack now gives
profile routes an explicit Home link; unlike history-only back, it also works
when a profile URL is opened directly. The backend harness intentionally binds
to loopback, which an iPhone cannot reach. For this session a narrow TCP proxy
publishes only that backend port on the Mac's Tailscale address, and Metro
inlines the Tailscale origin through `EXPO_PUBLIC_SNAPBACK_ORIGIN`. This is a
development workaround, not a hosted deployment contract.

Physical-device testing then caught a subtler optimistic flicker. `toggleLike`
writes the viewer's like row and the denormalized post count separately, so a
live query can deliver `liked: true` with the old count before delivering both
new facts. The first matcher checked only `liked` and retired the optimistic
layer on that partial delivery. Returning `{ liked, likeCount }` from the
mutation and matching both fields keeps the layer installed across partial
deliveries and retires it only when the complete mutation receipt appears in
authoritative query data.

Regenerating that mutation contract while Metro and the phone were live also
surfaced the raw `SNAPBACK_REACT_BINDING_MISMATCH` diagnostic between backend
generations. Refusing a mismatched contract is correct, but presenting the
internal code as application UI during an ordinary local restart is poor dev
loop ergonomics. Issue
`issues/20260803-react-dev-binding-mismatch-user-facing.md` proposes a bounded,
retrying “Updating local backend…” state without weakening admission.

The same live editing session exposed a second generation handoff: Metro HMR
replaced the generated `api` module while retaining the mounted provider's old
prepared binding. Hooks then failed with uncaught
`SNAPBACK_REACT_REFERENCE_INVALID`. Issue
`issues/20260803-react-hmr-reference-invalid.md` tracks an atomic provider
reprepare/handoff (or controlled dev reload) so strict reference admission
does not become an application crash during normal HMR.

The stricter receipt matcher made the flicker faster but did not eliminate it.
The remaining bug was in the optimistic reducer itself: it toggled whatever
authoritative row it received. Optimistic reducers are replayed during rebase,
so an intermediate row that already contained `liked: true` caused the reducer
to toggle back to false. The corrected reducer captures the intended heart and
count at admission and projects that fixed outcome over every base until the
complete receipt is authoritative. This replayability requirement deserves
emphasis in the optimistic-toggle guide recipe.

## Verification

- Snapback codegen, no warnings
- TypeScript strict check
- Expo web production export
- Headless backend acceptance suite
- iOS carrier launch: passed on the local iOS 26.4 simulator; the rendered
  timeline reported `live` and showed all three seeded posts.
- Android carrier launch: blocked before app launch because the existing
  emulator had only 581 MiB free and rejected Expo Go with
  `INSTALL_FAILED_INSUFFICIENT_STORAGE`; cache trimming did not recover enough
  room, and the emulator was not destructively wiped.
- EAS Hosting client deployment:
  https://snapback-chirp--afemip3879.expo.app (static universal client; no
  hosted Snapback backend claim).

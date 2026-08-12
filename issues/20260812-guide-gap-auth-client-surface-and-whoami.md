# guide-gap: client auth methods missing from typed surface; no documented "who am I" projection

- **Status:** Open
- **Date:** 2026-08-12
- **Systems:** client, guide
- **Found by:** three independent sweep lanes (fable5 ×2 runs, sol) —
  `benchmarks/records/2026-08-12-social-messenger-model-sweep.md` §4

Two halves, same surface:

1. **Typed surface:** `@expo/snapback-client`'s `index.d.mts` omits the
   auth methods that exist at runtime (`authExchange`,
   `authRequestCode`, `authLogout`, coordinator accessors). TypeScript
   consumers must cast; one lane called this "the difference between a
   9/10 and a 6/10 auth-DX afternoon." (The root `createAssetClient`
   export had the same declared-before-runtime skew in reverse at
   0.1.15 — this is the mirror case.)
2. **Docs:** no guide page states how a booted client asks "am I signed
   in, and as whom." `authSession()` is an auth-mode projection, not an
   identity read; lanes discovered `session.authority.userId` /
   `coordinator.settledView()` by printing objects and enumerating
   prototypes. The auth guide should name the blessed signed-in
   projection and its settled/restored semantics next to the
   sessions-and-principals page.

Acceptance: `tsc` against a scaffolded app can call the documented auth
surface without casts, and the guide's auth section answers the
"who am I" question with a CI-verified snippet.

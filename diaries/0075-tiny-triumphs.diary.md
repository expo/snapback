# Diary 0075: Tiny Triumphs

**Date:** 2026-08-11
**App:** `demos/tiny-triumphs`
**Stack:** Expo SDK 57, Expo Router, React Native, Snapback 0.1.20 from npm

## Build log

Tiny Triumphs is a shared victory jar: a person records one small win, chooses
one of three vibes, and sees the newest celebrations update live. The backend
is intentionally small—one indexed table, one JS mutation, one JS live query,
and three seeded rows—so the demo tests Snapback's everyday path rather than a
large feature matrix.

The npm-first experience was strong. All five Snapback packages used by the
app resolved at the current registry version, 0.1.20. `snapback doctor --json`
used the packaged darwin-arm64 runtime and passed its complete disposable
query/mutation/live vertical slice. Codegen produced exact React references,
and the first headless suite could reuse the repository harness to provision a
fresh database without bespoke server orchestration.

The generator's explicit table-visibility warning was excellent productive
friction. A shared jar is genuinely public-read, and adding
`.visibility({ kind: 'public-read' })` made that choice visible in review. The
mutation also owns whitespace trimming, length checks, vibe validation, and
`ctx.runtime.now()`, leaving the Expo screen mostly concerned with interaction
and presentation.

The live-query API was slightly less obvious in the first acceptance draft. I
initially treated the returned handle as an async iterator. The headless guide
does document the actual handle (`rows`, `poll()`, `dispose()`) and the need for
a `connectionId`, so this was an implementation mistake rather than a guide
gap. The corrected proof opens the managed stream, performs a second mutation,
waits for the handle's rows to advance, and disposes it. All four checks pass.

The main npm-only rough edge was generated Contract metadata. A broad
`tsc --noEmit` includes `snapback/generated/contract/*.contract-meta.ts`, which
imports `@exact/contract/exports`; that package is not installable from the
public npm registry. The app does not consume Contract, so excluding that
optional generated directory restored a clean typecheck. The guide did not
surface this npm-only consequence, so
`issues/20260811-guide-gap-npm-generated-contract-typecheck.md` records it.

Compared with React plus Convex, Snapback required a little more explicit
client preparation, but the generated manifest admission and headless proof
made the client/backend contract unusually reviewable. Compared with Supabase,
there was no dashboard, SQL migration, or separate realtime policy to set up;
schema, visibility, functions, seed data, and live behavior stayed together in
the app directory. The tradeoff is local delivery: the physical phone needs
both Metro and the local Snapback backend exposed from the development
machine. Tuft made that workable with stable HTTPS names, and both processes
run under persistent launch agents. That delivery is an unsupported workaround,
not a Snapback physical-device carrier or a retained live-device receipt.

Expo itself was straightforward. The app stays Expo Go compatible by using
the pure React binding rather than the optional Snapback Expo native carrier.
The UI is one responsive ScrollView with a native large-title stack, haptics on
iOS, accessible controls, and no platform-specific build.

## Verification

- npm registry versions: Snapback CLI/client/codegen/contract/react 0.1.20
- `snapback doctor --json`: passed the packaged-runtime vertical slice
- Snapback codegen: 1 table, 2 operations, 1 live query, zero warnings
- TypeScript strict check: passed
- Expo Doctor: 20/20 checks passed
- Headless acceptance: 4/4 passed, including managed-stream mutation delivery
- `snapback verify`: platform stages passed; the receipt correctly reports
  `passed-without-acceptance` because the separate headless suite is not yet a
  registered verify profile
- Expo web production export: passed
- Public Snapback inspect endpoint: healthy at the Tuft-hosted backend URL
- Public Metro manifest/web response: healthy at the Tuft-hosted app URL
- Physical-device carrier: Expo Go link prepared as an unsupported workaround;
  awaiting user launch; no live-device receipt

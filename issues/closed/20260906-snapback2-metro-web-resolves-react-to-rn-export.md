# snapback2: Metro web resolves `snapback2/react` to the React Native export

**Filed:** 2026-09-06 by Claude Fable 5.1 from the Clique full run (benchmarks/runs/2026-09-05-clique-full-3x3), builder evidence as cited; raw lanes at /Users/ccheever/clique-full-20260905/lanes/.
**Status:** resolved · **Severity:** packaging — Metro web when browser and native conditions are both asserted

## Symptom
In an Expo Router app bundled by Metro for web, importing `snapback2/react` resolves to the React Native entry, which lacks `browserTokenStore`; the builder added a Metro alias to `dist/react.mjs`.

## Evidence
- `/Users/ccheever/clique-full-20260905/lanes/grok-snapback2/run-log.md` epoch 1788646700 (attribution snapback2-defect)
- `/Users/ccheever/clique-full-20260905/lanes/grok-snapback2/metro.config.js` (the alias)

## Fix shape
Check the package's export conditions: Metro web selects the `react-native` condition unless the package orders `browser`/`default` ahead for the web platform, or ships a platform-specific entry Metro's resolver honours. Add a template check that bundles the chat template's Expo app for web without an alias.

## Resolution — 2026-09-07

The package now puts a `browser` branch before `react-native` on `./react`,
with matching `.mjs` and `.d.ts` targets. This matters when Metro asserts both
conditions. Native-only resolution still selects `react-native`; an ordinary
import with neither condition still selects the web entry.

The original scope and missing-export attribution were too broad. Installed
Expo SDK 54's default configuration scopes `browser` to web and `react-native`
to iOS/Android, so default Expo web already selected the web entry. The defect
is reproducible with a global `react-native` condition, as older/custom Metro
configurations can supply. On current source, `browserTokenStore` is exported
by `snapback2/client`, not either React entry. The web-only export used for the
regression is `indexedDbRangeStore`. The historical raw lane paths above were
unavailable on this machine; they remain historical evidence, not this run's
reproduction.

Validation against base `ba63c884e` and the repair:

- The new case in existing `tests/expo.test.ts` failed before the export change:
  `web, global native=true` resolved `dist/react-native.mjs`, expected
  `dist/react.mjs`, using Metro 0.83.3's actual package-exports resolver.
- After the change, all eight combinations of web/iOS/Android/no platform and
  default/global-native conditions resolve to the intended runtime and
  TypeScript declarations. The Expo and typing test files pass **18/18**.
- `node build.mjs` passed. A real `metro.runBuild` with Expo's SDK 54 config,
  platform `web`, and the additional global native condition bundled a minimal
  consumer of the built package copied into ordinary `node_modules/snapback2`.
  No package alias or custom resolver was used. The source map includes
  `react.mjs`, `react-core.mjs`, and `client.mjs`, and excludes `react-native.mjs`.
  Evaluating that bundle with browser globals exposes functional
  `indexedDbRangeStore`, `AssetImage`, `SnapbackProvider`, and `browserTokenStore`.
  The retained local fixture is
  `snapback2/target/metro-web-qualification/` in the named `clique-metro-web` lane.

The Expo chat template uses the explicit native Expo entry and SQLite carrier;
this fix does not qualify that native-only template for web. Publication is a
separate release action.

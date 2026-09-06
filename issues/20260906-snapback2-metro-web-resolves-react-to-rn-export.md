# snapback2: Metro web resolves `snapback2/react` to the React Native export

**Filed:** 2026-09-06 by Claude Fable 5.1 from the Clique full run (benchmarks/runs/2026-09-05-clique-full-3x3), builder evidence as cited; raw lanes at /Users/ccheever/clique-full-20260905/lanes/.
**Status:** open · **Severity:** packaging — every Expo Router web app hits it

## Symptom
In an Expo Router app bundled by Metro for web, importing `snapback2/react` resolves to the React Native entry, which lacks `browserTokenStore`; the builder added a Metro alias to `dist/react.mjs`.

## Evidence
- `/Users/ccheever/clique-full-20260905/lanes/grok-snapback2/run-log.md` epoch 1788646700 (attribution snapback2-defect)
- `/Users/ccheever/clique-full-20260905/lanes/grok-snapback2/metro.config.js` (the alias)

## Fix shape
Check the package's export conditions: Metro web selects the `react-native` condition unless the package orders `browser`/`default` ahead for the web platform, or ships a platform-specific entry Metro's resolver honours. Add a template check that bundles the chat template's Expo app for web without an alias.

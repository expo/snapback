# LLP 0134 cold-install Expo fixture used a stale SDK tuple

**Status:** Closed — fixed forward 2026-08-06
**Opened:** 2026-08-06
**Systems:** Packaging, React Expo, CI
**Related:** LLP 0064, LLP 0134, LLP 0181, GitHub Actions run `31137213449`, PR #18

## Failure

After the external Todo release proof advanced past its Git-status timeout, the
nine-tarball cold install reached the packed Expo export fixture and npm refused
its dependency graph. The fixture requested Expo 56 / React Native 0.85 while
the newly published `@expo/snapback-expo` package correctly declares its
supported Expo 57 / React Native 0.86 peer tuple.

## Attribution

The packed Expo fixture's tuple originated in `6e080ca2fb`. The first Expo
facade and its explicit supported peer range landed later in `2b5da1ff6a`
without reconciling this older publication fixture. Earlier closure runs did
not include the facade, and the Linux run stopped at the preceding source-status
failure, so first production use of the expanded closure exposed the drift.

## Resolution

The packed Expo fixture now uses the repository's proven Expo 57 tuple:
`expo@~57.0.7`, React 19.2.3, and React Native 0.86.2. npm's ordinary strict
peer resolver remains the gate; no `--force`, `--legacy-peer-deps`, peer-range
weakening, or package omission is used.

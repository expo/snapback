# Tiny Triumphs

A cheerful shared victory jar built with Expo SDK 57 and Snapback 0.1.20.
Add a small win, choose its vibe, and see the list update through a Snapback
live query. Snapback owns validation and timestamps on the server.

From the repository root:

```sh
npm install --prefix demos/tiny-triumphs
npm run generate --prefix demos/tiny-triumphs
npm test --prefix demos/tiny-triumphs
npm start --prefix demos/tiny-triumphs
```

The app is designed for the local Snapback target and an Expo client. It does
not claim a hosted Snapback backend or production authentication. See the
[React/Expo guide](../../guide/clients/react-expo.md) for the local carrier
contract.

## Two temporary conditions

`tsconfig.json` excludes `snapback/generated/contract`. That exclusion is a
**workaround, not a pattern to copy.** Codegen currently emits
`*.contract-meta.ts` sidecars that import `@exact/contract/exports`, which is
not installable from the public npm registry, so a broad strict `tsc --noEmit`
fails on them even though this app does not consume the Contract surface. The
root defect is that the Exact-dependent sidecars are emitted unconditionally
rather than as an explicit Contract output;
`issues/20260811-guide-gap-npm-generated-contract-typecheck.md` tracks the fix.
Drop the exclusion once codegen makes the sidecars opt-in.

Delivering this app to a **physical iOS device** is an **unsupported
workaround.** Snapback has no accepted iOS physical-device development carrier:
reaching a phone needs both Metro and the loopback Snapback backend exposed,
and a public front does not by itself establish transport security, route
admission, or an authorized binding. The simulator, Android USB, and hosted
release targets are the supported paths.
`issues/20260811-ios-physical-device-dev-carrier-decision-packet.md` holds the
open go/no-go decision.

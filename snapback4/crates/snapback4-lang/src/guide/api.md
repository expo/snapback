# API: what each package subpath exports

The `snapback4` package has one subpath per job, and the generated `api` object names your operations.
This index lists each subpath's functions, hooks and main types; their editors show the full signatures.

```ts
import { createApp } from "snapback4/app";
import { webDevice } from "snapback4/web";
import { AppProvider, useAuth, usePage, useQuery, useMutation, matchRead, isFailed, type RowOf } from "snapback4/react";
import { api, type Rows } from "../snapback/generated/api.ts";   // written by `snapback4 check` and `dev`
```

## Generated: `snapback/generated/api.ts`

`api.<op>` (module files: `api.<module>.<op>`) is a typed handle for each query, mutation, action and
ephemeral write; pass it to a hook or to `client.query` / `client.mutate`. `Rows` holds each table's row
type and `Ops` the handles' types; `RowOf<typeof api.op>`, `ArgsOf<…>` and `ResultOf<…>` derive the rest.

## Client subpaths

| Subpath | For | Functions and hooks | Main types |
|---|---|---|---|
| `snapback4/app` | the app object: identity, client lifetime, pending writes | `createApp` | `App`, `AppOptions`, `AppAuth`, `AuthState`, `Online` |
| `snapback4/react` | React and React Native hooks | `AppProvider`, `useAuth`, `useAppReady`, `useRelease`, `useClient`, `useViewer`, `useSignedInViewer`, `usePersonaApp`, `useSession`, `useQuery`, `usePage`, `useFollowing`, `useMutation`, `useAction`, `useAsset`, `useSaveAsset`, `useUpload`, `useLink`, `useOnline`, `useNow`, `useAcquired`, `useAcquisition`, `usePendingWrite`, `usePendingWrites`, `usePendingItems`, `usePendingState`, `useSeen`, `useInspection`, `SnapbackProvider`; and the `snapback4/contract` guards | `UseQuery`, `UsePage`, `ReadHookOptions` (`{ keep, skip }`), `UseAction`, `UseMutation`, `WriteHook`, `MutationHook`, `Outcome`, `AssetState`, `PendingItem` |
| `snapback4/contract` | reading answers: the types every tier shares | `matchRead`, `matchReadList`, `otherwiseAll` (one fallback for every state the call does not name; named handlers win in any order), `isReady`, `isPresent`, `isLoading`, `isDenied`, `isFailed` (an outcome, a hook by its latest one, or an unknown value), `sentResult` (a write's fresh result, if any), `existence`, `readPresentation` | `Read`, `Ready`, `SettledRead`, `Refusal`, `Write`, `Outcome`, `PendingWrite`, `Query`, `Mutation`, `Action`, `RowOf`, `ArgsOf`, `ResultOf`, `Cursor`, `Principal`, `Client` |
| `snapback4/client` | the online client without a device (scripts, tests, servers) | `createClient`, `mintId`, `idFrom`, `saveAsset` | `Client`, `ClientOptions`, `Session`, `Saved` |
| `snapback4/web` | the device in the browser (wasm) | `webDevice`, `indexedDbPersistence`, `memoryPersistence` | `WebDeviceOptions`, `Persistence` |
| `snapback4/local` | a local-first client over a device you open | `createLocalClient`, `DeviceVersionError`, `uploadAndPlace`, `hasUploads`, `blobArrayBuffer` | `LocalOptions`, `LocalClient`, `DeviceOpener` |
| `snapback4/native` | the device as a process, from Node | `processDevice` | `ProcessDeviceOptions` |
| `snapback4/auth` | sign-in and session storage | `guest`, `signup`, `login`, `logout`, `logoutAll`, `refreshSession`, `restoreSession`, `keepSession`, `forgetSession`, `narrowSession`, `memorySessionStore`, `localStorageSessionStore`, `defaultSessionStore`, `sessionKey` | `Session`, `SignIn`, `SessionStore` |
| `snapback4/mock` | a labelled in-memory mock for screens without a server | `createMockClient`, `mockId`, `page` | `MockClient`, `MockOptions` |
| `snapback4/inspection` | read-pressure inspection | `inspect` | `ReadInspection`, `PressureCounts` |

Expo: `snapback4-expo` exports `nativeDevice`, `nativeAvailable` and `saveAsset` (pass `device: nativeDevice` to
`createApp`); `snapback4-expo/witness` has `smokeOrigin` for simulator proofs (`guide witness`).

## Server and tooling subpaths

| Subpath | For | Functions | Main types |
|---|---|---|---|
| `snapback4/worker` | a worker performing emitted effects (`guide effects`) | `runWorker`, `runGeneratedEffects`, `listEffects`, `mintSession`, `revokeSessions`, `Retry`, `GiveUp` | `Effect`, `EffectHandler`, `WorkerOptions`, `Worker` |
| `snapback4/server` | `use server` handlers: actions and routes (`guide actions`) | `startServer`, `ServerError`, `ParkStep` | `ServerOptions`, `ServerHandlers`, `RouteHandler`, `ServerContext` |
| `snapback4/identity` | an OIDC sign-in adapter for `use server` | `oidcHandlers` | `OidcConfiguration`, `OidcSession` |
| `snapback4/witness-web` | Exported browser proof registration | `registerWebWitness` | |
| `snapback4/proof` | bounded backend, frontend and browser application proofs | `startDev`, `startServe`, `startStatic`, `startVite`, `loadFixtures`, `cli`, `command`, `deploy`, `rollback`, `testSource`, `bounded`, `cleanup`, `stopChild`, `portRange`, `withBrowser`, `sandboxUnavailable`, `renderedText`, `frontPage`, `logsDir`, `waitForFresh`, `waitForServer`, `fillRN`, `statusText`, `selectByValue` | `ProofHost`, `ProofOptions`, `CliResult`, `FixtureRow`, `LoadFixturesOptions` |
| `snapback4/bin-path` | the platform binary, to spawn `dev` or `serve` without the Node wrapper | `resolveBinary` | |

Each subpath's code and types ship under `node_modules/snapback4/dist/`: `snapback4/react` is `dist/react.js`
beside `dist/react.d.ts`, and `snapback4/bin-path` is `dist/bin-path.js`. The CLI is `node_modules/.bin/snapback4`.

Release compatibility: `snapback4/react` exports `useRelease`; `snapback4/contract` exports `operationAvailable`. Generated handles inline the same check once per file; generated modules import only package types. Generated `server(startServer, handlers, options?)` takes the runtime imported by your application from `snapback4/server`. `guide deploy` covers the saved-baseline opt-in.

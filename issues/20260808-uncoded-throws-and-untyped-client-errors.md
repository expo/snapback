# Uncoded throws on published client subpaths; thrown mutation errors are structurally untyped

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P1 · **Area:** snapback-client / snapback-react / snapback-codegen / swift client

From the 2026-08-08 agentic surface audit (LLP 0202 theme 4).

`guide/operating/diagnostics.md:19` promises "Snapback failures carry stable
machine identity" and tells consumers to branch on the code, never the
message. Several published surfaces break the promise:

- **Uncoded bare throws on documented subpaths.**
  `@expo/snapback-client/external-store` throws `'external query store is
  closed'`, `'…already has active mutation ${id}'`, `'…registry is closed'`,
  `'external query scope is closed'` (`packages/snapback-client/external-store.mjs:352,354,476,529`)
  — no `.code`. Also `optimistic-rebase.mjs:337`, `sender-proof.mjs:80,133,180`,
  and `index.mjs:8936` (`'Snapback live stream is not open yet…'`).
- **Codegen: 20 uncoded throws**, several with no file/span — worst:
  `` `unserializable expr ${JSON.stringify(expr)}` ``
  (`packages/snapback-codegen/index.mjs:5123`) and the artifact/auth tuple
  throw (`:11549`); 18 more at `:7034,:7050,:8883,:11659,:11842,:11907-11960`.
  47 of the codes codegen *does* raise appear nowhere in the guide.
- **Thrown mutation/command errors are typed `unknown`.** No error interface
  is exported from `@expo/snapback-react`; `@expo/snapback-client` exports
  exactly one (`SnapbackQueryOfflineUnavailableError`,
  `index.d.mts:329`). The guide's own paved snippet hand-writes a structural
  cast (`guide/clients/react.md:424`). `SnapbackDiagnostic.code` is typed
  `string`, so no branch is compiler-checked.
- **Swift arm:** `ClientError.transport/.undecodableResponse/.invalidState`
  are free-form strings with no stable code; only `.refusal` carries one
  (`clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift:48-62`).
- 138 of 172 distinct codes raised by the core client entrypoints appear
  nowhere in `guide/` — including `SNAPBACK_AUTH_SESSION_EXPIRED`,
  `_SESSION_REVOKED`, `_CODE_INVALID`, `_CODE_LOCKED`,
  `SNAPBACK_ASSET_TRANSFER_FAILED`, `SNAPBACK_REACT_PROVIDER_CLOSED` — the
  codes every real app must branch on. (Lookup substrate:
  `issues/20260808-diagnostics-code-registry-and-lookup.md`.)

## Fix

1. Assign codes to the bare throws (`SNAPBACK_EXTERNAL_STORE_CLOSED`,
   `SNAPBACK_LIVE_STREAM_NOT_READY`, codegen family) and fold them into the
   generated diagnostics registry.
2. Export `SnapbackMutationError` / `SnapbackAppRefusalError` interfaces
   carrying `diagnostic: SnapbackDiagnostic`; narrow `code` to a generated
   union emitted from the registry so the guide's cast disappears.
3. Add a `code` payload to the three client-originated Swift cases, drawn
   from the same registry.

# RN durable store on-device witness (B1)

On-device witness for the React Native durable RQS store arm
(`packages/snapback-client/rqs-store-expo.mjs` + the default-ladder RN rung),
run 2026-08-01 on an iPhone 17 Pro simulator (iOS 26.3, Hermes, release
build) against the published 0.1.8 closure with this branch's client delta
overlaid, a real `expo-file-system` 57.0.1 module, and a 0.1.8 local
`snapback dev` target (the a1 field-notebook backend, whose `listSites` is
the declared retainable public query).

Facts proven on the real carrier (`evidence/b1-witness.json`):

- **Ladder resolution on real RN:** after the one-line root registration
  (`registerExpoFileSystemRqsFiles(FileSystem)`), `resolveDefaultRqsStore`
  and the client constructor resolve
  `{ source: 'default', implementation: 'file', durable: true }` under
  `navigator.product === 'ReactNative'`.
- **Persistence through the documented path:** the retainable public query
  held a server-minted resume token and an explicit
  `handle.flushResumeState()` (the LLP 0091 step-5 lifecycle wiring)
  committed the blob under `Paths.document/snapback-rqs/` (per-origin
  identity slug).
- **No protected bytes at rest:** a protected query's sentinel row
  (`SENTINEL_PROTECTED_B1_NEVER_AT_REST`) flowed live but never appeared in
  the blob; its retention fact names the refusal
  (`SNAPBACK_RETENTION_NOT_RETAINABLE`, authority-scoped).
- **Cold-boot retained render:** with the server down, terminate + relaunch
  renders the 3 persisted rows with `freshness: 'retained'`,
  `connection: 'stale'`, retention reason "offline boot from verified
  persisted entry" (`evidence/b1-shot-1-cold-retained.png`).
- **Protected queries never cold-render:** the offline protected subscribe
  surfaced the raw connectivity refusal, no rows.

Harness notes: `b1-run-ios.mjs` is the host driver (loopback director on
4612, dev server on 4298, ports 4287-4297 guard-blocked; simulator keychain
reset pre-run — expo-secure-store entries survive uninstall);
`probe-App.tsx` is the on-device half (built into the frozen neutral-expo
shell); `node-control.mjs` is the node projection of the same flow used to
isolate the one defect the witness surfaced (sequential short-lived clients
degrade to non-persisting readers — see
`issues/20260801-rqs-default-store-lifecycle-sequential-clients.md`).

The store-contract acceptance itself (the full Channel B resume suite) runs
in CI on the node projection of the pinned expo-file-system API:
`packages/snapback-client/rqs-resume-expo.test.mjs` and
`rqs-store-expo.test.mjs`.

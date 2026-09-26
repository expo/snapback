# 0.4.2 publication attempt 2: stopped before qualification

Attempt 2 rebuilt the framework and the Release chat-expo app, then ran the
native witness. Both segments passed. Before `qualified.json` was written, the
witness manifests showed which bytes it had run:

- The witness backend was `target/debug/snapback4`, built at 14:27 PDT.
- The client package output, `packages/snapback4/dist`, was dated 14:19 PDT.

Both predate the fence fix, which was merged into this branch at 16:18 PDT
(`b22d59d65`) and changed `snapback4-core` and
`packages/snapback4/src/local-query.ts`. The witness therefore ran the
pre-fix CLI and bundled the pre-fix client. It does not qualify 0.4.2.

Attempt 2 had omitted the CLI, wasm and client-package builds that 0.4.1's
attempt 3 ran before its Release build. No publication command ran, and
nothing was published.

Preserved here:

- the step records;
- the witness artifacts, in `20260925-expo-0.4.2/`;
- the two lines the witness appended to `metrics/witness.jsonl`, in
  `witness-metrics-lines.jsonl`. They were removed from the series.

Attempt 3 follows 0.4.1's order. First, the local builds:

1. bun install.
2. The framework, then `native-prepare`, which records the source and the
   framework hashes.
3. The CLI.
4. wasm.
5. The client package.

Then the checks and the native witness:

6. npm identity.
7. Simulator boot.
8. The chat backend check.
9. The Release app.
10. The root hook dependencies.
11. Install on the simulator.
12. Link verification.
13. The witness.
14. Qualification verification.
15. Shutdown.

Last come the publication dry run and resume, then the Expo pack and publish.

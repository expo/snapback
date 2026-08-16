<!-- @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real — published packages must route readers to checkout-independent documentation. -->

# `@expo/snapback-runtime-linux-x64`

Prebuilt Snapback server and Hermes runtime for x86-64 Linux. Application
authors normally receive this platform package through `@expo/snapback-cli`;
do not install it directly or treat the platform artifact as the authoring API.
The package also carries the build-matched immutable admin-console snapshot;
the CLI selects it automatically when starting this runtime.

## Documentation outside a checkout

A running Snapback server serves the Guide compiled into that exact build.
These links use the first default development port; use the origin printed by
`snapback dev` or `snapback start` if yours differs.

- Read first: [the start packets](http://127.0.0.1:4287/_snapback/guide/start/index.md)
  — the budgeted per-template first read (LLP 0259).
- Look up (do not linear-read) the [capability index](http://127.0.0.1:4287/_snapback/guide/capabilities.md).
- Read [running the server](http://127.0.0.1:4287/_snapback/guide/operating/running-the-server.md)
  for supported runtime lifecycle and readiness behavior.
- Run `snapback guide` or `snapback guide <query>` to browse or search the
  embedded Guide.
- Run `snapback mcp` for the same build-bound corpus as read-only MCP
  resources, starting at `snapback-guide://manifest`.

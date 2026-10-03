# Merged starter dependency audit

Both old starter dependency inventories match round-5 pins. Each merged
inventory differs at the same 169 paths, exclusively under `snapback4`,
`snapback4-expo`, `snapback4-darwin-arm64`, and npm’s hidden lock metadata.
All external Expo/config/plugin/helper package bytes are unchanged.

The installed `snapback4-expo/plugin.cjs` differs from the previously audited
plugin only in its LLP annotation. Its two callbacks write the fixed scene
lifecycle to the generated Swift AppDelegate and the fixed Info.plist scene
manifest. They read no application JS or ambient environment. The config-plugin
entry remains explicit in the generated config; no writer is hidden or ignored.
Other Expo-package changes are README/version, rebuilt merged device libraries,
and the xcframework header links/metadata. Native device behavior is bound by
those library bytes; it does not execute as a config plugin. The export wrapper
is unchanged from round 8. Client package changes are merged generated JS,
wasm, types, CLI/docs/metadata and npm-pack’s omission of `src/`. The optional
Darwin binary and its manifest advance to the installed 0.4.11 registry package;
these runs explicitly select the locally rebuilt merged production CLI.

The pin delta adds one exact Expo package-tree hash and two exact complete
installed dependency hashes. No input, mod registration, assertion, guard or
unknown-plugin fallback is removed. This integrates the merged package content
with NX’s existing audited cache, rather than admitting a version range.
`dependency-audit.json` binds the pin change; the full before/after path inventory
is archived as `round9/dependency-delta.json.gz`.

This late integration correction follows the single canonical suite. The final
pin bytes receive fresh mini witness units/integration and export/config tests,
plus Linux witness verification, without claiming that the earlier canonical
invocation contained them. Final native prime and warm proofs use the rebuilt CLI.

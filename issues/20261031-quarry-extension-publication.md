# Publish the Quarry VS Code extension (marketplace + Open VSX)

**Opened:** 2026-10-31 · **Source:** LLP 3000.041 §4 steps 6–7, §9 ruling 2

The extension at `snapback4/editors/vscode/` builds locally as a `.vsix`
(`bun run package`) and is fenced by `scripts/check-editor-grammar.mjs`. The
RFC defers marketplace and Open VSX publication until one release has carried
the fence green. Ruling 2 names the extension `quarry`; the publisher is
whichever account the project holds.

Steps: create or confirm the publisher; add a `publish` script using the pinned
`@vscode/vsce` and `ovsx`; publish the version that matches the `snapback4`
release the grammar was generated from; record the marketplace URL in
`editors/README.md` and the package README's editor line. Follow the rapid
publication posture of LLP 0041: do not batch.

# demos/_kit

Shared machinery every demo uses: the framework-neutral client
(`client.mjs`), safe server lifecycle (`server-process.mjs`), the acceptance
harness (`harness.mjs`), and shims re-exporting the codegen authoring
surface (`define.mjs`, `codegen.mjs` — kept because definition markers are
Symbols and one module instance must be shared).

**If you landed here to learn how to build on Snapback, start with the
guide instead:** [`guide/index.md`](../../guide/index.md) teaches the
authoring surface intent-first with verified snippets — many of them
transcluded from this kit and the suites that use it. The kit files are the
implementation; the guide is the map.

## 2026-07-29 — final installed-package confirmation (draft)

The frozen Linear result stayed **10 PASS, 4 GAP, 0 FAIL** when rebuilt from
the immutable `0.1.1-llp0102.1` Darwin package closure in a clean external
project. Installed codegen, the packaged native runtime, session authority,
conflict behavior, native push, the React board, performance samples, and
exact cleanup all worked without repository imports or a source-binary
fallback.

The best part was that the runtime result did not change at the package
boundary. The worst new finding was concrete: `@snapback/client/online` is a
published export without TypeScript declarations, so the external React build
needed an ambient declaration. Installed `snapback start/stop` also required
an arm-local lifecycle wrapper for readiness, credentials, and cleanup.

The original 1,024-write ceiling, relational composition work, and the four
search/offline/migration/hosted gaps remain unchanged. This pass should improve
confidence in distribution, not improve the arm's product score.

# Expo startup prose handoff

Base `8f48dc8ef72ba68197a456b1149c3d652b592d21` → commit `cf6f8495dba799e5844fa9236cd4ed4f1380894b` on `s2/clique-guide-startup`. Worktree is clean; original `s2/clique-guide` remains `f7c7b10611bc936162475f1fa8ddb1ca3345b184`. Only the two authorized prose leaves changed (9 insertions, 1 deletion); all other tracked content is byte-identical to base. No push.

The README and one-screen grammar now give `snapback2 init my-app --template chat --client expo` and distinguish scaffolding/CLI setup (`guide init`), authentication (`guide auth`), and the current backend's certified facts (`guide app`). Self-review confirmed those roles against existing init help, auth guidance, and guide dispatch. This exposes existing Expo support; it adds no capability or alias and preserves guide app semantics.

Read root/Snapback2 AGENTS, RULES/NOT-DOING, LLP 1000, LLP 1002 §8, the affected pages, and the immutable external diagnosis report/receipt. Scoped `llp-orient` found the existing LLP 1002 routing contract sufficient; no LLP edit was needed.

## Exact committed diff

```diff
diff --git a/snapback2/packages/snapback2/README.md b/snapback2/packages/snapback2/README.md
index 8960ef474..5f619aec8 100644
--- a/snapback2/packages/snapback2/README.md
+++ b/snapback2/packages/snapback2/README.md
@@ -7,6 +7,11 @@ headless client, React web arm, and CLI shim. It requires Node 20 or newer for N
 npm install snapback2 react
 ```
 
+Start an Expo app with `snapback2 init my-app --template chat --client expo`.
+Use `snapback2 guide init` for scaffolding and CLI setup, `snapback2 guide auth`
+for authentication, and `snapback2 guide app` for the current backend's certified
+facts.
+
 ```ts
 import { api, createClient } from "snapback2/client";
 
diff --git a/snapback2/packages/snapback2/guide/grammar.md b/snapback2/packages/snapback2/guide/grammar.md
index 2e93e2a5b..7f478ec70 100644
--- a/snapback2/packages/snapback2/guide/grammar.md
+++ b/snapback2/packages/snapback2/guide/grammar.md
@@ -1,6 +1,9 @@
 # Quarry grammar
 
-Start a project with `snapback2 guide init`; CLI options use `<command> --help`.
+Start an Expo app with `snapback2 init my-app --template chat --client expo`.
+`snapback2 guide init` covers scaffolding and CLI setup; `snapback2 guide auth`
+covers authentication; `snapback2 guide app` shows the current backend's certified
+facts. CLI options use `<command> --help`.
 `check` validates sources; `dev --status` shows what the owner has installed.
 
 Schema: `snapback/schema.q`. Programs/shapes: `snapback/<module>.q`.
```

## Checks and first failures

| Check | Exit | Elapsed / bound | Receipt |
| --- | --- | --- | --- |
| caps | 0 | 2.626s / 60s | `caps.log` |
| references | 0 | 11.643s / 60s | `references.log` |
| package-prose | 1 | 0.944s / 60s | `package-prose.log` |
| diff-check | 0 | 0.256s / 60s | `diff-check.log` |
| package-correspondence-r2 | 0 | 0.437s / 60s | `package-correspondence-r2.log` |

The first package adapter failed on my incorrect assumption that grammar contained no fenced examples. That failure remains in `package-prose.log` and `checks.json`; no product change was made in response. The corrected correspondence check uses the existing package keyword function and declared byte cap: grammar is 3487/3584 bytes; all 23 keyword outputs, grammar/README fenced examples, and the other nine package guide pages match base. It does not claim parser or typecheck execution. Exact commands and owned PIDs are retained in the JSON receipts. All bounds stayed 60 seconds.

Read-only discovery also encountered a guessed missing `snapback2/scripts/caps.mjs` path (actual caps is root `scripts/caps.mjs`) and no-match symlink/hook searches. These were lookup misses, not product gate failures. Original external diagnosis observations remain attributed and untouched: `guide expo` was unsupported (`E_GUIDE_UNKNOWN`), while `guide init` already advertised Expo/chat; no installed observation was repeated here.

No package build, install, runtime/source tests, publisher, registry, benchmark, or unrelated lane was used. No new packed/installed-package or broader qualification claim is made. Root owns prose inspection and any landing.

## Custody and release

Native writer: `gpt-6-astra`, `xhigh`, UUID `01a0783e-90b6-70b3-a096-c7a980574ceb`; actual CLI PID 11285, parent supervisor 11280, as recorded by `launch.json`. Every newly started check completed and was waited; no helper/server remains owned or needed stopping. No foreign process was inspected or signaled. Final source check confirms the clean branch, exact parent, two-file delta, and preserved original ref.

Writer released after this handoff. The CLI is still active while writing it; parent `launch.py` records the actual terminal after return. No exit status is fabricated.

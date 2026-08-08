# Template polish sweep: inline-args exemplar, senderId caveat placement, READMEs, usage-string drift

**Opened:** 2026-08-08 · **Severity:** P3 (templates, batched)

One pass over packages/snapback-cli/templates/ (+ two guide adjacencies)
closes all of these:

1. **react template models the inline-args churn trap.**
   templates/react/src/App.tsx:9-12 passes a fresh inline entries/args
   object to `useSnapbackQueries` every render; the hook memoizes on
   `entries` identity (packages/snapback-react/index.mjs:2669-2670), so the
   scaffold resubscribes per render — the exact pattern SKILL.md trap 3
   warns about, in the code every scaffold copies. Hoist the entries map to
   module scope (args are static `{}`). Same exemplar problem in the guide:
   guide/clients/react.md:137's sourced snippet inlines its args object —
   hoist in the fixture or add a one-line caveat. (Both become moot if
   issues/20260806-usesnapbackquery-inline-args-resubscribe.md lands
   content-keying — coordinate.)
2. **expo-chat mutations accept client-supplied `senderId`**
   (templates/expo-chat/snapback/functions.mjs:71-77, 95-101) — the
   anti-pattern SKILL trap 2 says is never the security boundary. Source
   comments do flag it, but not in the client code an agent extends.
   Either derive sender from the session with personas display-only, or
   move the caveat into the template's AGENTS.md.
3. **No template ships a README.md** (AGENTS.md only); react template's
   index.html lacks a `<title>`; and create-snapback-app/cli.mjs:66 prints
   "read AGENTS.md (when the template ships one)" — all three templates
   ship one, so drop the hedge.
4. **`snapback new` usage string hardcodes the template list**
   (packages/snapback-cli/index.mjs:3584 area) while create-snapback-app
   enumerates `listTemplates()` dynamically — the static list silently
   drifts when a template is added. Derive it. Also consider naming the
   default-template divergence (`snapback new` → todo-contract;
   `npm create snapback-app` → expo-chat) in help output, and a sentence in
   todo-contract's AGENTS.md noting it is backend+headless only (the name
   suggests a Contract UI it doesn't contain).
5. **react-expo.md's "add Snapback to an existing blank Expo app" section
   (:60-74)** steers through the `--template react` sibling-scaffold-and-copy
   dance and only reveals the Expo-native expo-chat template 400 lines
   later (:486-488). Name it in the install section.

Portfolio-shaped holes (no minimal non-chat Expo starter; no sessions-mode
web starter / dev→sessions conversion example) are deliberately NOT
ticketed here — LLP 0196 owns portfolio breadth (T1/T2, OQ1) and its T4
recipe queue; this review's findings confirm the demand it already models.

Found by the 2026-08-08 comprehensive docs review (templates slice).

# guide-gap: eleven diary friction points verified unabsorbed (batch)

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P1 batch · **Area:** guide pages / jobs / react-expo / headless client

From the 2026-08-08 agentic surface audit (LLP 0202 theme 10). Each item was
recorded in a diary, then re-verified against the current guide and source —
these are the ones with no fix and no ticket. Two were flagged in multiple
runs. Per LLP 0061 §5, each should be absorbed by a page or capability-index
row; they are batched here to keep the tracker manageable, and any item can
be split out when picked up.

1. **Jobs `maxAttempts: 1` default vs routine reservation contention**
   (diary 0057): the push job's first attempt routinely fails on
   authorization-reservation contention, so the obvious spelling of
   "enqueue a notification" goes terminal-`dead` on the first move of most
   games. `guide/backend/jobs.md:67` still documents only the range; zero
   mentions of contention or `RESERVATION_STALE`. The closed ruling
   (`issues/closed/20260804-authoring-omission-defaults-widen-effects.md:70`)
   kept the default on bounded-work grounds without addressing the
   contention interaction — the page needs the paved
   "retryable-by-design" recipe even if the default stands.
2. **Unguarded `registerExpoFileSystemRqsFiles` snippet white-screens web**
   (diary 0056): the shipped template now carries the `Platform.OS` guard
   *with* the explanatory comment
   (`packages/snapback-cli/templates/expo-chat/App.tsx:20-24`), but
   `guide/clients/react-expo.md:497-504` still ships the bare call; `:368`
   says it "is unnecessary there," not that it throws at module scope.
3. **"Can I index a system field?" is unanswered** (diary 0057 §21:09 — the
   arm shipped a worse cursor because the answer wasn't findable). No
   mention of indexing `_version`/system fields anywhere in `guide/`.
4. **`virtual:snapback/dev` has no guide mention** (diary 0061): templates
   ship the ambient declaration (`templates/{react,crud-dashboard}/src/snapback-dev.d.ts`)
   but hand-built apps get no doc — zero hits for `virtual:snapback` in
   `guide/`.
5. **Dead-letter vocabulary is absent** (diary 0057): `dead` state exists in
   `guide/backend/jobs.md:136` but "dead-letter"/"DLQ" appear nowhere in the
   guide or capability aliases — the exact LLP 0187 vocabulary-as-API miss.
6. **Succeeded-after-retry is invisible** (diary 0057): a succeeded job row
   carries `lastErrorCode: null`, indistinguishable from first-try success;
   unrecorded anywhere.
7. **Headless `liveQuery` defaults to manual-poll transport** (diary 0065
   miss 4b): documented, but the default surprised a measured lane; no
   alias/callout at the point of use.
8. **`expo-file-system` hand-written version trap** (diary 0056): a
   plausible wrong constraint installs cleanly and silently disables durable
   persistence in plain JS; the registration snippet lacks the "use
   `npx expo install`, never hand-write the constraint" warning.
9. **Dev-mode auth × packaged React provider don't compose for multi-persona
   apps** (diary 0056), and the one shipped native demo sidesteps it via the
   checkpoint-era bridge that `react.md` lists as an anti-pattern
   (`demos/partiful-matrix/native/react-expo`).
10. **In-checkout codegen invocation on the first page** (diary 0057):
    `guide/getting-started/your-first-backend.md:295` still says
    `node packages/snapback-codegen/index.mjs myapp/snapback` rather than
    the packaged form.
11. **Compose-into-existing-app path has no owner** (diary 0063): the guide
    documents registry constraints but not the install set for composing a
    Snapback backend into an existing `create-expo-app` project, and
    `snapback new` only creates whole projects. (Nearest ticket,
    `20260808-llp0196-template-program-execution.md`, covers templates, not
    composition.)

Also re-verify (closed but flagged as a repeat finding across two runs,
diary 0069 residues 5–6): the verify-config authoring contract's guide
anchor (`issues/closed/20260808-verify-config-authoring-guide-anchor.md`)
and the `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` guide anchor.

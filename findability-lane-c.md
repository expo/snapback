# Findability lane C report

Date: 2026-08-28

This lane adds retrieval routes to existing pages; it does not add a second
Guide page for any capability. Route terms in cases 114–121 are limited to
failed-lane/audit vocabulary. API names and repairs appear only in Required
guidance.

## Per-row disposition

- **O25 — structured-value ceiling.** Routed media-first authors from
  `guide/getting-started/your-first-backend.md` before field authoring, and
  repeated the early warning in the `expo-chat` and `media-feed` first reads.
  The route explains that base64/data-URI bytes are row data, the structured
  form has an independent 32 KiB per-value ceiling, and the boundary is the
  same in Explicit and Familiar authoring. Failed vocabulary used:
  **“base64 video.”** Retrieval case: **114**.

- **O27 — collection versus typed child row.** Routed
  `guide/backend/media-happy-paths.md` from the failed relationship description
  to the existing typed-child-row section, before the collection declaration.
  It distinguishes an owner-visible generated collection from a public social
  parent with cross-author reads and states the profile scope. Failed
  vocabulary used: **“owner-visible collection parents interacted with
  cross-author feed reads.”** Retrieval case: **115**.

- **O28 — media readiness.** Routed `guide/recipes/view-once-media.md` to the
  existing `MediaState` contract. The block defines metadata-ready versus
  openable, identifies the URL-bearing states, and keeps non-media message UI
  visible while delivery settles. The consumer contract is shared by Explicit
  and Familiar; the declarations on that page remain Explicit. Failed
  vocabulary used: **“video bytes never became observable,” “metadata-ready,”
  and “openable.”** Retrieval case: **116**.

- **O36 — multi-asset commands.** Routed the legacy one-asset refusal in
  `guide/backend/media-happy-paths.md` to `defineMediaCommand`, including its
  bounded ordered uploads and atomic parent/collection commit. The page now
  spells out how Explicit and Familiar consumers relate to this extension.
  Failed vocabulary used: **“no multi-asset command (`defineCommand` is one
  asset).”** Retrieval case: **117**.

- **O1 — package, template, and Expo tuple discovery.** Routed
  `guide/start/index.md` from all three observed guesses to the published CLI
  package, live five-template registry, and scaffold-owned dependency tuple.
  Package discovery is profile-neutral; the current template registry is
  explicitly identified as Explicit-scoped with no Familiar-named template.
  Failed vocabulary used: **“mistaken unscoped `snapback@0.1.29` lookup,”
  “published CLI rejected unknown `expo-router` template,” and “assumed legacy
  `expo-router` major 7 for Expo 57.”** Retrieval case: **118**.

- **O2 — constrained Metro ports.** Added the lane symptom to the `expo-chat`
  start packet and routes it to one `--port-range <lo>-<hi>` containing every
  owned listener. The rule is shared by Explicit and Familiar backends. Failed
  vocabulary used: **“Metro's inner port escaped 4287–4387.”** Retrieval case:
  **119**.

- **O37 — supervised dev and stdin.** Added the failed pipe-EOF symptom and
  corrected behavior to the `expo-chat` start packet. Also fixed the stale
  `snapback dev` recovery text in `packages/snapback-cli/index.mjs`: EOF now
  closes only the optional command channel, while signals or a TTY quit end the
  owner. `packages/snapback-cli/dev-cli-diagnostics.test.mjs` now guards both
  the corrected claim and removal of the stale one. This lifecycle behavior is
  shared across authoring profiles. Failed vocabulary used: **“supervised Expo
  web wants stdin detached or the owner dies on pipe EOF.”** Retrieval case:
  **120**.

- **O44 — behavioral retrieval evidence.** `guide/retrieval-eval.md` now states
  the static evaluator's limit and the evidence needed to cross it: a fresh
  agent, the original intent and tool budget, no expected page or answer-side
  vocabulary, a complete tool transcript, and scoring of the first page load,
  chosen technique, and rejected anti-patterns. Profile-neutral claims require
  one Explicit and one Familiar cell. I did not add a model-running harness:
  that is not a cheap extension of the deterministic substring checker and
  would create a new credentialed evaluation surface. Failed vocabulary used:
  **“broad searches frequently returned no result even when a relevant page
  existed.”** Retrieval case: **121**.

## Verification

- `node scripts/check-retrieval-eval.mjs` — passed: 120 cases, 5 Rosetta
  records, 0 errors.
- `./ref-check --verbose` — passed: 326 LLP documents, 6,908 refs in 13,136
  files, 0 errors, 0 unchecked.
- `node scripts/check-first-read.mjs --check` — passed: 5 profiles. The
  `expo-chat` and `media-feed` template transclusions/digests were refreshed
  with the repository writer after the authored packet changes.
- `node packages/snapback-cli/dev-cli-diagnostics.test.mjs` — passed: 19 CLI
  help/refusal/environment-pin cases.
- Scoped Guide link/anchor audit — passed across 158 pages: every link resolved
  and every anchor was unique.
- `git diff --check` — passed.

## Regeneration handoff

Regeneration is needed over the integrated tree for the Guide publication
leaves, including `guide/guide-flat*.generated.md` and
`guide/guide-manifest.generated.json`. Per lane constraints, I did not edit
those files or anything under `guide/reference/`.

No commit, push, or rebase was performed.

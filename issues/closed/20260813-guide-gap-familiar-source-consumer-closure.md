# Guide gap: familiar source-consumer closure and sessions reload

**Opened:** 2026-08-13 (Clique convex-familiar pilot)
**Status:** Resolved 2026-08-15

The reduced Clique source-diagnostic run at Snapback commit `e15064b46` forced
both independent builders to discover familiar-profile integration behavior
outside the intent-indexed guide. This is distinct from the existing 0.1.21
publication pickup ticket: publishing a matched closure removes much of the
problem, but contributors and pre-publication evaluators still need a bounded,
proved source-consumer path.

The guide should provide one CI-verified familiar Expo/web recipe that covers:

1. installing or packing one build-matched source closure so client, React,
   codegen, contract, CLI, runtime, and Hermes assets cannot drift or load two
   prepared-binding singletons;
2. generating `_generated/` artifacts and starting a qualified source runtime
   without requiring the author to reconstruct the carrier handshake from
   package source;
3. reloading changed functions in sessions mode, including when an artifact
   identity requires a fresh database and replay rather than an offline swap;
4. the exact familiar React projection rule for `useQuery` (including when a
   non-live or refreshing snapshot projects as unavailable) and the supported
   recovery API, so an author does not invent a polling fallback from source
   inspection;
5. a two-browser Expo-web messaging example proving controlled RN `TextInput`
   composition alongside live message rerenders and four-second ephemeral
   typing presence.

Retained evidence is summarized in
`benchmarks/runs/2026-08-13-clique-familiar-pilot/record.md`. In the raw lanes,
Sol inspected the server-process/client packages to recover carrier and dotted
reference behavior; Grok inspected the familiar React projection source and
ultimately left M3 choreography non-green after repeated Composer/presence
loops. The diary must continue to distinguish product defects (for example,
codegen/client function-name grammar and query-limit parity) from knowledge the
guide could have supplied.

Acceptance should include a capability-index row and a checked cold recipe
whose consumer starts from a clean app directory, runs the familiar profile
from the pinned source checkout, changes one function under sessions dev,
observes a live two-browser update, publishes/expires typing, and exits without
source inspection or an undocumented package patch.

## Resolution — 2026-08-15

Provenance note: this ticket was filed 2026-08-13 but sat untracked in the
primary checkout (never committed); it enters git already resolved. Every
numbered ask was absorbed by the familiar wave that landed between
2026-08-13 and 2026-08-15:

1. **Build-matched closure** — the setup tax this ticket was opened against
   was pack-from-source; the familiar surface has since shipped in the
   qualified releases 0.1.21 (2026-08-14, twelve-package closure including
   the first `@expo/snapback` publication; see
   `issues/closed/20260814-umbrella-first-publish-gate.md`) and 0.1.22
   (`guide/published-closure.json`: newestPublished/newestQualified 0.1.22).
   The two-singleton/drift hazard closed with the generated-directory
   unification — `snapback/generated/` is canonical and `_generated/` is a
   hard refusal including symlinks (LLP 0253 r4;
   `issues/closed/20260815-familiar-codegen-generated-directory-mismatch.md`).
2. **Codegen + qualified runtime start** — `guide/backend/familiar-profile.md`
   (CI-verified, `since: 0.1.21`, reviewed 2026-08-15) owns the end-to-end
   "One Expo Router journey", including `snapback generate` /
   `snapback dev --expo` without carrier-handshake archaeology.
3. **Sessions-mode reload** —
   `issues/closed/20260815-guide-gap-sessions-schema-evolution-narrative.md`.
4. **`useQuery` projection rule** — the familiar page documents
   `useQuery`/`useQueryState` (including the connection/freshness/blocked
   projection and the identity-churn diagnostic), and scalar single-value
   query results now lower canonically (`d12851c03`; LLP 0253 r5), removing
   the one-row-array workaround the pilot invented.
5. **Two-browser messaging/typing recipe** — the page's CI-bound examples
   include `packages/snapback-cli/templates/expo-chat` and the familiar
   acceptance fixtures; the operation-grammar/Metro seams that blocked the
   pilot's choreography closed in
   `issues/closed/20260815-generated-operation-name-seams-metro-and-client-grammar.md`.

The capability-index row exists (`backend.familiar-profile-v1` in
`guide/capabilities.md`). The one residual this ticket surfaced — native
process-restart session custody had only a hand-rolled, guide-documented
adapter — ships as first-party surface
(`@expo/snapback-contract/auth-custody-secure-store`) in the landing that
closes this ticket (LLP 0059 amendment of 2026-08-15). The familiar
client-bundle metrology rollover mint remains separately tracked in
`issues/20260813-familiar-subpath-metrology-mint.md`.

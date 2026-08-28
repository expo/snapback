# LLP 0317 — grok-4.6 review artifact

Provenance is recorded per review. Bodies are verbatim as received; nothing
is summarized, reconstructed, or edited.

## Round 1 — 2026-08-28, verification lens

- **Reviewer:** `grok-4.6` @ xhigh, headless single-turn, full terminal ban
  (built-in `read_file` / `list_dir` / `grep` only; `run_terminal_command`,
  `search_replace`, `write`, and the media/workflow tools denied at the CLI).
- **Revision reviewed:** LLP 0317 `Draft` as authored 2026-08-27, sha256
  `5d7682d171827312d1e820f161a42b39a6a42a4c0dea2f765e2a9ffd90d9d732`.
- **Capsule:** worktree at `origin/main` `f977fa589` + the target +
  `clique-evidence/` (four Snapback lanes plus two comparison lanes).
  Structural blindness: no `llp/reviews/0317*` artifact existed in the capsule.
- **Instruction hash (sha256/16):** `8d57708282cf46f9` (8,515 bytes); shared
  brief `e7959acac7eff81c`.
- **Launched** 2026-08-28T00:22:05Z; **returned** 2026-08-28T00:30Z, exit 0,
  complete review, sealed until the codex artifact landed.
- **Verdict:** **NOT READY** (2 MATERIAL, 4 non-blocking, 10
  out-of-declared-scope scale-tail items).
- **Self-declared limitation:** the terminal ban left the six cited commit
  SHAs `UNVERIFIED (no git access)`; the reviewer substituted current-file-state
  checks, as the brief instructed. The orchestrator verified all six commits
  independently (see the run journal).
- **Transcript note:** the CLI emitted its inter-turn progress narration on
  the same physical line as the review's first heading. The body below is the
  raw stdout, byte-for-byte, narration included; nothing was removed.

### Verbatim review

I'll verify LLP 0317 against the four Snapback lanes' evidence, cited artifacts, and current repo state. Starting with the document and the evidence map.I'll read the related tickets, F-row artifacts, and lane diaries next so each inventory row can be checked against evidence.O29’s source ticket names a different lane; I’ll check whether the four Snapback lanes actually contain that event, then scan diaries and structured logs for every correction cause.I’ll map remaining F/N/O rows to run-log events and check for distinct causes the inventory omitted.O29’s ticket names a fifth lane; I’ll confirm that in-repo glm evidence and keep scanning for other inventory gaps.## MATERIAL findings

**M1. O29 is not a correction cause in the declared four-lane evidence.**

Evidence: LLP 0317 §Scope inventories “those lanes” (`sol-snapback-explicit`, `sol-snapback-familiar`, `terra-snapback-explicit`, `terra-snapback-familiar`). A search of `clique-evidence/{sol,terra}-snapback-*/` finds no `minimumLength` successor event. The Related ticket `issues/20260827-defineauth-successor-silent-refusal.md` sources **`glm-snapback-explicit`**, quoting a silent `defineAuth.minimumLength` no-op; that lane’s own log is `benchmarks/runs/2026-08-27-clique-published-0129-matrix/lanes/glm-snapback-explicit/run-log.md` at `TS=1787858800` (“signup still returned `must be 12-1024 bytes` after successor; after reset returns 8-1024”).

What must change: Remove O29 from the four-lane inventory, **or** expand the evidence base and cite glm as an additional matrix cell. If removed, also drop O29 from §Priority synthesis bundle 4 and from “O29 is a silent-degradation defect…” in §Proposed proof.

**M2. F2 over-claims shared Node `storagePartition` as the dominant cause of the matrix’s broad fanout report; the residual row O14 is too narrow to hold what F2 then leaves behind.**

Evidence:

- F2’s *observed* cause is real for Node/headless: `clique-evidence/sol-snapback-explicit/run-log.md` `1787853600` (“headless clients shared the default durable auth partition, so the second client restored the first principal”), repaired at `1787853610` with per-actor `storagePartition`.
- That repair predates the later live-query misses. After partitions were in place, `1787861040` still records that “Neither the JS conversation query nor a dedicated declarative reactions-by-chat subscription emitted an update for reaction insert/patch, while fresh one-shot projections immediately contained the committed row.” That is O14, and it is not a partition bug.
- Familiar M3 is not a Node-partition event. `1787857038` is Playwright: “mutation settled and was absent from **same live hook** for 3s, then present after a fresh session/query.” `1787857472` is “cross-client live fanout remained stale despite server aggregate revision while same-client projection updated.” The implicit-reuse warning on current main is Node-gated (`packages/snapback-client/app-client.mjs` `warnImplicitDefaultPartitionReuse`: `typeof globalThis.process?.versions?.node !== 'string'`). Separate Playwright contexts do not share that default Node partition; a same-hook miss cannot be “Bob restored Alice.”
- O14 as written only names “committed child-row reaction inserts/patches.” Familiar M3 is message live-query staleness, not that residual.

What must change: Narrow F2 to the Node/headless shared-partition event (explicit M1, plus any familiar **replay** identity collisions that actually omitted `storagePartition`). Do not call it the dominant cause of the broad fanout report. Put same-client / two-browser live-query misses in O14 (broadened beyond reactions) or in a new O-row, still open, with a clean two-partition **and** two-browser repro.

## Non-blocking findings

**m1. O6 is a backlog row that no §Priority synthesis bundle covers.**

O6 is unexplained owner loss at `clique-evidence/sol-snapback-explicit/run-log.md` `1787854310` (attribution=`environment`; no Metro `ENOENT`; no closure receipt; store preserved). Bundles 1–5 list O14–O19, O25–O28, O20/O21/O24, O3/O9–O13/O23/O29/O30, and O1/O2/O4/O5/O7/O8/O22 — not O6. Either park it with F1 (the document already says they may collapse) or put it in the template/lifecycle bundle.

**m2. O3 understates the Familiar policy diagnostic gap the diary named.**

`clique-evidence/sol-snapback-familiar/run-log.md` `1787852830` is `CODEGEN_POLICY_INVALID` from incomplete `codegen.policy.json`. The diary says that code “lacked a working exact diagnostic page.” Current `guide/` has **no** `CODEGEN_POLICY_INVALID` hits. O3 records “unprompted policy metadata” but routes “broad **module-evaluation** diagnostics” (`CODEGEN_MODULE_EVALUATION_FAILED`, the Explicit `defineAuth` path). Name `CODEGEN_POLICY_INVALID` and its missing exact page in O3’s intervention.

**m3. N8 is defensible as kit/RNW ownership, but it is the one N-row that the document’s own cheap-prevention test still nicks.**

§Scope: an `agent-error` stays a Snapback item when “a type, diagnostic, template, or **guide sentence** could cheaply have prevented it.” Familiar diary M2 asked for “a renderer-compatibility warning for dropped accessibility values.” Keep N8 out of the product backlog if the owner is the frozen kit, but add one Expo-web semantic sentence to the start packet or say explicitly why that sentence is the wrong owner.

**m4. O13’s “computed `uniqueMany` association” is the O9 dialect again, not a distinct grammar refusal.**

`clique-evidence/sol-snapback-explicit/run-log.md` `1787867160`: “Computed array lookup used to associate uniqueMany media is outside `inline_handler_v1`.” Fold into O9; keep the other O13 items (`minItems`, one-member literal, ambient `Date`, `v.media` in anonymous results, empty-write read-model, structured IDs in arrays).

Cited F-row **commit SHAs** (`21684e9cc`, `a6ab002e0`, `2b1bb1f15`, `0b9d7e9e7`, `f3cde9050`, `8f6c21494`) are **UNVERIFIED (no git access)**. Current file state matching those claimed patches is recorded below.

## OUT-OF-DECLARED-SCOPE (scale tail)

From `clique-evidence/sol-snapback-explicit/run-log.md` after `milestone=scale-replay` (`1787868680`). Not counted against the verdict. Open question 3’s hypothesized set (O10, O18, O23, client retention) is already too small:

1. **`SNAPBACK_SCHEMA_FIELD_RETYPED` on `maxItems` 32→64 even on a fresh pre-replay store** — `1787868970` `attribution=snapback-defect`. Not a scale variant of O13’s `minItems`.
2. **Documented mint-by-email issued an email-code principal distinct from the local-password identity** (`ensureDm` `PROFILE_REQUIRED`) — `1787872045` `attribution=snapback-defect`.
3. **Published ordered mutation runner cannot carry asset-upload references** — `1787872227`; later `1787875448` re-hit the 32 KiB structured-value ceiling on scale data-URIs (O25-class, scale-only).
4. **Replay mapper injected `args.limit` into an exact lookup whose generated contract lacked it** — `1787872016` `attribution=snapback-defect`.
5. **`SNAPBACK_AUTH_THROTTLED` at 16 concurrent password entries** — `1787870680`.
6. **`SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` (global 10,000)** — `1787872963`; Insights/Trending mutation-backed probes then refused by the saturated ledger — `1787875370` `attribution=snapback-defect`.
7. **`SNAPBACK_QUERY_IN_ITEMS_EXCEEDED` then `SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED` on a 501-follow feed** — `1787875220` `attribution=snapback-defect`. Related to O10’s ceiling family, different limits (`maxInItems`/`maxFilterBindings` = 500).
8. **Supervised PTY ~30-minute host session limit closed the owner; mapper then `SNAPBACK_QUERY_OFFLINE_UNAVAILABLE`** — `1787874935` `attribution=environment`.
9. **`SNAPBACK_REPLAY_DEFINITION_INVALID` for pool 512 vs published max 64** — `1787873130`.
10. Agent/environment only: V8 OOM retaining 1000 fake-IndexedDB clients (`1787871690`); lane-local `snapback` binary `ENOENT` under direct `node` (`1787872008`).

## Verified-correct spot checks

- **F1.** Both sol lanes: familiar `1787853028` and explicit `1787854616`/`1787855013` (`SNAPBACK_EXPO_METRO_EXITED` / `.tmp-*` `ENOENT`). Current `packages/snapback-cli/templates/expo-chat/metro.config.js` and `.../media-feed/metro.config.js` block-list `.snapback/generations`. Ticket `issues/20260827-snapback-expo-metro-generations-watcher-crash.md` still Open; F1’s “reconcile still-open ticket metadata” is right. Commits UNVERIFIED (no git access).
- **F1 vs O6 kept separate is right.** O6 is explicit `1787854310` (owner gone during M2 hot reload, no `ENOENT`, no receipt) **before** the first named Metro crash at `1787854616`.
- **F2’s Node/headless event and the current warning/recipe (not the “dominant broad fanout” clause — see M2).** Explicit `1787853600`/`1787853610`. `SNAPBACK_AUTH_STORAGE_PARTITION_IMPLICIT_REUSE` is emitted in `packages/snapback-client/app-client.mjs`; `guide/recipes/multi-persona-clients.md` and `guide/realtime/live-queries.md` “Troubleshoot apparent cross-persona live-update failures” route it. Commits UNVERIFIED (no git access).
- **F3.** Familiar `1787855915` `SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY` on protected live typing; client-side expiry workaround. `guide/recipes/time-windowed-live-reads.md` covers load-pinned clocks, server-authored `createdAt`/`expiresAt`, typing-lease “expiring soon,” range scans, busy-window paging, refresh/re-issue. `guide/realtime/live-queries.md` and `guide/realtime/ephemeral-state.md` route `SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY` / typing lease to that recipe. Ticket `issues/20260825-clock-dependent-visibility-authoring-friction.md` remains Open only for the primitive — matches F3 vs O15. Commits UNVERIFIED (no git access).
- **N1–N7, N9–N17** match the named events and survive the document’s own standard (self-attribution is not final; cheap Snapback prevention → O, not N). Samples: N2 explicit `1787858130` shared placeholder password; N3 `1787855500` / `1787862840` / `1787864720`; N4 `1787858500` count=9 and `1787867750` high-like tie displacement; N5 `1787857700` sampled before React mounted, `1787857570` inactive stack, `1787857800` duplicate bubble; N7 familiar `1787858806` Dave already in starter vs addable-Dave choreography; N12 explicit `1787853025`; N13 `1787852958`; N14 correctly **overrides** `attribution=snapback-defect` at explicit `1787862314` (DevTools sandbox; Metro stayed ready); N15/N16/N17 as written (terra-explicit `run-log.md` time-budget; `.scaffold` at explicit `1787852924`).
- **O rows sampled against evidence:** O1 familiar `1787852581` unscoped `snapback@0.1.29` and explicit `1787853004` expo-router major 7; O2 both sol lanes omitted `--port-range`; O4 `SNAPBACK_SEED_MIGRATION_REQUIRED` explicit `1787853375`; O5 terra-familiar `run-log.md` `2026-08-27T17:53:00Z` no `application-ready`; O7 explicit `1787858700` `SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE`; O8 `1787853410`; O9/O10/O11/O12 as cited; O16 familiar `1787857181` `SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT`; O17 `SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT` explicit `1787866650` plus familiar `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` `1787856776`; O18 familiar replay store/queue/transport IDs `1787854222`–`1787854284`; O19 `1787866840`; O20 `1787859060` and `1787863330`; O21 `1787864800`; O22 terra-explicit essay + N16; O23 `1787867220` 165,844 vs 65,536; O25 both sol 32 KiB data-URIs; O26 explicit `1787854935` `SNAPBACK_CAPABILITY_UNSUPPORTED assets.media-collection.v1` (still experimental on current main; ticket matches); O27/O30 owner-policy bundle `1787854800`–`1787855205`; O28 `1787860035` / `178786141`.
- **Cited tickets exist and match the implied claim**, except O29’s ticket is glm-sourced (M1): `issues/20260827-snapback-expo-metro-generations-watcher-crash.md`, `issues/20260827-live-query-cross-client-fanout-staleness.md`, `issues/20260825-clock-dependent-visibility-authoring-friction.md`, `issues/20260827-media-collection-capability-skew-published-runtime.md`, `issues/20260827-defineauth-successor-silent-refusal.md`.
- **§Proposed proof / §Exit criterion / §Confidence** agree with the tables on F1–F3, O14, O17, O26, and the F1/O6 possible collapse, aside from O29 (M1) and the F2-dominance sentence (M2). No synthesis bundle names a nonexistent row.

VERDICT: NOT READY

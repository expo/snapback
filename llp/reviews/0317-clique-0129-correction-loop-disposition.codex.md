# LLP 0317 — codex gpt-5.6-sol review artifact

Provenance is recorded per review. Bodies are verbatim as received; nothing
is summarized, reconstructed, or edited.

## Round 1 — 2026-08-28, verification lens

- **Reviewer:** codex CLI 0.150.1, `gpt-5.6-sol` @ **ultra** (effort confirmed
  in the run header), `--sandbox read-only`, `--cd <capsule>`. Git history
  readable, so the commit claims were verified directly.
- **Revision reviewed:** LLP 0317 `Draft` as authored 2026-08-27, sha256
  `5d7682d171827312d1e820f161a42b39a6a42a4c0dea2f765e2a9ffd90d9d732`.
- **Capsule:** worktree at `origin/main` `f977fa589` + the target +
  `clique-evidence/` (four Snapback lanes plus two comparison lanes).
  Structural blindness: no `llp/reviews/0317*` artifact existed in the capsule.
- **Instruction hash (sha256/16):** `c14f2ec71754f484` (7,588 bytes); shared
  brief `e7959acac7eff81c`.
- **Launched** 2026-08-28T00:22:05Z; **returned** 2026-08-28T00:37:43Z,
  exit 0, complete review, 316,930 tokens. Sealed until the grok artifact
  landed; both were written before either was read for revision.
- **Verdict:** **NOT READY** (6 MATERIAL, 3 non-blocking, 10
  out-of-declared-scope scale-tail items).
- **Transcript note:** `codex exec` prints the final review twice — once as
  the agent message, once in the run summary. The body below is the second,
  complete copy, byte-for-byte.

### Verbatim review

## MATERIAL findings

M1. **F2 does not establish shared auth custody as the dominant cause of the broad fanout report, and it misstates what the cited commits added.** Sol Explicit corrected implicit partition reuse during M1 (`1787853600/1787853610`) before its later M4 reaction-subscription failure (`1787860576/1787861040`); Sol Familiar’s broad failure was recorded by `manual-playwright`, not a shared Node-persona fixture (`1787857038/1787857472`). [Sol Explicit evidence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:45), [Sol Familiar evidence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-familiar/run-log.md:112). Moreover, `SNAPBACK_AUTH_STORAGE_PARTITION_IMPLICIT_REUSE` and the multi-persona recipe originated in `94e1c1fff`/`144e4c9cf`; `a6ab002e0` and `2b1bb1f15` only retarget and qualify the existing warning/guide text. The ticket itself still requires the clean two-partition repro before choosing between hypotheses. [Current implementation](/Users/ccheever/lanes/llp0317/packages/snapback-client/app-client.mjs:1161), [ticket verification plan](/Users/ccheever/lanes/llp0317/issues/20260827-live-query-cross-client-fanout-staleness.md:99). Narrow F2 to the earlier implicit-partition correction and its improved symptom routing; keep the broad Familiar fanout report open/backlogged unless a causal repro proves otherwise, and lower the stated confidence.

M2. **O29 is outside the declared four-lane evidence base and is therefore unsupported in this inventory.** No supplied sol/terra Snapback record mentions `defineAuth.minimumLength`; the cited ticket explicitly names `glm-snapback-explicit` as its source and quotes that excluded lane. [Ticket source](/Users/ccheever/lanes/llp0317/issues/20260827-defineauth-successor-silent-refusal.md:6). Remove O29, or explicitly expand the research scope and import/trace the GLM evidence before retaining it.

M3. **O10’s diagnosis and proposed ban on dynamic `take` conflict with current source and with F3’s cited busy-window recipe.** The lane attributed one empty history page to `.take(limit)` and repaired it with fixed `take(100)` plus slicing (`1787864590`). [Lane event](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:182). But current types deliberately expose `take(limit: number)`, codegen admits nonliteral bounds, and commit `8f6c21494` added a guide example using `.take(args.limit)`. [Type](/Users/ccheever/lanes/llp0317/packages/snapback-codegen/ctx.d.mts:123), [admission logic](/Users/ccheever/lanes/llp0317/packages/snapback-codegen/inline-handlers.mjs:250), [guide example](/Users/ccheever/lanes/llp0317/guide/recipes/time-windowed-live-reads.md:120). Reproduce the lane’s empty projection through the real runtime. If dynamic `take` is broken, fix the cited guide and qualify F3; if it works, correct O10’s root cause and do not recommend removing a supported API shape.

M4. **O12 prescribes a type change already present on current main, so its root cause is not established.** The lane records a narrowing problem at `1787853979`/`1787856034`, but `QueryContext.refuse` already returns `never`, introduced by `dd4126140f` on 2026-08-08, and Familiar contexts inherit that generated context. [Lane evidence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-familiar/run-log.md:54), [current type](/Users/ccheever/lanes/llp0317/packages/snapback-codegen/ctx.d.mts:300), [Familiar type derivation](/Users/ccheever/lanes/llp0317/packages/snapback-codegen/index.mjs:18787). Replace the proposed “type as `never`” fix with a minimal pinned-declaration reproduction that identifies whether the defect is generated-type skew, a helper-return widening, or the lane’s particular control-flow shape.

M5. **N5 incorrectly folds an ambiguous durable-auth reload event into ordinary deep-link/locator mistakes.** The first failure was indeed an invalid expectation that login preserve the original deep link (`1787857240`), but the next distinct event says a full navigation after successful credential adoption returned to the auth surface while client-side routing retained the session (`1787857420`). The workaround avoided full reload and did not diagnose why durable authentication disappeared. [Two successive events](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:99). Split the latter into the prevention backlog for focused reload-after-sign-in reproduction, unless evidence can conclusively assign it to application or harness timing.

M6. **At least two non-scale correction causes are absent from the inventory.** Sol Familiar recorded an explicit correction loop because the lane packet requested `_generated/` while the published guide refused that alias and required `snapback/generated` (`1787853002`), and a separate M1 failure because the UI showed a generic refusal instead of projecting `HANDLE_TAKEN`, repaired with `projectAppRefusal` (`1787853539`). [Generated-path conflict](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-familiar/run-log.md:28), [refusal-projection loop](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-familiar/run-log.md:39). Fold the first explicitly into N1 or a benchmark-contract row; disposition the second explicitly as an ordinary app mistake or a template/guide prevention item.

## Non-blocking findings

m1. **F3’s closure column says its heavier primitive question is “listed in O15,” but O15 concerns causal subscription diagnostics, not time-window primitives.** The primitive remains in the clock ticket. [F3/O15 text](/Users/ccheever/lanes/llp0317/llp/0317-clique-0129-correction-loop-disposition.research.md:101), [ticket’s open primitive](/Users/ccheever/lanes/llp0317/issues/shelved/20260825-clock-dependent-visibility-authoring-friction.md:63). Correct the cross-reference or add a distinct backlog row.

m2. **O6 is the only O-row omitted from all five priority bundles.** Either place it in template/lifecycle closure or explicitly state that it remains unbundled pending comparison with F1. [O6](/Users/ccheever/lanes/llp0317/llp/0317-clique-0129-correction-loop-disposition.research.md:158), [priority synthesis](/Users/ccheever/lanes/llp0317/llp/0317-clique-0129-correction-loop-disposition.research.md:209).

m3. **Exit criterion 1 appears already satisfied at this snapshot.** Commits `77b621623` and `44fcd1263` imported the matrix diaries/run logs under `benchmarks/runs/2026-08-27-clique-published-0129-matrix/`; the record names that retained corpus. [Matrix record](/Users/ccheever/lanes/llp0317/benchmarks/runs/2026-08-27-clique-published-0129-matrix/record.md:10). Mark the criterion satisfied or clarify which artifact remains absent.

## OUT-OF-DECLARED-SCOPE (scale tail)

- The generator initially targeted the read-only authoritative instrument path instead of lane-owned output (`1787868720`). [Evidence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:236)
- The scale envelope required larger group/chat projection bounds and replay-specific push separation (`1787868890`). [Evidence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:240)
- Raising an array’s `maxItems` from 32 to 64 was refused as `SNAPBACK_SCHEMA_FIELD_RETYPED` even on the fresh pre-replay store, requiring a V2 field (`1787868970`). [Evidence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:241)
- The bespoke thousand-persona replay path successively hit 2.7-GB IndexedDB-client retention, eviction stalls, password-hash throughput, auth throttling, and a 4.08-GB V8 OOM before the lane found the first-party ordered-replay guide (`1787869460`–`1787871690`). [Evidence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:242)
- The first-party replay path exposed a package-bin resolution error and then injected `args.limit` into exact lookups whose generated contracts lacked it (`1787872008/1787872016`). [Evidence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:253)
- Replay mint-by-email created a different principal from the existing password identity, causing `PROFILE_REQUIRED` and requiring a replay-only identity bridge (`1787872045`). [Evidence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:255)
- The published ordered mutation runner could not carry asset-upload references, forcing scale-only media records (`1787872227`). [Evidence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:258)
- Lost predecessor ACK custody saturated the 10,000-record durable mutation ledger; the same saturation later refused mutation-backed Insights/Trending probes (`1787872963/1787875370`). [Evidence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:259)
- The scale feed crossed `maxInItems=500` and `maxFilterBindings=500`, requiring 499-ID chunks (`1787875220`). [Evidence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:267)
- The supervised owner closed at the host PTY’s roughly 30-minute session limit, yielding `SNAPBACK_QUERY_OFFLINE_UNAVAILABLE` until restart (`1787874935`). [Evidence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:264)

## Verified-correct spot checks

- **F1 is sound as “plausibly fixed.”** Both sol lanes record the same `.snapback/generations/.tmp-*` Metro race, and `21684e9cc` installs the same block-list workaround in both maintained web templates. [Explicit event](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:64), [Familiar event](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-familiar/run-log.md:29), [template fix](/Users/ccheever/lanes/llp0317/packages/snapback-cli/templates/expo-chat/metro.config.js:10)

- **F3’s core clock/lease guide closure is real**, apart from the O10 busy-page conflict above. Sol Familiar records `SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY` and client-side expiry projection; the current live-query and ephemeral pages route the exact vocabulary to the tested recipe. [Lane event](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-familiar/run-log.md:94), [live-query route](/Users/ccheever/lanes/llp0317/guide/realtime/live-queries.md:60), [typing route](/Users/ccheever/lanes/llp0317/guide/realtime/ephemeral-state.md:32)

- **N1–N4, N6–N17 are supported and correctly disposed.** Representative exact records include invalid `.scaffold`, refused recursive deletion, and read-only kit packaging (`1787852924/2958/3025`); the shared-password invocation (`1787858130`); wrapper/display-name/DM-ID test bugs (`1787855500`, `1787864720`, `1787862840`); and the Dave contradiction (`1787858806`). [Explicit records](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:13), [Familiar contradiction](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-familiar/run-log.md:133)

- **Keeping O6 separate from F1 is appropriately cautious.** The unexplained owner loss at `1787854310` has no terminal cause, whereas the later `1787854616` event explicitly names Metro’s temp-directory `ENOENT`; the evidence cannot yet collapse them. [Comparison](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:60)

- **O14 is accurately narrow and well evidenced.** A committed reaction row was visible to fresh headless reads, while both the encompassing JS query and a dedicated declarative subscription failed to emit insert/patch updates (`1787860576/1787861040`). [Evidence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:145)

- **O20, O21, O23, and O24 trace correctly.** The lane records abandoned Remove/disappearance mutations across navigation (`1787859060/1787863330`), offline query blanking that removed the composer (`1787864800`), the 165,844-byte result against a 65,536-byte cap (`1787867220`), and the same-account optimistic/receipt/retry convergence sequence (`1787867960`–`1787868550`). [Navigation event](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:125), [M8 sequence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:223)

- **O25–O28 and O30 are supported.** The explicit lane records the base64 ceiling, media-collection runtime capability refusal, owner-policy cascade/cross-author read break, and split media-readiness problem at `1787854711`–`1787860050`; the Familiar lane independently corroborates the base64 ceiling. [Explicit media sequence](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-explicit/run-log.md:66), [Familiar corroboration](/Users/ccheever/lanes/llp0317/clique-evidence/sol-snapback-familiar/run-log.md:63)

- **All five Related tickets exist.** The clock, Metro, fanout, and media tickets describe the corresponding observations; the defineAuth ticket exists but has the out-of-scope provenance identified in M2.

VERDICT: NOT READY

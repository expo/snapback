# Snapback 4 Clique — Astra-medium calibration on 0.2.24 (2026-09-16)

The eighth Astra-medium calibration of the LLP 3000.007 program, on `snapback4@0.2.24` / `snapback4-expo@0.2.15` (wave 8, §20.17). Packet `~/clique-sb4-20260916-astra-cal8`; ports 49360–49379; builder `gpt-6-astra` medium; independent grade by a fresh Claude Opus 5 session; holistic score by `gpt-6-astra` xhigh. N=1.

## Result

- **Builder.** Seven web-green milestones in 4,238 s, with no confirmed backend defect.
- **Grade.** 85 pass, **0 fail**, 16 not run. O1 75, O2 **75** (0.2.23: 72), O4 45, O5 75.
- **Holistic.** 88 (0.2.23: 88).

| Category | 0.2.21 | 0.2.22 | 0.2.23 | 0.2.24 |
| --- | ---: | ---: | ---: | ---: |
| overall | 88 | 91 | 88 | 88 |
| setup_and_docs | 90 | 90 | 92 | 90 |
| data_modeling | 88 | 89 | 85 | 88 |
| authorization | 91 | 96 | 95 | 95 |
| queries_and_live | 84 | 91 | 82 | 78 |
| writes_and_transactions | 92 | 94 | 91 | 95 |
| offline_sync | 90 | 94 | 91 | 93 |
| media_assets | 97 | 97 | 96 | 96 |
| background_work | 95 | 94 | 92 | 92 |
| client_integration | 89 | 90 | 87 | 88 |
| diagnostics_dev_loop | 93 | 90 | 92 | 94 |
| scale_and_limits | 85 | 84 | 79 | 80 |
| operations | 88 | 89 | 83 | 86 |

## What the friction review establishes

**No wave-8 regression.** Wave 8 changed no ceiling, ordering, cursor, grace or delivery rule; the only wave-8 change on a hot path is the default dev meter, measured below noise.

**Wave 8 was adopted and paid:**
- `query … held:` was used twice. M5 wall fell 827 → 609 s, and `N_NEVER_COMPLETE` appears in no check: the 0.2.23 run's major defect now fails at compile time.
- Sized recipe caps were used (`authors=1100`), and the recipe was never hand-patched; the 0.2.23 lane patched four lines.
- The dev clock closed the 0.2.23 run's d-05: M6 wall fell 678 → 356 s.

**Three wave-8 surfaces went unused** because the builder never opened `guide reads`: `Read.cut` (zero occurrences), the default dev meter, and `doctor`.

**d-01 (major) is not Snapback and not presence.** The typing path contains no presence read. An A/B of the same frozen check gives 4,307/4,314/4,326 ms on 0.2.24 against 4,310/4,312/4,311 ms on 0.2.23; server-side removal is 4,024–4,027 ms against a 4,000 ms TTL. The cause is the app's 4 s TTL against the harness's 5 s ceiling, 45 unthrottled `chat.type` mutations per check, and an ignored local `expiresAt`. The grader's own 18 measurements of the same app are all inside the bound.

**queries_and_live 82 → 78.** Three of the scorer's four clauses trace to `search.all`, a 1,000-lane merge the builder wrote, kept, and disclosed, which nothing in the app references. The fourth is the paved `held:` form read as a limitation: the card gives its costs and refusals but never states that a held query over horizon-free sources is complete by construction, which is true and provable for this app.

**Defects.** d-01 app plus harness; d-02 app (a file input never reset); d-03 the lane's own `API.md` overclaiming against Snapback's deliberate non-disclosure contract; d-04 app; d-05 app, but Snapback-shaped and a verbatim recurrence.

Files: `astra/FINAL.md`, `astra/grader-report.json`, the lane's final report, essay and diary, `friction-review.md`, `packet-README.md`, `PACKAGE_PINS.json`.

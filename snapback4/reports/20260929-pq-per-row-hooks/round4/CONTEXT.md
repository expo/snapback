# PQ round 4 context

Applied `llp-orient` before editing local remembered answers, observation queue
transitions and publication regressions. Read rounds 0–3 prompts/reports, the
Snapback 4 fence, root/design brief, journal, current client/reads cards and
Astra's complete round-3 review. Grok was progress-only at startup.

Governing documents: LLP 3000 §4 (independent Snapback 4 checks), LLP 2000.000
§7 (partition authority), LLP 3000.016 §2.2 (local publication), LLP 3000.019
§3.3 (row and held deadlines), LLP 3000.023 §§3.1–3.6 and 7 (observation
ownership, retention and scheduling), and LLP 3000.029 §0 (LV remains shelved).
The foundation/current survey is scoped to that fence; Snapback 1–3 runtime
bootstraps and inventories do not apply.

Active constraints: the round-4 user instruction changes a new bounded
queued episode's start to attempt execution. Revalidation and `keep: false`
withdrawal still notify before queueing. Already-started episode timestamps,
row deadlines, resets, callback reset checks, cancellation, lifetime and FIFO
bounds stay exact. Known footprints preserve disjoint remembered dependencies;
unknown footprints and scope resets clear all remembered answers. No LV
subsystem, contract, Rust runtime, meter, size cap or new gate is introduced.

Updated the existing LLP 3000.023 and client card. No new LLP or skill hand-off.
Lane RL has not landed at the pre-qualification merge of origin/main f9620c815;
that merge adds BP's report and preserves both journal entries. The final
report records the last main/review check separately.

Final integration includes MT through 29db70739 and the calibration record
through 17f06ef0c. Neither changes this round's runtime inputs. Grok's full
review was read and its sweep/sign-out findings were fixed; the report records
the remaining non-blocking observations explicitly. RL has not landed.

The last pre-commit fetch also brought scheduled ticket records at 7f540f094;
merged through b5803c3d7 without changing any runtime or affected test input.

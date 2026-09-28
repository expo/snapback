# LV round 4 — ephemeral dependency evidence

Branch `sb4-intent/lv-hook-retention`, base `f32f75e37365339269ecbe609a2211440ce14830`.
Work ran September 28–29, 2026. Read the rounds 0–3 prompts, reports and journal,
LLP 3000.029, and Astra's complete round-3 review. `git fetch origin` left
`origin/main` at `9ef49d43cb713dfd5c80e0a50ce05164bc0b331d`; no merge was needed.
No push or publication. The complete landing suite belongs to the supervisor;
**`scripts/test.sh` was not run**.

## Implementation and governing context

Applied `llp-orient` to the client observation/publication subsystem. The active
constraints are LLP 3000 §4 (the Snapback 4 fence), LLP 3000.017 §3.3
(incarnation revisions, dependency interests and poll coverage), LLP 3000.023
§3.4 (hard withdrawals), and LLP 3000.029 §§8–10 (dependency fences, complete
footprints and now ephemeral epochs). LLP 3000.029 is implemented and archived,
not a new working-set proposal. The client/reads/ephemeral guide cards are the
current authoring surface. No unresolved reference or new authority assumption
was introduced; the affected-scope doc audit updates the existing LLP and
ephemeral guide/manual wording. No skill hand-off is needed.

Ephemeral evidence now raises persistent table epoch floors within its server
incarnation. Compiled ephemeral dependencies travel with requests, including
direct reads without an observation. Accepted whole replies and change polls
withdraw older overlapping owners before callbacks, including the accepting
owner's older answer. A retired accepting fetch reruns through its existing
refresh path. Unknown dependencies conservatively cover all ephemeral inputs;
known unrelated tables remain independent. Floors survive owner removal.

Both clients reject older replies against those floors. The local client
additionally rechecks at final publication after asynchronous evaluation, so an
accepted candidate cannot escape evidence received during its continuation.
Durable cut equality and replica application cannot release an ephemeral floor.
Incarnation adoption still retires older request revisions before inspecting
their replies. Query evidence does not advance the change-poll coverage cursor.
Withheld/transport responses do not advance answer epochs. Existing credential,
generation, store, deadline and durable-cut checks remain in place.

Local ephemeral data now participates in matching-key reconciliation without
being cached as replica data. This also fixes a recovery race between watches
with different retention policies. A dependency index keeps propagation scoped:
**400 independent replacements visit 400 owners**; repeated same-epoch replies
visit none. The durable ReadIndex remains independent of this clock.

LLP 3000.029 §10 records the rule and disclosure induction, with a Revised line.
The ephemeral guide and operations manual no longer say that retention can
bridge received revocation. No authorization rule, meter, wire contract,
dependency, runtime Rust code or byte budget changes.

## Findings and counterfactual evidence

| Finding | Evidence |
| --- | --- |
| Astra High: overlapping owners and buffered aliases at `{seq:0, epoch:1→2}` | Six real HTTP regressions on online/process/wasm hold changes and refresh, buffer an alias, delete a secret, then receive authoritative null. Both packets explicitly assert the same durable cut and complete `secrets` footprint. The unmodified round-3 client fails all six. Final cases verify grouped withdrawal, stale-reply rejection and recovery. |
| Final asynchronous publication gap | Two additional process/wasm regressions deliver real server epoch-2 evidence in a microtask after epoch-1 evaluation acceptance. Reverting only the last publication check discloses the old secret and fails both. |
| Astra Low: row-key derivation absent from census | Both `row-keyed-view.q` and `row-view-inherited-member.q` run through the independent compiled-schema oracle, compiler certificate, server and device. HTTP tests cover process and wasm, including SDK metadata. Removing only `maintain.row_key.table` fails both Rust cases: `unreadFor` loses `members`; `countFor` loses `members` and `rooms`. |
| Property model lacks epochs | Forty independent seeds generate 250 events each: row revocation/regrant, aliases and overlapping dependencies, different retention policies, ownerless requests, response and publication queues, polls, remounts, durable sequence advancement and incarnation replacement. The oracle owns server history and learned revocations, not production floors. The previous durable model remains. |

All five JavaScript counterfactuals are killed by assertions. Removing query
evidence fails **21/40** generated histories; removing dependency floors fails
**12/40** histories and all **3/3** delayed direct-read host cases; removing poll
floors fails the ownerless-change test; removing the final publication check
fails both process/wasm cases. See [runner](./mutations.mjs),
[first four results](./mutations.json), [publication result](./mutations-final-publication.json)
and [row-key mutation](./mutant-row-key.json). Mutation copies of the JS client
were isolated under ignored `target/`. The Rust edge was removed only during
its recorded test and restored in a `finally` block; the complete five-case
census passed again afterward.

## Verification

| Final check | Result |
| --- | --- |
| Broad affected client run: ephemeral, retention, aliases, models, both browser routes, presence, expiry, pages, client seams and delivery fault matrix | **1,264 pass / 0 fail / 0 cancelled / 0 skipped**, 433 s. [Exact command](./affected-command.json), [log](./affected.log.gz). |
| New final-publication continuation cases | **2/2**, [log](./publication-gap.log.gz). |
| Final accepting-owner callback assertion and dependency-index cost | **2/2**, [log](./ephemeral-source-cost.log.gz). |
| Independent durable and ephemeral models | **83/83**, also included in the broad run. [Log](./model-first.log.gz). |
| Whole guide, `cargo test -p snapback4-lang --test guide` | **98/98**, [log](./guide.log.gz). |
| Rust footprint census, after restoring the row-key mutant | **5/5**, [log](./rust-census-final.log.gz). |
| HTTP/process/wasm footprint and profile regressions | **18/18**, also included in the broad run. [Log](./footprint.log.gz). |
| Client build and declarations; package typecheck | Pass, [build](./client-build-final.log.gz), [typecheck](./typecheck.log.gz). |
| Docs budget; references; whitespace | README **300/300**; reference audit and `git diff --check` pass. [Docs](./docs-budget.log.gz), [references](./ref-check-final.log.gz). |

The broad run began with product semantics frozen. Two final-publication tests
and a cost/source-owner assertion were added afterward and run separately;
the only subsequent production-source edit is the explanatory ReadIndex comment.
Counts in overlapping scopes must not be added. Every captured red is listed
in [FAILURES.md](./FAILURES.md) and [failures.json](./failures.json). No final
full-suite success is claimed, and no new Expo/iOS UI qualification is claimed.
All unexpected reds are ours and resolved. The original six disclosure failures
and mutation failures are retained as expected counterfactuals, not baseline
exemptions. No known failing affected test remains.

Grok was checked at the start, during work and again before completion. At the
final check its file still contained progress notes (including its plan to
inspect row-keyed and other footprints), with no findings or verdict to fold
in. This round does not claim Grok approval and did not wait for it.

## Wasm and custody

Measured the existing canonical round-3 artifact: **2,042,203 B raw /
593,640 B GNU file-input gzip-9**, SHA-256
`ac18ec094d1c596bda96caa164870f25192a1463397f5bd97f57e436338fe0bc`.
It is byte-identical to round 3: **zero growth**, **79 B** below the unchanged
**593,719 B** cap. No new wasm build is claimed; this round changes no runtime
Rust source. [Measurement](./wasm-measurement.json).

Prompt/review and final product-source digests are in [inputs.json](./inputs.json)
and [qualified-sources.json](./qualified-sources.json). No shared tool install,
push, deployment or publication. Generated client files and wasm remain ignored.
The local commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

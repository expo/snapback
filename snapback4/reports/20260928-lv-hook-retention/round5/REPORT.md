# LV round 5 — fence ephemeral replies before discovery

Branch `sb4-intent/lv-hook-retention`, base `a595e5da6edc0c987cc381cf26155341a2a96550`.
Read the rounds 0–4 prompts, reports and journal entries, LLP 3000.029, and the
complete Astra round-4 review. Fetch observed `origin/main` at
`dc21eb085fb7bdfbc7ea244b6d1b0ec8c8d8a073`; no merge was performed. No push or
publication. **`scripts/test.sh` was not run**; the supervisor owns landing qualification.

## Change and governing context

Applied `llp-orient`: LLP 3000 §4 supplies the Snapback 4 fence; LLP 3000.029
§§8–10 govern dependency authority, complete footprints, and ephemeral clocks.
LLP 3000.029 is Implemented and archived. The client, reads and ephemeral guide
cards describe the current surface. This round clarifies §10 and its Revised
line; it introduces no new user-facing option, authority rule or meter allowance.
No new LLP or skill hand-off is needed.

Every online query now captures an incarnation revision before dispatch,
including queries without an `ephemeralReads` hint and direct-only clients that
never discover schema. Wire-provided epochs pass the same acceptance and final
publication checks. Until ephemeral-specific dependencies are known, the returned
complete table footprint scopes the fence and observation interest, conservatively
including durable inputs. Matching peers receiving their first answer solely
from a direct read are registered too. Unknown wire footprints cover every table,
meet every floor, and omit the change poll's table filter.

The audit found the same missing-metadata assumption in schema-backed routing.
Online/process/wasm now derive ephemeral inputs from the complete read certificate
and schema table declarations when `ephemeralReads` is absent; absent certificates
conservatively cover every ephemeral table. Local routing, observation interests,
reply fencing and the prohibition on caching ephemeral data use that same result.
Explicit empty certificates retain their meaning. No Rust or wasm source changed.

The floor-lifetime regression removes **all three owners**, delivers the buffered
old reply with no owners remaining, rejects a stale remount, and accepts a current
remount. The existing implementation already preserves floors; this finding
required a stronger test rather than a product change.

## Counterfactual evidence

The seven new real HTTP cases fail on round 4: two pre-discovery cases holding
schema/changes/refresh, one direct-only case with zero schema requests, and four
process/wasm cases with ephemeral operation metadata omitted. All assert real
`seq=0`, epochs 1→2, withdrawal/rejection and recovery. [Before log](./before.log.gz).
The three-host final-continuation test now includes online direct-only reads.
Additional tests cover unknown footprints and a peer populated only by a matching
direct read.

All **seven isolated mutations** fail their intended disclosure assertions:
request capture, source registration, matching-peer registration, metadata fallback,
unknown-owner coverage, unknown-floor coverage, and clearing floors after the last
owner closes. None fails on a syntax/import error or timeout. See
[results](./mutations.json), [runner](./mutations.mjs), and
[output](./mutations-qualified.log.gz). Product files were unchanged during these runs.

## Verification and failures

- Broad affected client suite: **1,277 pass / 0 fail / 0 cancelled / 0 skipped**, 434 s. [Command](./affected-command.json),
  [log](./affected.log.gz). It includes all new cases, durable and ephemeral history
  models, both browser route witnesses, dependency/cost regressions, authority,
  expiry, presence, pages, client seams and the delivery fault matrix.
- Whole guide: **98/98**. `cargo test -p snapback4-lang --test guide`,
  [log](./guide.log.gz).
- Client build/declarations and typecheck pass. [Build](./build.log.gz),
  [typecheck](./typecheck.log.gz).
- Reference audit: **523 LLPs, 9,878 refs, zero errors or unchecked references**.
  [Log](./ref-check-final.log.gz). `git diff --check` passes. `local.ts` remains 1,488 lines.

One intermediate focused run was **20/21**: the process missing-metadata withdrawal
case timed out waiting for its initial watches, before the tested revocation.
The unchanged product then passed the isolated two-case rerun, 12 further repetitions
(24 cases), the 23-case focused run, and the final broad run. Its cause is unconfirmed; it remains
classified **ours**, without a baseline or environmental exemption. The additional
peer regression passed separately and is included in the broad run. Counts overlap
and must not be added. [Complete failure accounting](./FAILURES.md) records this
red, the expected pre-fix/mutation reds, and setup errors.

Grok's completed round-3 review is READY with the row-key census Low already fixed
in round 4. No round-4 Grok review file was present at the final check. No new review
approval or Expo/iOS UI qualification is claimed. The final product/test source
digests are in [qualified-sources.json](./qualified-sources.json).

## Wasm and custody

Existing canonical wasm: **2,042,203 B raw / 593,640 B GNU file-input gzip-9**,
SHA-256 `ac18ec094d1c596bda96caa164870f25192a1463397f5bd97f57e436338fe0bc`.
**Zero growth; 79 B below the unchanged 593,719 B cap.** No new wasm build is claimed.
[Measurement](./wasm-measurement.json), [input digests](./inputs.json).

No tool installation, push, deployment or publication. Generated files stay ignored.
The local commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

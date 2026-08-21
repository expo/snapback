# Run record — Clique local-main GPT-5.6 Sol high

**Status: CALIBRATION — unpublished current-source evidence, not
claim-eligible.** Both requested profiles completed M1–M3 green.

## Results

| Lane | Outcome | Wall | Output tokens | Correction/retry events |
|---|---|---:|---:|---:|
| sol-high-clique-explicit | M1–M3 green | 4,055s (1:07:35) | 123,561 | 18 correction loops + 4 recorded workarounds |
| sol-high-clique-familiar | M1–M3 green | 6,108s (1:41:48) | 151,212 | 46 retries/workarounds/corrections |

Both lanes passed 36/36 suite-required assertions (M1 7, M2 22, M3 7),
12/12 implemented required two-client checks, the optional quote check, and
three iOS Hermes exports. The same frozen instrument left two M2 media-driver
checks and four M3 semantic-driver checks optional/unimplemented in each lane;
the lanes recorded those skips rather than turning them into claims.

Raw Codex usage:

| Lane | Input tokens (cumulative) | Cached input | Output | Reasoning output |
|---|---:|---:|---:|---:|
| Explicit | 44,668,618 | 43,996,416 | 123,561 | 29,988 |
| Familiar | 60,785,737 | 59,857,408 | 151,212 | 37,693 |

## Milestone wall to first green

| Lane | M1 | M2 | M3 |
|---|---:|---:|---:|
| Explicit | 2,121s | 1,032s | 595s |
| Familiar | 1,112s | 2,606s | 1,433s |

Explicit paid most of its cost in M1 carrier/custody setup and then moved
quickly. Familiar reached M1 faster but spent substantially more time in M2
subscription/projection corrections and M3 membership-authority modeling.

## Live evidence

- Explicit profile edits were visible in roughly 132–136ms; Familiar in
  185–354ms.
- Explicit M3 DM delivery passed at 838ms, 1,437ms, and 986ms. Familiar passed
  at 825ms, 840ms, and 821ms.
- Explicit typing had one passing retained trial at 1,702ms visible; Familiar
  passed all three at 1,669–1,694ms visible and withdrew in 3,326–3,343ms.
- Familiar M2 stabilized only after six independent live reads were replaced
  by one bounded relational singleton projection. Its final live-post trials
  passed at 1,356–1,365ms.

## Findings

1. **Familiar Guide/code drift is confirmed.** The Familiar page promises
   direct nullable-document and closed-object query results, while current
   lowering explicitly refuses the nullable point-query spelling and runtime
   generation rejects value-result live queries. The same page demonstrates
   membership `resourceField: "_id"`, but the generated TypeScript surface
   excludes `_id` there. Evidence was added to the existing
   `issues/20260820-guide-gap-familiar-handler-dialect.md` and
   `issues/20260820-guide-gap-membership-roster-projection-recipe.md` tickets.
2. **Six ordinary Familiar live subscriptions produced a probable client/live
   stability issue.** Under repeated two-client trials, mutations entered
   `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`, own-post projection exceeded 15s,
   and independent result sets disagreed. A single live state query removed
   the contention and stabilized all trials. This needs a minimized repro;
   filed as `issues/20260820-familiar-live-subscription-contention.md`.
3. **The fixed-origin Expo development path is still expensive.** Explicit
   `snapback dev --expo` treated its expected dynamic Metro listener as an
   incomplete enumeration and tore down a working fixed-port pair; Familiar
   required the same managed-runtime port wrapper plus a separate Expo server.
   This adds evidence to the existing fixed-origin Guide ticket.
4. **Auth custody and mutation identity remain sharp edges.** Multiple headless
   personas require explicit `storagePartition`; stable fixture identity must
   not be reused as `clientMutationId` across successor auth contexts. The
   refusals were correct, but discovering the intended pattern consumed loops.
5. **Write-posture migration noise is large.** Final generation emitted 19
   migration-pending advisories in Explicit and 17 in Familiar, obscuring the
   useful summary. The existing LLP 0264 closure ticket already owns this.
6. **Familiar capability escapes are poorly signposted.** Ephemeral typing and
   private membership are buildable, but the Familiar entrypoint does not
   export the ephemeral constructor and the useful bootstrap/transition path
   required hopping among three Guide/type surfaces.
7. **The debug binary really grew.** Current `target/debug/snapback` is
   488,991,560 bytes. A repository ticket from 2026-08-11 records a 338 MB
   debug binary, making the current artifact about 151 MB / 45% larger than
   that nearest written comparison. The current Mach-O has about 278 MB of
   `__LINKEDIT`, a 164 MB string table, and 3.17 million symbols. Filed as
   `issues/20260820-debug-binary-symbol-bloat.md`.

## Interpretation

The current unpublished source is benchmark-completable in both profiles and
the hard realtime paths are green. Explicit was the more efficient lane in
this sample; Familiar was pleasant for ordinary functions but lost its
ergonomic advantage when the app crossed into live projection composition,
membership authority, and ephemeral state. The strongest release feedback is
not a missing capability—it is that the intended path through existing
capabilities is fragmented, and one six-subscription case may be a real
runtime/client defect rather than documentation alone.

For a weak directional comparison only, the published 0.1.24 xhigh lanes were
3,720s Explicit and 4,748s Familiar. This high-effort current-source run was
4,055s and 6,108s respectively. Effort, source, machine state, and setup differ,
so the deltas are observations, not regressions.

## Setup deviations and non-findings

- The exact 489 MB source binary passed bootstrap launch and restricted
  handler-VM qualification and has a digest-bound readiness receipt. The
  Familiar lane's later `snapback verify` selected the fixed-port wrapper as if
  it were the runtime binary, so its runtime-readiness stage refused the
  wrapper. That is a benchmark integration limitation, not evidence that the
  qualified Snapback binary failed readiness.
- The local package-preparation step initially omitted the CLI package required
  by the template's verifier config, and the manually packed codegen tarball
  omitted prepack-produced schema files. Both are orchestrator setup defects;
  neither is counted as a Snapback product finding.
- The shell login path exposed Bun 1.3.14 ahead of the supplied 1.3.12 binary.
  Familiar used the exact binary explicitly after discovery; no Snapback
  dependency was replaced from npm.
- Repository inventory verification must use the declared Node 24 engine. It
  passed under Node 24.18.0; a first accidental Node 22 invocation produced
  CommonJS symbol-parity errors and was discarded.

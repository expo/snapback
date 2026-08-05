# Charlie review required: post-ffee324ec client bundle closure growth

**Date:** 2026-08-04
**Status:** Open — Charlie size review required
**Area:** `@expo/snapback-client`, client bundle metrology
**Governing:** LLP 0063, LLP 0145, LLP 0155, LLP 0157, LLP 0166

## Review required

The Move-3 M1–M4, `single_table_v1`, and client-lifecycle landings intentionally
changed these closures after `ffee324ec`. The missing IR-evaluator supplemental
baseline made the gate fail fast before it could adjudicate the rest. The
declared `move3-single-table-lifecycle.v1` workload rollover restores the
ratchet without rewriting any predecessor receipt.

**This rollover records the observed growth; it does not bless it. Charlie must
review the size changes below and decide whether follow-up reductions or a
different public-surface shape are required.** In particular, the roughly
149 kB minified / 41 kB gzip root-family growth and roughly 136 kB minified /
38 kB gzip compatibility-surface growth deserve explicit attribution review.

The table is sorted worst-first by gzip delta. Values are bytes in
`minified / gzip / Brotli` order. Of the 25 predecessor-backed closures, 24
grew and `public-subpath-agent-authority` became smaller.

| Profile | Before | After | Delta |
|---|---:|---:|---:|
| `micro-root-negative` | 406,382 / 112,790 / 93,458 | 555,615 / 153,664 / 125,150 | +149,233 / +40,874 / +31,692 |
| `push-registry-root-negative` | 406,838 / 112,903 / 93,566 | 556,071 / 153,742 / 125,304 | +149,233 / +40,839 / +31,738 |
| `public-subpath-root` | 406,220 / 112,711 / 93,420 | 555,453 / 153,529 / 124,989 | +149,233 / +40,818 / +31,569 |
| `full-public-surface` | 406,220 / 112,707 / 93,368 | 555,453 / 153,523 / 125,128 | +149,233 / +40,816 / +31,760 |
| `public-subpath-app-data` | 315,878 / 88,503 / 74,776 | 451,784 / 126,141 / 103,987 | +135,906 / +37,638 / +29,211 |
| `public-subpath-online` | 312,104 / 87,238 / 73,962 | 448,010 / 124,873 / 103,119 | +135,906 / +37,635 / +29,157 |
| `public-subpath-hosted-browser` | 312,018 / 87,173 / 73,971 | 447,924 / 124,804 / 103,176 | +135,906 / +37,631 / +29,205 |
| `full-sessions` | 311,109 / 86,860 / 73,736 | 447,015 / 124,490 / 102,900 | +135,906 / +37,630 / +29,164 |
| `public-subpath-vector-search` | 310,776 / 86,814 / 73,665 | 446,682 / 124,436 / 102,817 | +135,906 / +37,622 / +29,152 |
| `public-subpath-push-registry` | 314,657 / 88,104 / 74,473 | 450,563 / 125,720 / 103,605 | +135,906 / +37,616 / +29,132 |
| `app-data-operation-live` | 312,765 / 87,426 / 74,074 | 448,671 / 125,041 / 103,269 | +135,906 / +37,615 / +29,195 |
| `online-operation-live` | 310,702 / 86,779 / 73,699 | 446,608 / 124,383 / 102,785 | +135,906 / +37,604 / +29,086 |
| `push-registry-attach` | 314,678 / 88,065 / 74,412 | 450,584 / 125,668 / 103,631 | +135,906 / +37,603 / +29,219 |
| `full-operation-call` | 310,670 / 86,764 / 73,659 | 446,576 / 124,366 / 102,763 | +135,906 / +37,602 / +29,104 |
| `full-operation-live` | 310,700 / 86,772 / 73,671 | 446,606 / 124,371 / 102,891 | +135,906 / +37,599 / +29,220 |
| `public-subpath-rqs-preload` | 5,505 / 2,555 / 2,147 | 32,561 / 10,712 / 9,416 | +27,056 / +8,157 / +7,269 |
| `external-react-application` | 46,863 / 14,743 / 12,964 | 50,114 / 15,841 / 13,908 | +3,251 / +1,098 / +944 |
| `react-external` | 46,692 / 14,688 / 12,889 | 49,943 / 15,781 / 13,865 | +3,251 / +1,093 / +976 |
| `public-subpath-materialization-store` | 65,581 / 18,798 / 16,611 | 67,752 / 19,432 / 17,169 | +2,171 / +634 / +558 |
| `public-subpath-rqs-store-default` | 51,213 / 15,466 / 13,614 | 52,721 / 15,815 / 13,881 | +1,508 / +349 / +267 |
| `public-subpath-rqs-store-expo` | 33,104 / 11,361 / 10,076 | 34,251 / 11,616 / 10,286 | +1,147 / +255 / +210 |
| `public-subpath-rqs-store` | 31,897 / 11,327 / 9,997 | 32,567 / 11,504 / 10,124 | +670 / +177 / +127 |
| `public-subpath-rqs-store-file` | 31,911 / 11,123 / 9,835 | 32,627 / 11,287 / 9,975 | +716 / +164 / +140 |
| `public-subpath-outbox-shared` | 12,880 / 4,759 / 4,275 | 13,258 / 4,852 / 4,365 | +378 / +93 / +90 |
| `public-subpath-agent-authority` | 73,484 / 18,838 / 16,364 | 73,283 / 18,765 / 16,309 | -201 / -73 / -55 |

## First-run profiles in the workload version

These two Move-3 subpaths have no predecessor and therefore do not appear in
the before/after table. Their first-run ceilings are recorded in the same
workload receipt without inventing historical numbers:

| Profile | Minified | Gzip | Brotli |
|---|---:|---:|---:|
| `public-subpath-local-read-admission` | 39,397 | 12,681 | 11,271 |
| `public-subpath-optimistic-rebase` | 45,640 | 14,307 | 12,744 |

## Audit trail and acceptance

`baseline.move3-single-table-lifecycle.v1.json` stores each predecessor
filename and whole-file SHA-256, plus all 25 before/after metric and output-hash
rows. The predecessor files remain byte-for-byte unchanged. Closing this ticket
requires Charlie's recorded review and any size follow-up he requests; a green
ratchet check alone is not closure evidence.


## 2026-08-04 rebase note

The frozen rollover numbers were re-measured once more after rebasing onto
the P1 finite-carrier landing (f466c0501), which added ~2.3 KB min /
~0.85 KB gzip to the client surface profiles (e.g. full-public-surface
555,453 → 557,749 min). The table above reflects the pre-rebase
measurements; the landed ledger (baseline.move3-single-table-lifecycle.v1.json)
holds the final values. Both deltas are part of the same review ask.

## Delegated review (2026-08-04)

Charlie delegated the size review to Codex. I compared the attributed
`full-public-surface` closure in the `ffee324ec`-era local-persistent-store
receipt with `current.v1.json` at its recorded `f2b79cc6` package trees, read
the intervening `packages/snapback-client` history, and ran the metrology
check successfully with `volta run node`. The final root delta is
**+151,529 min / +41,681 gzip / +32,294 Brotli**. Package attribution assigns
+133,064 minified bytes to `@expo/snapback-client` and +18,465 to
`@expo/snapback-contract`.

Categories below mean: **(a)** legitimate landed, spec-governed feature mass;
**(b)** plausibly avoidable closure weight; **(c)** unclear. Module deltas are
module-own `bytesInOutput`, not exclusive dependency cost, so they should not
be added to hypothetical savings independently.

| Contributor | Root module-own minified delta | Class | Attribution |
|---|---:|:---:|---|
| `materialization-store.mjs` | +48,401 | (a) | The module already existed as a narrow store subpath; P2, `single_table_v1`, and P1 made it part of the Full client. Its own public-subpath closure grew only +4,380 minified, so most of this row is deliberate Full integration, not 48 kB of newly written store code. LLP 0157 D7 and LLP 0166 D9 govern the store and its Full-only arm. |
| `index.mjs` own code | +17,280 | (a) | The history attributes the additions to the v3 logout/store-domain bridge, generated materialization preparation, active-registration answers, M2 admission, M3 rebase, M4 mutation preparation, typed offline refusal, finite-carrier wiring, and rowless-resume ordering. These are reachable Full-client lifecycle paths, not unreferenced helpers. |
| `local-read-admission.mjs` | +14,425 | (a) | M2's closed ready/partial/server-only/refused admission and M4 integration, governed by LLP 0155's local-read admission contract. |
| `rqs-preload.mjs` | +13,014 | (a) | Commit `817493e83` added the accepted `mixed-route.v2` registered-boot validator and lifecycle. Its public namespace profile grows +27,056 minified including dependencies, but this is selected API mass: an ad-hoc named-import probe of `readRqsPreloadRegistry` tree-shakes to 4,258 min / 2,176 gzip, while the registered helper is 31,252 / 10,262 and the namespace is 32,426 / 10,650. Ordinary inline-preload users therefore do not silently pay the mixed-route closure. |
| `ir-evaluator.mjs` | +11,369 | (a) | M1's browser-safe, D5-proven evaluator; this is the central LLP 0155 Move-3 execution mechanism. |
| `materialization-bridge.mjs` | +9,999 | (a) | P2 hydration/retained-render bridge plus `single_table_v1` identities and M2 admission wiring, governed by LLP 0157/0166. |
| `optimistic-rebase.mjs` + `@expo/snapback-contract/derived-overlay.mjs` | +15,835 | (a) | M3's ordered optimistic layer/rebase machinery and its contract-owned overlay validation. Both are directly required by LLP 0155's rebase contract. |
| `@expo/snapback-contract/authorized-lease.mjs` | +7,907 | (a) | Reachable through the materialization bridge for protected retained custody; removing it from that Full path would weaken LLP 0166's authority/lease rules. |
| `react-binding.mjs` | +3,855 | (a) | Mixed-route/lifecycle admission and local binding recovery on the existing public preparation seam. The separate React application profile grew only +3,251 min / +1,098 gzip in total. |
| `generated-mutation-ir.mjs` | +3,293 | (a) | M4's generated-operation validation/preparation, governed by LLP 0155's generated-mutation-IR exit. |
| `@expo/snapback-contract/client-store.mjs` + `registration-ledger.mjs` | +3,263 | (a) | Store-domain contract additions and registration-backed live/local-read ownership under LLP 0166 D1/D2. |
| `index.mjs` as the owner imported by compatibility entries | +138,160 in `public-subpath-app-data`; approximately the same family across `online`, sessions, hosted-browser, vector, push, and operation profiles | (b) | `app-data.mjs` imports and constructs `SnapbackClient`; `online.mjs` re-exports the same class. Once local sync became reachable from that class, those entries inherited essentially the complete new graph even when their measured operation does not select materialization, local evaluation, or optimistic mutation. This is the package/capability mismatch LLP 0145 F2 predicts. The feature implementations are legitimate; their mandatory placement in every compatibility closure is plausibly avoidable. |

No major contributor is class (c). I also found no duplicated module instance
in the esbuild graph. The dormant 514-line `result-transform.mjs` implementation
is absent from the measured browser closure, as are unselected demand-broker
and lease-convergence modules; that is positive evidence against a general
tree-shaking failure or a broad accidental `export *` leak.

**Verdict: mixed.** Bless the attributed growth as feature mass for the
declared **Full/root** workload: the dominant modules map directly to accepted
or explicitly commissioned M1–M4, `single_table_v1`, lifecycle, and P1
functionality. Do **not** treat that as a blessing of the compatibility-surface
shape. Commission one remediation lane for LLP 0145 Option 2's static
capability boundary.

Concrete remediation candidate: extract the request/operation/live/session
kernel and the local-sync lifecycle from `index.mjs` into statically composed
capability modules. Make `app-data.mjs` and a genuinely narrow Online/generated
entry depend on only their selected kernel/capabilities instead of constructing
or re-exporting the all-owning `SnapbackClient`; retain the root class as the
Full compatibility composition. Add named-operation/session/app-data
metrology profiles that assert `materialization-store.mjs`,
`local-read-admission.mjs`, `ir-evaluator.mjs`,
`materialization-bridge.mjs`, and `optimistic-rebase.mjs` are absent unless
local sync is selected. This is a spec-coordinated architecture lane, not a
request to delete validation or authority checks from a profile that needs
them.

Status remains Open for Charlie's final disposition.

## Ruling (2026-08-05, Charlie)

Verdict (a) **BLESSED**: the Full/root growth is spec-governed feature
mass; the rollover stands. Verdict (b) **COMMISSIONED now**: the
static-capability-composition remediation lane opens as
`issues/20260805-static-capability-composition.md`. This ticket closes.

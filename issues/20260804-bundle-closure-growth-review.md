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

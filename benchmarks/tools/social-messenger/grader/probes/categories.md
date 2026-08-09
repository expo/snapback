# Published probe-category registry

**Provenance:** LLP 0201 D3.5 and the brief's "Holdout probes" and
"Scale envelope and performance" sections. **Status:** 0.1.0-p1 DRAFT —
freezes at P3. Every wave's rotated probe set covers **every category
below with at least one scored instance**; each category additionally
keeps **one unchanged cross-wave anchor probe, marked NON-SCORED** — a
published continuity diagnostic that prices difficulty drift and never
bears on O3/O5.

Categories are public; the wave's concrete probe instances are held
out until the wave publishes (see `README.md`).

## Trust-boundary categories (feed O3)

| Category id | Obligation tested (brief authority) |
|---|---|
| `tb-cross-user-dm-access` | User A cannot fetch user B's DMs through the API (server-side authorization, not UI absence). |
| `tb-removed-member-delivery` | A removed group member immediately stops receiving new messages (M3 spec). |
| `tb-view-once-refetch` | A view-once photo's second view is denied server-side, including direct asset fetch after the view (M5). |
| `tb-expired-edit-window` | An edit attempted after the 15-minute window (shortened-windows config) is rejected server-side; window checks run against server time — caller-supplied timestamps must not pass (Global rulings). |
| `tb-session-invalidation` | A logged-out session's token no longer works against the backend (M1). |
| `tb-offline-bypass` | Server-side denials survive the offline cache: revoked/expired/view-once content never renders from the offline cache after the client has synced the revocation; view-once media is never durably cached at all (Global revocation ruling). |

## Performance categories (feed O5, at the replay checkpoints)

Instances are the exact queries measured against the published scale
envelope under the brief's hardware-independent degradation rules
(k=20 after 3 warm-ups, sequential, 30 s timeout; measurable p95
predicates frozen with the probe set).

| Category id | Degradation rule tested |
|---|---|
| `perf-deep-paging` | Paging deep into the 10k-message chat: p95 of page 50 ≤ 3× p95 of page 1 (no superlinear deep paging). |
| `perf-feed-follow-scaling` | Following-feed load for the 500-follow probe user (u0500) ≤ 3× the 5-follow comparison user (u0005) — feed latency must not scale with follow count. |
| `perf-search-scaling` | Global message search at the full corpus ≤ 3× the same query at the 10% checkpoint, with the 50% checkpoint on or below the line between them. |
| `perf-receipt-aggregation` | Receipt aggregation in the 50-member busy group (g0001) must not visibly stall message send/render. |
| `perf-cold-start-sync` | Cold-start initial sync of the probe user's account (100 conversations) completes without timeout or unbounded memory growth; wall time recorded. |
| `perf-envelope-stability` | No probe may time out, error, or OOM at the envelope. |

## Notes

- Named fixtures (u0500, u0005, g0001) are checked **exactly, at each
  checkpoint, before probes run**; a fixture mismatch caps O5 at 0
  (brief, replay contract).
- Absolute p95 ceilings per rotated probe are calibrated at P3 from
  the pilot and recorded with the budget caps; ceilings feed O5's 60
  and 90 bands, degradation rules feed its 30 band.
- Anchor instances exist in every category above; the rotation log's
  category mapping marks them `anchor (NON-SCORED)`.

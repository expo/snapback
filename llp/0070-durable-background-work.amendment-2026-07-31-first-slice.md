# LLP 0070 — amendment (2026-07-31): first-slice spec text [Tombstoned]

**Kind:** Tombstoned dated-amendment appendix to LLP 0070 (durable
background work). Not a numbered LLP document.
**Status:** Tombstoned 2026-08-01 — absorbed into the RFC body.
**Author:** Claude (Fable 5); tombstoned by the 2026-08-01 absorption pass
(Charlie's ballot item 4b).
**Date:** 2026-07-31 (authored); 2026-08-01 (absorbed and tombstoned)
**Superseded by:** LLP 0070 §First slice as shipped (2026-07-31; absorbed 2026-08-01)

> **Tombstoned — read for history only.** Absorbed into the LLP 0070 RFC
> body on 2026-08-01. Consult that section, not this file.

The spec text this note carried — the enqueue-association receipt shape
(LLP 0127 decision 7), callee-class admission (LLP 0121 OQ2), the
deterministic drain seam (0121 OQ5/OQ9), the paved default queue (0121
OQ1), the inspection surfaces (0121 OQ3), the v1 idempotency narrowing,
the honest-gaps list, and the `jobs_one_off_v1` capability posture — now
lives in the RFC body:

> `llp/0070-durable-background-work.rfc.md`,
> §First slice as shipped (2026-07-31; absorbed 2026-08-01)

The absorbed text was reconciled against what landed after this note was
written (the e25ab2a3 slice landing; the 01ddd8e2 job-status
boot-admission fix; the platform-owned job-status result contract; the
secret-read-lease custody on admin jobs inspection; the bdf4763c cron
epoch-seeding fix and LLP 0028's amended §Inspection; the LLP 0137 A6 arm
and 0.1.8 re-verification receipts). Consult the RFC body, not this file;
the original wording survives in git history at this path's predecessor
(`llp/0070-durable-background-work.amendment-2026-07-31-first-slice.md`,
pre-2026-08-01).

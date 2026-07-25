# 0081: verification proof, receipts, and generationRepublish rollback

**Status:** Deferred (phase C)
**Severity:** P2
**Systems:** Migrations, Storage, Deployment
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §§5-7, LLP 0072 (generationRepublish posture)
**Marker:** step5-impl

Final proof assembly (independent expected values, zero rejected rows,
schema/generation identities, no unexpected changes) and the digest-sealed
MigrationReceiptV1 as a journal projection; rollback-before-publication;
maintenance-window generationRepublish (version R restamping with the
monotonic rollback timestamp, commit-version budget reservation, retained
predecessor work reactivation, digest-sealed rollback receipt, audited
authority); reverse-plan and restore paths with irreversibility
acknowledgment; 0072 posture composition and the rehearsal binding.
L-sized.

# Scripts inventory omits the existing caps test

**Status:** Open
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Root scripts-test inventory

During the Snapback2 four-plan verification, `node scripts/check-inventories.mjs`
reports `unexpected on disk: scripts/caps.test.mjs` in the scripts-test inventory.
The test and inventory are unchanged from base `bf8450849`; no root test was
added by this program. Reconcile that existing test with the inventory's real
scope and rerun the inventory check. Do not remove or exclude the test solely
to silence the report.

The same run also lacks ignored Snapback1 demo-generated leaves and reports
stale Snapback1 diagnostics projections. Those require their documented
bootstrap/generation path; they are separate from this bounded registration
issue. The complete retained log is
`/tmp/snapback2-four-plans-inventories.log` in the implementation run.

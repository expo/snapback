# A4 sweep: documented pasteable asset lanes (signed-url, public-immutable) are absent from the packaged runtime

**Opened:** 2026-08-01
**Systems:** Assets, Runtime, Documentation
**Related:** LLP 0137 (A4 arm), LLP 0044, demos/improvement-sweep/arms/a4-snapback-web/findings/0137-a4-f3-pasteable-delivery-lanes-unimplemented.json, issues/20260801-0137-a1-attach-admission-not-honored-at-commit.md

The assets guide documents `private-signed`
(`POST /assets/records/{id}/signed-url`) and `public-immutable`
(`GET /assets/public/{id}/{variant}`) as shipped pasteable lanes on the
local target. On packaged 0.1.7 an intent declaring private-signed
generates and its asset publishes to ready, but both routes 404; the
runtime binary contains only the two delivery-kind vocabulary strings.

Because typed attachment is also broken (0137-a1-f2 → via-references and
membership assetSharing unreachable), there is NO authorizable non-owner
viewer class for any asset on the public closure: A4's event flyer
uploads, produces card/thumb renditions, and delivers strictly to its
owner — and can never be shown to a guest. This is the A4-07 check fail.

Fix shape: implement the two documented routes, or mark both lanes
explicit Missing nonclaims in the guide and capability manifest until
they exist. Witness: packaged-closure conformance exercising signed-url
issuance + uncredentialed fetch + TTL/deletion denial, and public
rendition serving with immutable headers.

---

**RESOLVED 2026-08-01 (fix-wave α1) — fixed in source; packaged
staleness tracked separately.** The source defect this ticket describes
is fixed on main: attach admissions thread through all served-path
dry-run seams (cb608f7b, landed 2e73c1cd), the pasteable delivery lanes
are implemented with the header exemption (f9679cf4), and the asset
client carries sessions bearer custody + the protocol offer (0aba0280,
landed 5cba02cf). Verified today by tests/acceptance/
asset-conformance-v1.mjs: ok=true, 18/18 including handlerAttachCommits,
pasteableDeliveryHeaderless, and the sessions-custody legs. What remains
is that packaged 0.1.7 predates these landings — the staged/published
closure refresh is Lane α milestone 2 of the fix wave (see the α2
handoff/receipt recorded there).

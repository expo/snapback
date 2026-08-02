# 0133-06: Client store seam extension — id-map delivery, leaf rewrite, and the speculative-id cascade

**Status:** Closed
**Program:** 20260802-0133-00-settlement-substrate-program.md
**Systems:** Client integration, Sync
**Depends on:** 0133-04 (receipt id-map shape)
**Related:** LLP 0133 §Divergence on settle (seam extension, class 1, sketch
3/9); LLP 0114/0107; `packages/snapback-client/external-store.mjs`
(`acceptAuthoritativeRows`), LLP 0008 (drop-and-mark-failed family)

## Task

Extend the shipped external-store seam for lane-L settlements, driven by
synthetic receipts (no local capture exists yet):

- **Id-map delivery:** the receipt id-map reaches the store layer so
  retirement matchers can recognize authoritative rows under re-derived ids;
  absent a map-aware matcher, the shipped conservative fallback (first
  delivery strictly after confirmation) bounds the bridge.
- **Rewrite:** not-yet-submitted pending intents whose args leaf-reference a
  speculative id are rewritten by exact string-leaf equality against the
  client's minted-id ledger. Both documented error classes stand as scope:
  deliberately-copied ids rewrite too (false positive); embedded/derived
  survivals are neither rewritten nor detected (false negative). OQ2
  graduates both — do not build dataflow analysis here.
- **Serialization:** an intent leaf-referencing a speculative id never
  crosses the submission boundary before every predecessor minting intent
  settles; sequence-order serial replay already provides this — make it
  normative in the submission gate so a future pipelining client cannot
  violate it.
- **Cascade:** an unmapped or rejected mint fails dependents locally in the
  drop-and-mark-failed family with stable working code
  `SNAPBACK_SPECULATIVE_ID_UNRESOLVED`, checked at the minting mutation's
  terminal failure and at each dependent's submission slot; cascade failures
  are terminal and propagate transitively; surfaced as observable client
  state.

## Exit

- Sketch 3's client half: mapped-id rewrite settles the dependent against
  the authoritative row; rejection cascades without submission; transitive
  cascade; leaf-rule false-positive variant pinned by test.
- Sketch 9: confirmation-before-delivery bridges until matcher or fallback;
  delivery-before-confirmation suppresses then splices; delayed delivery
  keeps the bridge marked via the seam's exposed layer status without
  flickering to pre-mutation state.

## Resolution

Resolved in `63d980b6` (`feat(client): reconcile speculative settlement
ids`). The external-store matcher now receives the submitting receipt's
private `idMap`, rechecks an already-delivered authoritative base when
confirmation wins second, exposes confirmed bridge layers to inspection, and
retains the existing first-post-confirmation delivery fallback. The shared
durable outbox transition rewrites not-yet-submitted successor args by exact
string-leaf equality, gates each actual submission on predecessor settlement,
and transitively marks unresolved dependents failed with
`SNAPBACK_SPECULATIVE_ID_UNRESOLVED`. The memory, IndexedDB, and file arms all
carry the same atomic transition.

Proving tests:

- `LLP 0133 sketch 3 rewrites mapped speculative-id leaves before dependent submission`
- `LLP 0133 sketch 3 rejection cascades transitively without dependent submission`
- `LLP 0133 sketch 3 unmapped successful mint takes the same local cascade`
- `LLP 0133 speculative-id submission fence blocks a pending mint predecessor`
- the sketch-9 confirmation/delivery-order blocks in `external-store.test.mjs`
- the complete `@expo/snapback-client` package suite and strict TypeScript check
- `./ref-check --verbose`

The full Rust library suite completed with 1,640 passing tests, one ignored,
and the same three inherited live-query failures recorded by the earlier
program tickets. The rewrite deliberately retains LLP 0133's specified floor:
an exact copied leaf rewrites (false positive), while embedded or derived
survivals remain untouched (false negative); no OQ2 typed-id or dataflow work
landed.

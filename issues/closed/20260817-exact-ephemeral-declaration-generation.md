# Exact: provider-native declaration generator cannot emit ephemeral operation descriptors

**Opened:** 2026-08-17
**Source:** Coterie M3 messaging core (Diary 0086); LLP 0279 item 4

## Gap

Contract's runtime manifest can represent ephemeral operations, but the
closed provider-native declaration generator cannot generate those
descriptors. Coterie's v8 typing surface therefore lives in a documented
bridge: a live/coalesced `observeTyping` query, a `setTyping` mutation, and
a namespaced extension stating ephemeral durability, no offline retention,
no history, the 2 s visibility target, and the 5 s lease — a parallel
vocabulary every adapter must interpret.

## Ask

Generate first-class ephemeral operation descriptors (durability class,
lease/visibility facts) from provider-native declarations. Acceptance: the
Coterie v8 bridge extension is deleted and typing claims become declaration
facts that conformance can check. External (Exact repo) fix; graduate to
Linear (Exact project) when picked up. Related Snapback-side adoption:
`issues/20260817-coterie-typing-allow-members-adoption.md`.

## Resolution (2026-08-17)

Graduated to the Exact repo: `issues/20260817-exact-ephemeral-declaration-generation.md` there. Picked up by the
sbs-orchestrate Exact-side batch; further state lives in the Exact ticket.

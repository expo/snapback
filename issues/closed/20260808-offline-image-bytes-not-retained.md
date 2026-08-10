# Offline retention keeps text history but not image bytes — docs silent on the gap

**Filed:** 2026-08-08 (run-6 N≥3 series residue, round 4; diary 0072; record 2026-08-08-messaging-0115-n3.md)

Offline cold-start renders full text history (honestly labeled) but image bubbles show loaders/spinners: asset bytes are not retained by the platform offline story. A WhatsApp-shaped user expects recently viewed images offline. Observed and called out by A-native and A-bare lanes; docs do not state the boundary.

**Ask:** document the boundary on the offline page now; consider opt-in rendition retention (bounded cache) as a product follow-on — this is also exactly the kind of outcome the equal-proof-bar/day-2 briefs will price.

## Resolution — 2026-08-10

The offline page now distinguishes retained row text/asset references from
non-retained rendition bytes, documents the cold-offline placeholder/retry
behavior, and teaches the honest workaround: an application-owned bounded
byte cache with app-owned expiry/quota/logout-wipe/revocation. First-party
opt-in rendition retention was considered and stays unclaimed (Snapback makes
no privacy- or revocation-aware image-byte-cache claim); re-file if a second
consumer demands it.

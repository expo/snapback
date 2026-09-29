# AV round 2 context (llp-orient)

Scope: asset-download.ts, online client.asset, useAsset recovery tests, media guide.
Read the skill from lane-dx/vendor/llp/skills/llp-orient/SKILL.md because this
worktree's skills symlink target is absent. Orientation was read-only.

Governing LLPs (all three in current/, none in foundation/):
- LLP 3000#7 and #http-overload-diagnostics: home-row authorization, one home,
  Range refusal before one-view consumption, explicit admission retries.
- LLP 3000.008.002.000#6: handle ownership, safe ranged retries, error/denied
  distinction, terminal revocation and non-replay of ambiguous once transfers.
- LLP 3000.019#3.5: retained bytes require complete full-file response and
  current store/home receipts. No changes to that authority.

Active constraints/rationale: those same sections prohibit using a malformed
HTTP body as proof that a once request was refused before consumption. Progress
can renew transfer time without changing grant ownership or retry safety.
User explicitly commissions the timeout/admission correction and detecting tests.

Risk: native buffered fetch exposes no intermediate byte progress. Its opaque
wait keeps a bound; host image/video views use assetSource. No native progress
API or claim is introduced here. Guide and LLP timing text must say this.

Doc updates: LLP 3000.008.002.000 §6, guide assets/media and client manual;
append one journal entry and the round2 report. Hand-off: none.

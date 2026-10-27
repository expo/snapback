# Optional-evidence compact witness omits the focal list value

Status: Open
Date: 2026-10-27
Scope: Snapback 4 security question rendering (DX14)

SEC11 item 1 supplies a concrete final-store replay for omitted/empty media
lists. In wave30 lane 030, the default card identifies `openStudy` and its
admitted dispatcher, but renders `studies.openStudy absent -> {}`. The full
JSON witness and acknowledgment refusal retain `recordings: null` and the
exact presence/count predicate.

The compact field selector currently reads `Invariant.column` and RuleExpr
terms. A compound `count(.recordings) > 0` candidate has syntax instead of a
RuleExpr, so the focal field set is empty. Render the focal syntax fields (or
provide explicit compact facts from the witness producer) without exposing
opaque payloads or changing decision identity. Include null and empty-list
examples. This is a presentation gap, not an absent executable replay or a
production gate. SEC11 leaves the shared rendering change to DX14's ownership.

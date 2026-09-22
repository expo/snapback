# Snapback4 feed delete refusal suggests an unsupported denied-delete rule

Status: Open
Scope: Small diagnostic follow-up; nonblocking for LLP 3000.011 publication.

The independent Grok 4.7 xhigh review of `e7a1c7c15` observed that a public
follow/repost mapping with `delete <- allow` first receives the shared
“must deny or require its owner” error. Changing it to `deny` then receives
the new, correct owner-equality requirement. Both attempts safely refuse before
writing files, but the first error suggests an option the installer cannot use.

Adjust the shared delete diagnostic for these two mapped tables so its first
refusal points directly to the required owner-equality rule, preserving the
profile/post policies and no-write boundary. Add the corresponding negative
installer assertion. No runtime behavior, new authorization or generic rule
analysis is needed.

Evidence: [actual review](../llp/reviews/3000.011-recent-builder-friction.grok.md)
and [owning RFC](../llp/3000.011.002.000-simpler-feed-integration.rfc.md).
The material denied-delete installation defect was fixed and independently
marked READY; this ticket tracks only the remaining wording.

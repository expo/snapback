# AV round 3 context (llp-orient)

Scope: shared asset downloader, detecting transfer tests and current media docs.
Read llp-orient from lane-dx/vendor/llp/skills/llp-orient/SKILL.md; the local
symlink target is absent. No orientation changes to source.

Governing LLPs (current/, absent from foundation/): LLP 3000 §7 (home-row
serving and non-consuming Range); LLP 3000.008.002.000 §6 (handle ownership,
retry safety, admission cooldowns); LLP 3000.019 §3.5 (receipt-bound retention).
Active constraints and rationale: those sections require authorization on every
attempt, terminal refusal, and no replay of an ambiguous one-view response.
Changing a deadline grants no authority. Preserve cooldowns, bounded calls,
six concurrent bodies and late-response disposal. No contract changes.

Risk: an arbitrary fetch can expose headers only after its whole body. The SDK
cannot distinguish a stalled first response from a progressing opaque transfer
before that promise resolves. Use a documented finite size-based opaque limit;
observable streams retain their byte-inactivity timer. Exercise both fetch and
Blob buffering, ordinary and once, on real HTTP. Empty chunks renew neither
progress nor admission budget. This is a buffered-host model, not a native
platform qualification.

Doc updates: governing §6, guide media/assets, operations manual; report and one
append-only journal entry. Hand-off: none.

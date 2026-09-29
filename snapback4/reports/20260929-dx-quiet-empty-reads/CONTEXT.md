# DX round 0 context

Scope: development response evidence, local writer/console, CLI switch, why
cards, operations manual. Base `4fd338de59407ab6b7cc7009e27001c877cacfe9`, branch
`sb4-intent/dx-quiet-empty-reads`. No engine, client contract or wasm code changes.

Orientation used the repository's `skills/llp-orient/SKILL.md`. Its initially
uninitialized vendor submodule was initialized at the checkout's pinned commit.

Governing documents:

1. [LLP 3000 §1, §4, §7](../../../llp/3000-snapback4.explainer.md): Snapback 4
   fence, periphery lane, no unrelated baseline gates. Root orientation.
2. [LLP 2000.000 §6–8](../../../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md):
   authorization, meters, sync horizons and typed read outcomes.
3. [LLP 3000.015 §2.1](../../../llp/3000.015-shared-baseline-for-snapback5.spec.md),
   linked in `llp/current`: MP's private refusing-clause collector, successful
   filtering exclusion, bounded writer, live instance and watermark checks.
   This is the decision updated by this lane; no new LLP.

Active constraints and rationale: LLP 3000.015 §2.1 keeps private evidence out of
caller envelopes and receipts, records no args/rows/keys/credentials, preserves
meters/admission, and refuses stale or dropped latest evidence. Its prior
unknown-empty fallback is superseded under the user's explicit calibration #26
instruction. LLP 3000 §4 keeps this work inside the Snapback 4 workspace.

MP history inspected: `570ca4cb7` is the modeling-papercuts merge; `f6ccc4a51`
is a later merge from main carrying calibration evidence (not a second
refusal implementation diff). Current `dev_refusals.rs`,
`dev_refusal_response.rs`, watermark, `why recent`, process/host tests and
why cards supply the implemented baseline.

Decision: ordinary unknown-empty answers are silent and unrecorded by default.
Opt-in `dev --trace-empty` records them only in `why recent`. Real refusals keep
individual records, including a user-authored refusal named EMPTY_READ. Console
aggregation uses fixed one-second windows and a 32-group bound; overflow flushes
the oldest early. The remaining evidence limits and failure behavior stay put.

Risks: console counts include only accepted queue entries; process termination
may lose buffered console groups. Recording empties by request can still saturate
the evidence queue. Emptiness cannot distinguish hidden rows from absent rows;
the card must direct rule, coverage and horizon inspection without inventing a
verdict. Source/generation changes must not merge different causes.

Doc updates: governing §2.1, EMPTY_READ/E_RULE why cards, refusal and sequence
guide text, CLI help and CLIENT-AND-OPERATIONS. Hand-off: none.

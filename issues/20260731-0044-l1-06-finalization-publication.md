# 0044 L1-06: trusted finalization and publication protocol

**Status:** OPEN. **Authority:** LLP 0044 §Restricted staging and
trusted finalization, §Publication and crash recovery, §Internal model
(witness).

The nine-step finalizer: attempt currency + witness validation
(re-validate-then-refuse-on-denial under the frozen-generation
authorizer; materially identical = validated-output-DTO equality),
length/transport verification with the two integrity grades, detection
from bytes, intent policy enforcement, SHA-256 canonical digest,
blob reuse/create under the uniqueness constraint with the condemned
fence and uniqueness-loser convergence, atomic primary-rendition +
availability publication (required renditions gate ready), staging
cleanup. Write-ahead publication records (planned→staged|condemned,
staged→committed|condemned), recovery probing planned records, receipted
retirement, reconciliation sweep (rides the L1-11 ledger).

Done when: the staging/finalization/publication and fault-injection
acceptance rows pass, including every named crash cut, the dedup-vs-GC
race, and benign-churn/phantom-insertion witness cases.

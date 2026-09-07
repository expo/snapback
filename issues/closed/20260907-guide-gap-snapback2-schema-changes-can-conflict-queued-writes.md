# Guide gap: Snapback 2 additive schema changes can conflict queued writes

**Status:** Closed
**Date:** 2026-09-07
**Systems:** offline guide, schema successor, pending client writes

The pending-client exercise initially expected two predicted posts to commit
after adding an optional message column. Both correctly settled
E_OFFLINE_CONFLICT because saved rule verdicts bind the complete schema. The
existing offline recipe described traced conflicts without explaining this
consequence for apparently harmless additive changes.

Resolution: the offline guide now names whole-schema binding, additive-column
conflicts, and recovery by reading current data and submitting a new intent.
Never rewrite an admitted intent's args or trace. The real-owner regression
proves original envelope preservation, typed terminal conflicts, no unintended
writes, explicit new-intent recovery, and stored-terminal replay after
operation removal. Authority semantics are unchanged.

[Evidence and diary context](../../benchmarks/runs/2026-09-07-snapback2-evolution-diagnostic/README.md#pending-client-successor-exercise--source-build-2026-09-07).

# snapback2-core: the heap, closure, and output ceiling checks in `check_all` cannot fire

**Status:** Open
**Systems:** snapback2, certificate
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-30
**Related:** LLP 1001 §4/§10, `snapback2/crates/snapback2-core/src/certificate.rs:169`, `spikes/bounded-programs/REPORT.md` ("Known S1 limits": heap/output/closure byte fields are coarse estimates)

Found by the report-only delta review of lane A (2026-08-30) after the lane had used its fix rounds. `Checker::check_all` clamps the heap and closure byte estimates to their ceilings before comparing, and sets the output estimate equal to its ceiling, so those three refusals are unreachable: a scan with `take = 4095` estimates 4,195,328 closure bytes against the default 4 MiB ceiling and certifies. Examined/index/rule-probe/steps/write ceilings are real and tested.

Fix: compare the raw estimates (and make the output estimate a function of the program's result shape and `take`), add a test per ceiling that a program over each one is refused with the ceiling named, and re-measure the S1 corpus so no existing program flips. The estimates themselves stay coarse until a real allocator/serializer proof replaces them (LLP 1001 deferred list).

Minor, same review: the live error digest covers only `error.code()`, so two different `E_OVERFLOW` messages on successive reruns are `changed: false`; include the message.

# Harden harness diagnostic inspection against hostile accessors

**Status:** In Progress
**Severity:** P1
**Systems:** Runtime, Security, Auth/RBAC, Conformance
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0009 §Harness control-plane boundary; LLP 0048 §Architecture
**Marker:** diagnostics, settlement, intrinsics, engine-parity

Two application-controlled diagnostic paths still used mutable or unguarded
JavaScript surface:

- The synchronous host bridge parsed native host-error codes through mutable
  `String.prototype.match` and attached them with mutable
  `Object.defineProperty`. A handler could erase or forge the typed diagnostic
  returned by an RBAC or database host failure.
- The settlement catch read `__snapbackCode` and `message` without guarding
  hostile getters. A thrown object could escape the catch, replacing the
  intended handler failure with an engine-specific generic invocation error.

Both cases failed closed and committed no writes, but violated typed-diagnostic
integrity and Hermes/V8 conformance at the auth boundary.

**Done when:**

- Host-code recognition and descriptor installation use only pre-application
  captured primitives.
- Hostile `__snapbackCode` and `message` getters cannot escape settlement.
- A safe message remains available when only code inspection fails, and an
  uninspectable message becomes a stable primitive fallback.
- Adversarial host-intrinsic tests preserve
  `SNAPBACK_HANDLER_HOST_CALL_INVALID`.
- Hermes and V8 return the same safe failure envelope for hostile getters,
  commit no buffered writes, and remain healthy for a subsequent invocation.

## Implemented; remote verification pending

The bootstrap now captures `RegExp.prototype.exec`, keeps its code pattern
lexical, and uses the captured descriptor primitive in the host bridge.
Settlement guards code and message inspection independently and falls back to
`handler failure could not be safely inspected`. Focused Ibex host tests and a
shared Hermes/V8 corpus pin both accessor cases and transactional rollback.

# snapback2: malformed compiler success responses silently erase seed and journeys

**Status:** Closed
**Resolution:** Compiler success responses are now strictly deserialized per operation with required fields and matching request IDs in snapback2/crates/snapback2/src/project.rs; unit regressions cover malformed seed/journeys, wrong IDs, and wrong-operation shapes.
**Systems:** snapback2, compiler worker, protocol, data loss
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/project.rs:179-215

Failure scenario: a version-skewed worker returns {ok:true,seed:{personas:["alice"],rows:5}}. seed silently converts rows to an empty map; hot apply installs that empty seed, and the next reset deletes application data and restores nothing. Likewise {ok:true} for journeys becomes no journey files, so authored journeys are omitted.

Why it happens: required fields are defaulted, filtered, or unwrap_or_default rather than rejected, and request never validates the response id. No later handshake establishes that a successful response matches the requested operation and complete shape.

Suggested fix: deserialize strict tagged response structs, require the matching request ID and every required field/type, and return E_OWNER_COMPILER_PROTOCOL on any mismatch. Add malformed success, wrong-id, and wrong-operation worker tests.

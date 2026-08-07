# Result contract violation errors hash the field path, not just the value, making them undebuggable

**Status:** Resolved
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Systems:** Result contracts, Runtime diagnostics
**Date:** 2026-08-05
**Related:** `src/result_contract.rs:325-339`, `demos/messaging-snapback`

## Summary

Found while building `demos/messaging-snapback`. Handlers for
`myConversations`/`conversationMessages` initially spread the raw stored row
through (`{...conversation}`, `{...message, reactions}`), which carries
`_version`/`_updatedAt` system fields not declared in the result contract.
This is correctly rejected with `SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION`
— but the error gives no way to tell which field was the problem:

```rust
fn violation(function: &FunctionDefinition, path: &str) -> SnapbackError {
    let path_hash = Sha256::digest(path.as_bytes());
    SnapbackError::error(
        "SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION",
        "runtime",
        format!(
            "handler {:?} returned a value outside its declared result contract",
            function.id
        ),
    )
    .with_details(json!({
        "functionId": function.id,
        "resultContractHash": function.result_contract_hash,
        "pathHash": format!("sha256:{path_hash:x}"),
    }))
}
```

The adjacent test (`exact_record_contract_rejects_extra_fields_without_echoing_values`)
correctly asserts the error must never echo the offending *value* — that's
a sound security property (don't leak a secret field's contents in an
error). But this function hashes the **path** too (e.g. `"message.secret"`
or `"conversation._version"`), and a field path is not sensitive the way a
field value is — it's the same information already visible in the
handler's own source and the declared result-contract schema. Hashing it
buys no real confidentiality and forces whoever hits this in the field to
brute-force which of their returned fields is the extra/mismatched one
(the messaging-snapback build agent had to reason it out from first
principles rather than read it off the error).

## Suggested fix shape

Emit the plaintext path (e.g. `"path": "message.reactions[0]._version"`) in
the error details alongside `resultContractHash`, while continuing to omit
the value entirely. If there's a reason paths themselves need to stay
opaque (e.g. some paths could indirectly reveal dynamic map/object keys
that are themselves sensitive, like a reaction emoji or a user-supplied
field name), that reasoning should be written down here or in a comment
next to `violation()` — as written, the hashing looks like it was applied
uniformly to "path xor value" without distinguishing that only one of the
two carries user data.

## Resolution

2026-08-05: Result-contract violations now report the legible bounded path in
`details.path` and no longer replace the whole path with `pathHash`. Declared
and closed-record field structure (including stored system fields such as
`_version`) remains visible so the refusal is actionable, while arbitrary keys
traversed inside dynamic JSON are represented only by a stable
`<unknown>#<12-hex-sha256>` segment. Tests pin the offending row/field path,
continued non-echo of values, and dynamic-key/value redaction.

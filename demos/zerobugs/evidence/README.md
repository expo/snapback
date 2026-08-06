# Provider-attempt evidence

Record one immutable receipt for each provider attempt. Receipts are
append-only evidence: once written, they are not edited or replaced.

Name JSON receipts `<arm>.<gate>.<attempt>.json`, where `arm` identifies the
provider implementation, `gate` identifies the ZB acceptance gate, and
`attempt` is a stable attempt identifier such as `v1`, `v2`, and so on.

The first attempt remains immutable under the LLP 0138 evidence rule. A
remediation creates the next attempt receipt; it never overwrites the failed
or incomplete attempt. If an attempt is recorded as Markdown instead of JSON,
it follows the same immutable, one-artifact rule; machine-readable receipts use
the JSON naming convention above.

Receipts must not contain secrets, bearer values, or unredacted sensitive
runtime data.

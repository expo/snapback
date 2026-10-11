# Language — E_ID_REUSED

E_ID_REUSED means the request ID already belongs to another operation or
different arguments. For example, retrying an invitation with the same ID
but a different email changes its intent. To collect or retry the original,
keep its operation, ID and raw arguments exactly; for a new invitation,
use a new ID. Explicit null and an omitted optional argument are different
raw inputs even when validation gives them the same value. See `guide
actions` for durable invocation collection and `guide writes` for mutations.
Over HTTP it is a 200 `{state: "failed", why: {code: "E_ID_REUSED"}}` from
`/m/<op>`; the JS client refuses the same reuse locally, before sending, as
`E_WRITE_ID_REUSE`.

The recorded body is the replay body, with value-free diagnostic messages
and no `result` or `current`. Retries return only
execution identity (`sent`/`failed`, `seq`/`why`, `replayed`), withholding
historical `result` and `current`, including scalar results after a lost reply.

The at-most-once record stores the replay body, with value-free diagnostic
messages and no `result` or `current`. Replay returns
execution identity only, with `replayed: true`; historical `result` and
`current` are withheld, including after revocation or a dropped response.
The same operation id under another principal has no access to that receipt.
`delete` keeps its own existing rule and behavior.

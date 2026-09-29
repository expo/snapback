# Presence: optional loading reasons need a separate publication audit

Status: Open
Scope: Snapback 4 client
Related: LLP 3000.031 §1.1

The required presence contract is implemented without optional `loading.reason`.
The existing loading arm covers first acquisition, speculative withholding,
expiry, revalidation withdrawal, transport failures and publication races.
Attaching `acquiring` to every local loading result would mislabel later
withholding; attaching `pending` requires preserving a current queue predicate
through every withdrawal path, including facades and native admissions.

Follow up with a scoped audit and tests for those paths. Expose only
`acquiring` or `pending` when local facts establish them; omit a reason
otherwise. Never expose speculative provenance or rule causes. This is status
text and must not become an action or routing control channel.

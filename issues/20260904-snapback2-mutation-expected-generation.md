# snapback2: atomically bind mutation requests to an expected generation

**Opened:** 2026-09-04 · **Systems:** LLP 1002 wire, owner mutation admission, `snapback2/client`

Asset substitution currently has a descriptor fence: the SDK re-reads the
manifest after uploads and refuses an observed generation change, but a hot
successor can still land between that check and the unbound `{ op, args }`
mutation request. The owner correctly validates the substituted asset records
against whichever generation is live when the request arrives (LLP 1006 §6),
so this is not an asset-validation bypass; it is a missing atomic generation
expectation on the LLP 1002 mutation wire.

Proposal: extend `POST /api/mutation` with an `expectedGeneration` field and
have the sole owner compare it with the live generation in the same admitted
action that resolves the operation and validates arguments. A mismatch must
refuse before the program runs or writes. Specify the refusal envelope, raw
wire compatibility posture, hot-successor race tests, and client retry/non-
retry behavior in LLP 1002 before implementing it. Do not describe the current
descriptor fence as providing this atomic guarantee.

# snapback2: an online client's query during a hot maintain regroup refuses `E_OFFLINE_STATE`

**Filed:** 2026-09-10 (lane `succ`, LLP 1020 A3/A8.2)
**Area:** `snapback2/packages/snapback2/src` (the twin's delivery commit), not the owner

## Observation

Under load (compiler gates and owner tests running beside the package test), a
client that stayed **online** while the owner installed a regrouping successor
(`maintain counts: by sender → by recipient`, `packages/snapback2/tests/real-owner-successor.test.ts`,
"positional reads compile after a regroup …") answered its next
`client.query(api.ops.count, { who })` with:

```
{"state":"refused","code":"E_OFFLINE_STATE","family":"offline",
 "message":"E_SCHEMA: missing index components counts.bySender",
 "guide":"offline","site":"client.query.commit",
 "rewrite":"retry this local operation; preserve queued writes and inspect the reported state error if it repeats"}
```

The same test passes when run alone (2/2), and deterministically once the client
goes `offline()` before the install and `online()` after it (LLP 1012's reset
path), which is what the test now does.

## Why it matters

LLP 1012 revision (h) says a delivery under another generation or schema "is not
held and supersedes the coverage, so offline reads are `hydrating` until the next
resume's reset". Here the twin instead tried to commit the new generation's
answer against the held predecessor schema (whose `counts` index is `bySender`)
and refused the read. A builder's app that is open during a day-two regroup sees
a refusal rather than a hydrating read.

## To reproduce

Remove the `client.offline()` line the test now carries and run the package
test file beside `scripts/test.sh`'s Rust half; the refusal appears within a few
runs. A deterministic reproduction needs a hook between the successor
installation and the client's next live frame.

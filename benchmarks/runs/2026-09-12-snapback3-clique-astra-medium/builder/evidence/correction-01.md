Initial browser acceptance failed m1-a03 waiting for /unique|duplicate|conflict/i. The UI displayed only E_CONSTRAINT. A direct S3 mutation probe returned:

```
code: E_CONSTRAINT
message: E_CONSTRAINT: sealed unique conflict on profiles.byHandle
rewrite: fix the rejected mutation input and retry
state: rejected
```

The application was corrected to show receipt.message before receipt.code. The next acceptance run passed m1-a03. This is one agent-error correction loop. Earlier first-pass Quarry syntax errors and FeedTabs prop mistakes were corrected before a passing typecheck or completion claim. No platform misbehavior was established by this loop.

**READY**

No material findings in `9b22e7b48` versus `0e6cebfcd`. Both prior Astra findings are addressed.

- [client.ts:1145](/Users/ccheever/clique-improvement/reviews/auth-r4/snapback2/packages/snapback2/src/client.ts:1145) releases cancelled replay and tail transport waits, allowing `drainTail` to unwind. Replacement recovery retries the unchanged envelope before later intents, preserving FIFO and ledger-backed exactly-once execution.
- The post-parsing abort checks fence delayed 401 bodies and malformed JSON before custody or snapshot effects. Valid late `me()` evidence retains its deliberate cleanup path; captured bearer and custody-generation checks still protect completed replacement custody.
- Replacement-barrier publication and waiter authority rechecks remain intact. Obsolete transport continuations cannot settle intents or advance the cancelled drain.

**Optional coverage:** Add delayed log-tail body parsing to the cancellation matrix. It uses the same protected transport wrapper, so this is nonblocking.

Static review only. Inspected the nine new regressions and expanded late-`me()` coverage; did not independently verify the reported before/after results, 181 passes, build, caps, or refs. No tests, edits, network, credentials, or other reviewer files accessed.
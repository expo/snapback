# EAS Phase 0: WfP per-dispatch CPU and subrequest limits are not enforced

**Status:** OPEN — blocks LLP 0105 P0.1 and the WfP resource-limit portion of Gate 0

## Observed

The real namespace run retained at
`demos/eas-phase0/receipts/p0.1-wfp-dispatch-namespace.json` used Cloudflare's
documented dynamic-dispatch shape:

```js
env.DISPATCHER.get(scriptName, {}, {
  limits: { cpuMs: 20, subRequests: 5 },
  outbound: { DISPATCH_CONTEXT: context },
});
```

Cloudflare accepted the dispatcher upload and the user Workers executed, but
both native limit witnesses failed:

- a handler performed a fixed 20,000,000-iteration CPU burn and returned 200
  with its checksum in 108.8 ms instead of being terminated at 20 CPU-ms;
- an action completed twelve real allowlisted `https://example.com` fetches and
  returned 200 in 3264.5 ms instead of exceeding the five-subrequest limit.

The same run proved the dispatch namespace was untrusted (`request.cf` was
undefined), read back all eight exact `HOST`-only binding envelopes, and passed
the other 21 checks. This is therefore not explained by trusted mode, a missing
user Worker, or a malformed namespace binding.

## Replacement-token rerun — 2026-08-04 local / 2026-08-05 UTC

The replacement account token was verified read-only through the account-token
verification endpoint (HTTP 200, active) without printing or retaining its
value. The same existing runner and receipt were then reused against
`eas-p0-spike-20260803` (receipt start `2026-08-05T05:21:14.731Z`). The result
reproduced exactly: 21/23 checks passed, while both documented native limits
returned 200. The earlier committed receipt measured the same CPU/subrequest
failures at 87.8 ms and 212.4 ms respectively; the replacement-token rerun
measured 108.8 ms and 3264.5 ms. Token replacement therefore did not change the
capability result.

## Impact

P0.1 remains failed and Gate 0 must not qualify the
`eas-cloudflare-wfp-v1` capability profile. A configured-but-unenforced resource
limit is a security failure under LLP 0009 and LLP 0047, not a soft launch gap.

## Next steps

1. Reproduce with Cloudflare's smallest official dispatcher example on the same
   account, without Snapback's host binding or outbound Worker.
2. Confirm whether the account entitlement/plan has a separate custom-limits
   capability and whether the runtime silently ignores unsupported options.
3. Capture a Tail Worker or Cloudflare support trace for the invocation options
   without recording credentials or application values.
4. If the minimal reproduction still ignores both limits, escalate to
   Cloudflare with the receipt timestamps and account held out-of-band.
5. Re-run the retained P0.1 runner; close this issue only when both checks fail
   closed at the requested ceilings.

## Cleanup

The run deleted its namespace and ordinary Workers. A separate read-only check
confirmed all four resource lookups return HTTP 404. The replacement-token
rerun repeated that independent check for the exact run-specific names and
namespace, again returning HTTP 404 for all four.

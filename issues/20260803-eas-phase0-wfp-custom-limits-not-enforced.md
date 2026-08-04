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
  with its checksum in 87.8 ms instead of being terminated at 20 CPU-ms;
- an action completed twelve real allowlisted `https://example.com` fetches and
  returned 200 in 212.4 ms instead of exceeding the five-subrequest limit.

The same run proved the dispatch namespace was untrusted (`request.cf` was
undefined), read back all eight exact `HOST`-only binding envelopes, and passed
the other 21 checks. This is therefore not explained by trusted mode, a missing
user Worker, or a malformed namespace binding.

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
confirmed all four resource lookups return HTTP 404.

# SB-001 protected live revocation evidence

Calibration commit: `d4d8fc21`

## Before

Command:

```sh
node tests/acceptance/require-role-live-revocation.mjs
```

The resource-membership delete committed, but the real sessions-mode handle
still held one protected row after eight seconds:

```text
Error: resource membership deletion did not terminally delete the protected query:
protected rows remain visible
1 !== 0
```

Raw WebSocket observation established that the server had already emitted the
generic declaration-bound sequence:

- an epoch-4 `quarantine` obligation at the membership commit;
- an epoch-4 `terminalDelete` resolution with an exact acknowledgement token;
- level-triggered retransmission of that same terminal truth.

The client query fence remained at the epoch-3 subscribe expectation, returned
`stale-expectation` for both frames, retained its accepted row, and recorded no
pending scope. This isolated the defect to same-incarnation authorization-epoch
currentness in the client fence, not membership capture, matching, server
rerun, denial branding, or transport delivery.

## After

Commands:

```sh
node packages/snapback-contract/query-authorization.test.mjs
node tests/acceptance/require-role-live-revocation.mjs
```

The unit conformance test reports:

```text
live query authorization fence conformance: ok
```

The real-server acceptance receipt reports PASS facts for all four generic
membership shapes:

| Scope | Change | Blank before mutation return | Terminal delete | Fresh read denied | Later delivery prevented | Exact ACK |
|---|---|---:|---:|---:|---:|---:|
| resource | delete | yes | yes | yes | yes | yes |
| resource | downgrade | yes | yes | yes | yes | yes |
| app | delete | yes | yes | yes | yes | yes |
| app | downgrade | yes | yes | yes | yes | yes |

The same run keeps an `authorityIndependent` public live query unscoped across
all four authorization events and proves it receives a later public
`live_delta`.

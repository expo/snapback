# `snapback dev --expo` can bind Metro only on `::1` while advertising `127.0.0.1`

- Status: Resolved
- Date: 2026-08-05
- Resolved: 2026-08-06
- Systems: `packages/snapback-cli`, Expo supervised development, iOS simulator
- Related: LLP 0176 G1; LLP 0181 E1;
  `demos/expo-golden-path-fixture/receipts/20260806-g1-ios-simulator.md`
- Fix commit: pending landing by the orchestrator (this task was required to
  remain uncommitted)

## Reproduction

On the fleet MacBook Air (macOS 26.5.2, Xcode 26.6, Node 24.18.0), run a clean
Expo SDK 57 fixture through:

```sh
snapback dev snapback --expo --expo-dir . --expo-platform ios --json
```

The supervisor reported Metro at `::1` while readiness advertised
`http://127.0.0.1:<port>`. IPv4 curl was refused; Expo Go then aborted while
constructing `ws://::1:<port>/inspector/network`.

The underlying cause was Expo CLI's `--localhost` listener resolving the
hostname IPv6-first on this host while Snapback's supervised route advertised
IPv4 loopback.

## Resolution

The supervisor adds `--dns-result-order=ipv4first` to Metro's inherited
`NODE_OPTIONS` while preserving existing options. The E1 integration fixture
records the effective Node options and DNS order.

The 2026-08-06 Air rerun enumerated bootstrap, backend, and Metro at
`127.0.0.1`; `curl` to the advertised Metro origin returned
`packager-status:running`; Expo Go loaded the bundle and emitted
`G1_IOS_PASS`. Final cleanup reclaimed all three listeners. The exact stream
is preserved in the related receipt.

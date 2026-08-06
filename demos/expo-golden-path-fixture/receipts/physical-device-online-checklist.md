# Manual physical-device Online receipt checklist

> **NOT A RECEIPT.** This is an opportunistic live-run checklist. No physical-
> device result or LLP 0064 capability claim follows from this file.

Use a data-capable USB cable. Do not enable Wireless Debugging, Connect via
Network, a LAN Metro listener, a public tunnel, or TCP/IP adb. Keep the host's
backend, Metro, and bootstrap listeners on `127.0.0.1`/`::1` throughout.

## Android USB — ready for an opportunistic live run

1. Plug in one unlocked Android device, enable USB debugging, accept its host
   authorization prompt, and keep Wireless Debugging off.
2. Run `adb devices -l`. The chosen row must be `device`, must not have a
   host/port or `_adb-tls-connect._tcp` serial, and should carry `usb:...` when
   the local adb version reports that field.
3. From `demos/expo-golden-path-fixture`, choose a fresh database/ready file and
   run, replacing `<USB_SERIAL>` with that exact inventory serial:

   ```sh
   node ../../packages/snapback-cli/cli.mjs dev snapback \
     --expo --expo-dir . --expo-platform android \
     --android-serial <USB_SERIAL> \
     --db .snapback/physical-android-usb.sqlite3 \
     --ready-file .snapback/physical-android-usb.ready.json \
     --email physical-android-usb@snapback.test --json
   ```

4. Retain the JSONL stream. Its `device-selected` and final readiness events
   must name the exact serial with `class: "usb"`. Final readiness must also
   show `transport: "adb-reverse"`, `bindingRouting: "port-forward"`,
   `appHost: "127.0.0.1"`, and the unchanged binding
   `source: "supervised-dev"`.
5. Verify all three `adb -s <USB_SERIAL> reverse --list` rules exactly match
   the readiness backend, Metro, and bootstrap ports. The readiness listener
   inventory must contain only loopback host addresses.
6. On the device, establish the complete LLP 0064 **Online** facts: development
   client build/launch, ordinary Sessions authority, seeded live query,
   ordinary mutation observed through that query, scoped presence, the typed
   text/image command and rendered delivery, HMR/reconnect, and truthful
   settlement/residue facts. Record product/package/OS/device identities and
   the exact source commit without bearer material.
7. Stop with SIGINT/SIGTERM. The `closed` event must report all owned arms
   reclaimed and `portForwards: 3`; a subsequent
   `adb -s <USB_SERIAL> reverse --list` must contain none of those three device
   ports. The ready file and every backend/Metro/bootstrap listener must be
   gone.
8. Only after all checks pass, write a dated Android artifact beside this file
   (for example `YYYYMMDD-physical-android-usb-online.md`) and retain its JSONL
   evidence. That artifact—not this checklist—may serve as one OS-specific LLP
   0064 Online receipt.

Use `/usr/bin/grep -F -- <issued-bearer> ...` against the bundle, source map,
Metro log, AppBinding, persistent public configuration, and readiness JSONL.
Every invocation must exit 1 (absent), matching the existing E1 leak matrix.

## iOS USB — blocked; do not produce a receipt yet

The 2026-08-06 local tool probe found that Xcode `devicectl` 518.33 has no TCP
port-forward command. `iproxy` binds a Mac-local port and forwards
host-initiated connections to an iOS service; it does not make an unmodified
iOS app's `127.0.0.1` reach a Mac loopback listener. Installing
`libimobiledevice` therefore does not satisfy this carrier.

For a connected, trusted, Developer-Mode iPhone, this preflight is expected to
refuse before starting the backend:

```sh
node ../../packages/snapback-cli/cli.mjs dev snapback \
  --expo --expo-dir . --expo-platform ios --ios-udid <IOS_UDID> --json
```

The expected code is `SNAPBACK_EXPO_IOS_USB_REVERSE_FORWARD_UNAVAILABLE`.
A `localNetwork` inventory entry instead refuses with
`SNAPBACK_EXPO_IOS_NETWORK_DEVICE_REFUSED`. Neither outcome is an Online
receipt.

Before an iOS receipt can be attempted, land a reviewed mechanism that actually
maps iOS device loopback to the three host loopback services—likely a bounded
device-side bridge—or obtain an author ruling that changes the posture. The
mechanism must then meet the same readiness, exact-forward verification,
loopback listener, application behavior, leak, and strict-reclamation facts as
the Android checklist. Only its successful dated artifact may become the
independent iOS LLP 0064 Online receipt.

---
title: Swift client
id: clients.swift
order: 2
audience: agent-first
capabilities: [clients.swift]
authorities: [llp/0064-native-client-surfaces.rfc.md, llp/0093-client-protocol-and-native-clients.rfc.md, llp/0095-client-lifecycle-and-conformance.spec.md, llp/0096-auth-profiles-for-protocol-clients.spec.md, clients/swift/SnapbackClient/Package.swift, clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift]
examples: [clients/swift/SnapbackClient]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-03
reviewed-authorities-digest: sha256:bb3cab052a509303eae2f0d0656d35af210deaa8c6a1e8c479704348b29be69f
---

# Swift client

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`clients/swift/SnapbackClient` is the first non-JavaScript proving client. It
is structured as a SwiftPM library for macOS 13+ and iOS 16+ and claims
`poll/local` and `live/local` when built and tested inside this repository. It
does not yet claim external dependency consumption, `live/hosted`, offline
`Parity`, or sender-constrained native custody.

## Dependency declaration — not supported

There is no supported SwiftPM dependency declaration for this client. The
repository root has no `Package.swift`, no consumable tagged package release,
and the conformance tests intentionally read the repository-owned fixture
corpus through `SNAPBACK_REPO_ROOT`. Do not add
`.package(url: "https://github.com/expo/snapback", ...)` to an application:
SwiftPM cannot resolve the nested proving package from that repository URL.

Use this client only from the in-repository package path. Publishing a tagged
mirror or moving a manifest to a consumable package root would be a separate
distribution change with its own fixture-resource and release evidence.

## Construct a client

Create `SnapbackClient.Configuration(baseURL:)`. For sessions mode, set
`sessionBearer` to a genuine Snapback session obtained through email-code auth
or the [supported external identity-broker seam](../auth/native-apps.md).
The client then:

- carries the bearer only in `Authorization`;
- offers `auth/rr` and `auth/live` at every exact boundary;
- omits caller-selected `userId` body auth;
- creates a stable authorization namespace per live query; and
- retries only HTTP 409 `SNAPBACK_AUTH_RESERVATION_STALE`, with a configurable
  40-attempt short-jitter budget.

Never package the server's admin token or impersonation capability in the app.

## Subscribe and receive every row lane

Call `openConnection()`, then `subscribe(function:args:)`. Start either
`startDrainLoop()` or `openLiveStream()`. `onUpdate` receives ordinary
replace/delta rows and authorization-invalidation snapshots through the same
callback.

Ordinary replace/delta lanes use a strict increasing data-version guard.
Authorization invalidation has its own exact scope/revision/ticket fence: a
first-seen satisfying snapshot can replace rows at the same data version, and
only an identical already-applied ticket is acknowledged again without
reapplying. Missing snapshot resolutions quarantine and blank the old
materialization. A `terminalDelete` resolution destroys rows, persists the
terminal fence, publishes the blank state, and ACKs without resubscribing.

## Bind app lifecycle

Call `pauseForBackground()` from the app's background/inactive transition. It
releases subscription demand, stops polling and heartbeat work, and closes the
socket while retaining the desired query specifications. Call
`resumeAfterForeground()` after the app becomes active; it reattaches the lane
and obtains fresh snapshots before resuming live publication.

If the server reports `SNAPBACK_CONNECTION_TOKEN_INVALID` after idle reaping
or grant expiry, the client discards that grant and quiesces its transports.
The next foreground attempt opens a fresh grant and re-establishes every
desired subscription; it never loops on the refused token.

These are platform-neutral methods. A SwiftUI host can map `scenePhase` to
them; UIKit can map the corresponding application notifications. Do not put
reconnect logic in individual views.

## Verify changes

From the repository root, run:

```sh
SNAPBACK_REPO_ROOT="$PWD" swift test --package-path clients/swift/SnapbackClient
```

The suite replays the committed conformance corpus and adds client-specific
coverage for invalidation apply-before-ack (including equal data versions),
terminal deletion, exact duplicate redelivery, foreground grant-loss recovery,
body-auth omission, and reservation retry exhaustion/eventual success. This is
an in-repository proof command, not a consumed-package test claim.

## Support status

Swift is the maintained proving client in this repository, not a published or
URL-consumable dependency. Kotlin and Dart implementations produced during the
Partitime clean-room run are reference evidence, not committed or published
first-party artifacts. Do not tell users to depend on any of these clients
until their packaging, ownership, and CI gates land; the
[capability index](../capabilities.md) keeps that gap explicit.

## Anti-patterns

- Do not embed admin or impersonation secrets in a native bundle.
- Do not set `userId` in sessions-mode bodies.
- Do not reconnect without fresh subscription snapshots.
- Do not ACK an unapplied authorization snapshot.
- Do not claim hosted or sender-constrained native auth from local bearer
  evidence.

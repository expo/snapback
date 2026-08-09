# Snapback clients

<!-- @ref LLP 0064#21-protocol-native-clients — maintained protocol-native artifacts prove only their exact arm, lane, and distribution evidence. -->
<!-- @ref LLP 0093#d4--the-swift-proving-client — Swift is the first-party proving implementation of the language-neutral client protocol. -->

This directory holds protocol-native client work. It is not a package root and
does not make every nested client consumable as an external dependency.

## Layout

- `swift/SnapbackClient/` is the maintained SwiftPM proving client. Its
  library, `snapback-prove` executable, and tests live under one nested Swift
  package.
- The normative cross-language schemas and conformance corpus remain in the
  repository-level `schemas/` directory; they are not bundled SwiftPM
  resources.

## Run the Swift proof in-repository

From the Snapback repository root:

```sh
SNAPBACK_REPO_ROOT="$PWD" swift test --package-path clients/swift/SnapbackClient
```

`SNAPBACK_REPO_ROOT` tells the fixture tests and proving executable where to
find `schemas/live.wire-fixtures.v1.json` and the other repository-owned
protocol artifacts. Point it at the repository root, not the Swift package
directory.

## Distribution boundary

The Swift package is an in-repository proving client, not a consumable
dependency. The Git repository root has no `Package.swift`, the project does
not publish a tagged Swift package release, and the conformance fixtures are
not package resources. Consequently, an application must not declare the
Snapback GitHub repository as a SwiftPM dependency. External distribution
requires a separately reviewed package-root, resource, versioning, and release
contract; none is claimed here.

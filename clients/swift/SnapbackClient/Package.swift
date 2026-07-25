// swift-tools-version:5.9
// Clean-room Swift proving client for the Snapback wire protocol.
// Built from LLP 0093/0094/0095 + committed schemas only (LLP 0093 D4
// discipline: the JS client was never read; divergences are spec-defect
// tickets under issues/).
import PackageDescription

let package = Package(
    name: "SnapbackClient",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "SnapbackClient", targets: ["SnapbackClient"]),
        .executable(name: "snapback-prove", targets: ["snapback-prove"]),
    ],
    targets: [
        .target(name: "SnapbackClient"),
        .executableTarget(
            name: "snapback-prove",
            dependencies: ["SnapbackClient"]
        ),
        .testTarget(
            name: "SnapbackClientTests",
            dependencies: ["SnapbackClient"]
        ),
    ]
)

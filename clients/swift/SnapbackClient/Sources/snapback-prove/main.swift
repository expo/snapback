import Foundation
import SnapbackClient
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// The P-2 proving harness (LLP 0093 D4): drives the clean-room Swift client
// against a real local server hosting the todo demo backend, proving the
// `poll/local` and `live/local` conformance tuples' acceptance flow:
//   1. subscribe returns an authoritative snapshot (snapshot-with-subscribe);
//   2. a mutation from a second connection arrives via the declared-cadence
//      drain (Lane P) and via socket push (Lane L);
//   3. explicit unsubscribe releases demand (no further delivery).
// It also replays the committed fixture corpus through the same state
// machine the networked client uses.
//
// Environment:
//   SNAPBACK_URL          server base URL (default http://127.0.0.1:4499)
//   SNAPBACK_REPO_ROOT    repo root for manifests + fixtures (default: cwd)
//   SNAPBACK_ADMIN_TOKEN  admin token; or SNAPBACK_ADMIN_TOKEN_FILE
//   SNAPBACK_PROVE_SKIP_BOOTSTRAP=1  skip the admin schema/functions/seed load

setvbuf(stdout, nil, _IONBF, 0)

struct ProveFailure: Error, CustomStringConvertible {
    var description: String
    init(_ text: String) { description = text }
}

var passCount = 0
var failCount = 0

func check(_ condition: Bool, _ label: String, detail: String = "") {
    if condition {
        passCount += 1
        print("PASS \(label)")
    } else {
        failCount += 1
        print("FAIL \(label)\(detail.isEmpty ? "" : " — \(detail)")")
    }
}

let environment = ProcessInfo.processInfo.environment
let baseURL = URL(string: environment["SNAPBACK_URL"] ?? "http://127.0.0.1:4499")!
let repoRoot = URL(fileURLWithPath: environment["SNAPBACK_REPO_ROOT"] ?? FileManager.default.currentDirectoryPath)

func adminToken() throws -> String {
    if let token = environment["SNAPBACK_ADMIN_TOKEN"], !token.isEmpty { return token }
    if let file = environment["SNAPBACK_ADMIN_TOKEN_FILE"] {
        return try String(contentsOfFile: file, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    throw ProveFailure("SNAPBACK_ADMIN_TOKEN(_FILE) not set")
}

func adminPost(path: String, bodyFile: URL? = nil, body: JSONValue? = nil) async throws -> JSONValue {
    var request = URLRequest(url: baseURL.appending(path: path))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue(try adminToken(), forHTTPHeaderField: "x-snapback-admin-token")
    if let bodyFile {
        request.httpBody = try Data(contentsOf: bodyFile)
    } else if let body {
        request.httpBody = try body.encoded()
    }
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
        throw ProveFailure("\(path): \(String(decoding: data.prefix(300), as: UTF8.self))")
    }
    return try JSONValue.parse(data)
}

final class RowBox: @unchecked Sendable {
    let lock = NSLock()
    var titles: [String] = []
    func add(_ rows: [JSONValue]) {
        lock.lock(); defer { lock.unlock() }
        titles = rows.compactMap { $0["title"]?.stringValue }
    }
    func snapshot() -> [String] {
        lock.lock(); defer { lock.unlock() }
        return titles
    }
}

// MARK: 0 — bootstrap the todo backend from the generated manifests alone

if environment["SNAPBACK_PROVE_SKIP_BOOTSTRAP"] != "1" {
    let generated = repoRoot.appending(path: "demos/todo/snapback/generated")
    _ = try await adminPost(path: "/_snapback/api/schema/load", bodyFile: generated.appending(path: "schema.manifest.json"))
    _ = try await adminPost(path: "/_snapback/api/functions/load", bodyFile: generated.appending(path: "functions.manifest.json"))
    let seed = try JSONValue.parse(Data(contentsOf: repoRoot.appending(path: "demos/todo/snapback/seed.json")))
    let reset = try await adminPost(path: "/_snapback/api/app/reset", body: .object(["seed": seed]))
    check(reset["seeded"] != nil, "bootstrap: schema+functions loaded, deterministic seed applied")
}

// MARK: 1 — fixture corpus replay (tuple-routed, LLP 0095 §2)

do {
    let corpusData = try Data(contentsOf: repoRoot.appending(path: "schemas/live.wire-fixtures.v1.json"))
    let result = try FixtureHarness(claimedTuples: ["poll/local", "live/local"]).run(corpusData: corpusData)
    for fixture in result.results where !fixture.passed {
        print("  fixture \(fixture.name): \(fixture.detail)")
    }
    check(result.failures.isEmpty, "fixtures: \(result.evaluatedCount - result.failures.count)/\(result.evaluatedCount) pass against the §1 state machine")
}

let ada = "user_ada"

// MARK: 2 — poll/local

do {
    let client = SnapbackClient(configuration: .init(baseURL: baseURL))
    let grant = try await client.openConnection()
    check(!grant.connectionToken.isEmpty, "poll/local: connection opened (grant carried by header thereafter)")
    let downgrades = await client.diagnostics.filter { $0.contains("WIRE_VERSION_DOWNGRADE") }
    // Pre-B1 servers reject the wireVersion offer as a body-decode failure;
    // LLP 0094 §0B.6 pins offerless re-open + structured diagnostic.
    check(!downgrades.isEmpty, "poll/local: legacy-server detection surfaced a structured downgrade diagnostic (pre-B1 server)")

    let subscription = try await client.subscribe(function: "listTodos", userId: ada)
    let snapshotRows = subscription.snapshot?.rows.count ?? -1
    check(snapshotRows >= 1, "poll/local: subscribe returned the authoritative snapshot (\(snapshotRows) rows)")
    check(subscription.receipt?["event"]?.stringValue == "established", "poll/local: typed subscription receipt (established) on subscribe output")

    let seen = RowBox()
    await client.onUpdate { _, rows in seen.add(rows) }
    await client.startDrainLoop()

    let writer = SnapbackClient(configuration: .init(baseURL: baseURL))
    _ = try await writer.openConnection()
    let marker = "poll-proof-\(UInt32.random(in: 0..<1_000_000))"
    let mutation = try await writer.mutate("createTodo", args: .object(["title": .string(marker)]), userId: ada)
    check(mutation.changedCount == 1 && mutation.receipt["outcome"]?.stringValue == "confirmed", "poll/local: mutation confirmed with typed receipt (version \(mutation.version))")

    // The declared cadence is 1.5 s; allow a few cycles.
    var delivered = false
    for _ in 0..<20 {
        try await Task.sleep(for: .milliseconds(500))
        if seen.snapshot().contains(marker) { delivered = true; break }
    }
    check(delivered, "poll/local: mutation from a second connection arrived via the drain within the declared cadence")

    // Explicit unsubscribe releases demand (T-UNSUB); subsequent mutations
    // must not reach this connection's outbox.
    await client.stopDrainLoop()
    let receipt = try await client.unsubscribe(function: "listTodos", subscriptionId: subscription.subscriptionId)
    check(receipt?["event"]?.stringValue == "disposed", "poll/local: unsubscribe returned the typed disposed receipt")
    _ = try await writer.mutate("createTodo", args: .object(["title": .string("post-release-\(marker)")]), userId: ada)
    try await Task.sleep(for: .milliseconds(700))
    let post = try await client.drainOnce()
    let stale = post.actions.contains(.replaceRows) || post.actions.contains(.applyDeltaById)
    check(!stale, "poll/local: explicit unsubscribe released demand (no durable delivery after release)")
}

// MARK: 3 — live/local

do {
    let client = SnapbackClient(configuration: .init(baseURL: baseURL))
    _ = try await client.openConnection()
    let subscription = try await client.subscribe(function: "listTodos", userId: ada)
    check(subscription.snapshot != nil, "live/local: snapshot-with-subscribe before socket attach (no prime race)")

    let seen = RowBox()
    await client.onUpdate { _, rows in seen.add(rows) }
    try await client.openLiveStream()

    let writer = SnapbackClient(configuration: .init(baseURL: baseURL))
    _ = try await writer.openConnection()
    let marker = "live-proof-\(UInt32.random(in: 0..<1_000_000))"
    _ = try await writer.mutate("createTodo", args: .object(["title": .string(marker)]), userId: ada)

    var delivered = false
    for _ in 0..<20 {
        try await Task.sleep(for: .milliseconds(250))
        if seen.snapshot().contains(marker) { delivered = true; break }
    }
    check(delivered, "live/local: socket push delivered the unwrapped durable envelope (offering snapback.v1 subprotocol)")

    let receipt = try await client.unsubscribe(function: "listTodos", subscriptionId: subscription.subscriptionId)
    check(receipt?["event"]?.stringValue == "disposed", "live/local: unsubscribe returned the typed disposed receipt")
    await client.closeLiveStream()
}

print("")
print("snapback-prove: \(passCount) passed, \(failCount) failed")
exit(failCount == 0 ? 0 : 1)

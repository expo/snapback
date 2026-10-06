import Foundation

@main struct JournalTests {
  static func main() throws {
    let root = URL(fileURLWithPath: CommandLine.arguments[1])
    let run = UUID().uuidString.lowercased()
    let args = ["app", "--clique-run", run]
    UserDefaults.standard.set(run, forKey: "clique-native-run")
    defer { UserDefaults.standard.removeObject(forKey: "clique-native-run") }
    let (_, journal) = try ObservationJournal.activate(arguments: args, documents: root)!
    precondition(journal.append(Data("{}\n".utf8)))
    let before = try Data(contentsOf: journal.output)
    let ordinary = try ObservationJournal.activate(arguments: ["app"], documents: root); precondition(ordinary == nil)
    let unchanged = try Data(contentsOf: journal.output); precondition(unchanged == before)
    let (_, relaunched) = try ObservationJournal.activate(arguments: args, documents: root)!
    for _ in 1...ObservationJournal.maxEvents { relaunched.append(Data("{}\n".utf8)) }
    let data = try Data(contentsOf: journal.output)
    precondition(data.count == ObservationJournal.maxEvents * 3)
    precondition(FileManager.default.fileExists(atPath: journal.output.deletingLastPathComponent().appendingPathComponent("overflow.json").path))
    let (_, afterOverflow) = try ObservationJournal.activate(arguments: args, documents: root)!
    precondition(!afterOverflow.append(Data("{}\n".utf8)))
    let stillBounded = try Data(contentsOf: journal.output); precondition(stillBounded == data)
    let (_, big) = try ObservationJournal.activate(arguments: ["app", "--clique-run", UUID().uuidString], documents: root)!
    precondition(!big.append(Data(repeating: 10, count: ObservationJournal.maxBytes + 1)))
    let oversized = try Data(contentsOf: big.output); precondition(oversized.isEmpty)

    // Capacity is reserved before writer work is scheduled. Model a writer
    // that never drains: reservations stay bounded, overflow sticks, later
    // work is refused, and no journal bytes are retained by the stalled path.
    let stalledRun = UUID().uuidString.lowercased()
    let (_, stalled) = try ObservationJournal.activate(arguments: ["app", "--clique-run", stalledRun], documents: root)!
    for _ in 0..<ObservationJournal.maxEvents { precondition(stalled.reserve(byteCount: 1)) }
    precondition(!stalled.reserve(byteCount: 1))
    precondition(!stalled.acceptingObservations)
    precondition(!stalled.reserve(byteCount: 1))
    stalled.persistOverflow()
    let stalledData = try Data(contentsOf: stalled.output)
    precondition(stalledData.isEmpty)
    precondition(FileManager.default.fileExists(atPath: stalled.output.deletingLastPathComponent().appendingPathComponent("overflow.json").path))

    // A flush acknowledgment is an atomic barrier over persisted bytes, binds
    // the active helper process, and cannot overtake an admitted append.
    let flushRun = UUID().uuidString.lowercased()
    let processNonce = UUID().uuidString.lowercased()
    let (_, flushing) = try ObservationJournal.activate(arguments: ["app", "--clique-run", flushRun], documents: root)!
    precondition(flushing.append(Data("{}\n".utf8)))
    let flushDirectory = flushing.output.deletingLastPathComponent()
    let requestNonce = UUID().uuidString.lowercased()
    let request: [String: Any] = ["protocol": "clique-native-flush/1", "runId": flushRun, "nonce": requestNonce]
    try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]).write(
      to: flushDirectory.appendingPathComponent("flush-request.json"), options: .atomic)
    precondition(flushing.reserve(byteCount: 3))
    flushing.acknowledgeFlushRequest(processNonce: processNonce)
    let acknowledgment = flushDirectory.appendingPathComponent("flush-ack.json")
    precondition(!FileManager.default.fileExists(atPath: acknowledgment.path))
    precondition(flushing.appendReserved(Data("{}\n".utf8)))
    flushing.acknowledgeFlushRequest(processNonce: processNonce)
    let ack = try JSONSerialization.jsonObject(with: Data(contentsOf: acknowledgment)) as! [String: Any]
    precondition(ack["protocol"] as? String == "clique-native-flush/1")
    precondition(ack["runId"] as? String == flushRun)
    precondition(ack["nonce"] as? String == requestNonce)
    precondition(ack["processNonce"] as? String == processNonce)
    precondition(ack["eventCount"] as? Int == 2)
    precondition(ack["byteCount"] as? Int == 6)

    // Leave the run directory writable but block only the journal leaf. The
    // sibling diagnostic marker must survive and the append must not throw.
    let ioRun = UUID().uuidString.lowercased()
    let (_, ioFailure) = try ObservationJournal.activate(arguments: ["app", "--clique-run", ioRun], documents: root)!
    try FileManager.default.removeItem(at: ioFailure.output)
    try FileManager.default.createDirectory(at: ioFailure.output, withIntermediateDirectories: false)
    precondition(!ioFailure.append(Data("{}\n".utf8)))
    let diagnostic = ioFailure.output.deletingLastPathComponent().appendingPathComponent("observer-diagnostics.json")
    let diagnosticValue = try JSONSerialization.jsonObject(with: Data(contentsOf: diagnostic)) as! [String: String]
    precondition(diagnosticValue["reason"] == "observation-journal-io")
    precondition(diagnosticValue["operation"] == "append")
    ioFailure.recordFailure(reason: "replacement-must-not-win", operation: "later")
    let stickyValue = try JSONSerialization.jsonObject(with: Data(contentsOf: diagnostic)) as! [String: String]
    precondition(stickyValue == diagnosticValue)

    let stickyRun = UUID().uuidString.lowercased()
    let stickyArgs = ["app", "--clique-run", stickyRun]
    let (_, firstProcess) = try ObservationJournal.activate(arguments: stickyArgs, documents: root)!
    firstProcess.recordFailure(reason: "observation-journal-io", operation: "append")
    let (_, secondProcess) = try ObservationJournal.activate(arguments: stickyArgs, documents: root)!
    precondition(secondProcess.diagnosticState?["reason"] == "observation-journal-io")
    precondition(!secondProcess.append(Data("{}\n".utf8)))

    print("PASS: explicit activation, prequeue caps, stalled-writer refusal, process-bound flush, sticky nonthrowing failures")
  }
}

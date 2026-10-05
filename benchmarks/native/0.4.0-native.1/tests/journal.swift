import Foundation

@main struct JournalTests {
  static func main() throws {
    let root = URL(fileURLWithPath: CommandLine.arguments[1])
    let run = UUID().uuidString.lowercased()
    let args = ["app", "--clique-run", run]
    UserDefaults.standard.set(run, forKey: "clique-native-run")
    defer { UserDefaults.standard.removeObject(forKey: "clique-native-run") }
    let (_, journal) = try ObservationJournal.activate(arguments: args, documents: root)!
    try journal.append(Data("{}\n".utf8))
    let before = try Data(contentsOf: journal.output)
    let ordinary = try ObservationJournal.activate(arguments: ["app"], documents: root); precondition(ordinary == nil)
    let unchanged = try Data(contentsOf: journal.output); precondition(unchanged == before)
    let (_, relaunched) = try ObservationJournal.activate(arguments: args, documents: root)!
    for _ in 1...ObservationJournal.maxEvents { try relaunched.append(Data("{}\n".utf8)) }
    let data = try Data(contentsOf: journal.output)
    precondition(data.count == ObservationJournal.maxEvents * 3)
    precondition(FileManager.default.fileExists(atPath: journal.output.deletingLastPathComponent().appendingPathComponent("overflow.json").path))
    let (_, afterOverflow) = try ObservationJournal.activate(arguments: args, documents: root)!
    try afterOverflow.append(Data("{}\n".utf8))
    let stillBounded = try Data(contentsOf: journal.output); precondition(stillBounded == data)
    let (_, big) = try ObservationJournal.activate(arguments: ["app", "--clique-run", UUID().uuidString], documents: root)!
    try big.append(Data(repeating: 10, count: ObservationJournal.maxBytes + 1))
    let oversized = try Data(contentsOf: big.output); precondition(oversized.isEmpty)
    print("PASS: explicit launch activation, relaunch event cap, sticky overflow and byte cap")
  }
}

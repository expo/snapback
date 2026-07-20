import Foundation

enum Backend: String, CaseIterable, Codable {
    case snapback
    case supabase
    case convex
    case sqlite

    var displayName: String {
        switch self {
        case .snapback: "Snapback"
        case .supabase: "Supabase"
        case .convex: "Convex"
        case .sqlite: "SQLite"
        }
    }
}

struct Persona: Sendable {
    let userID: String
    let name: String

    static let ada = Persona(userID: "user_ada", name: "Ada")
}

struct EventRow: Codable, Hashable, Identifiable, Sendable {
    let _id: String
    let title: String
    let emoji: String
    let description: String
    let location: String
    let startsAt: Int64
    let hostId: String
    let hostName: String
    let accent: String

    var id: String { _id }
}

struct RsvpRow: Codable, Hashable, Identifiable, Sendable {
    let _id: String
    let eventId: String
    let userId: String
    let guestName: String
    let status: String

    var id: String { _id }
}

struct PostRow: Codable, Hashable, Identifiable, Sendable {
    let _id: String
    let eventId: String
    let authorId: String
    let authorName: String
    let message: String
    let createdAt: Int64

    var id: String { _id }
}

enum RuntimeConfiguration {
    static let acceptanceMode = ProcessInfo.processInfo.arguments.contains("--acceptance")
    static let acceptanceFile = argument(named: "--acceptance-file")

    static let backend: Backend = {
        if let value = argument(named: "--backend") ?? ProcessInfo.processInfo.environment["PARTITIME_BACKEND"],
           let backend = Backend(rawValue: value.lowercased()) {
            return backend
        }
        return .sqlite
    }()

    static let gatewayURL: URL = {
        let value = argument(named: "--gateway")
            ?? ProcessInfo.processInfo.environment["PARTITIME_GATEWAY_ORIGIN"]
            ?? "http://127.0.0.1:4460"
        guard let url = URL(string: value) else {
            preconditionFailure("Invalid Partitime gateway URL: \(value)")
        }
        return url
    }()

    static func argument(named name: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else {
            return nil
        }
        return arguments[index + 1]
    }
}

func formatWhen(_ milliseconds: Int64) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "EEE, MMM d · h:mm a"
    return formatter.string(from: Date(timeIntervalSince1970: Double(milliseconds) / 1_000))
}

func statusLabel(_ status: String) -> String {
    switch status {
    case "host": "Hosting"
    case "going": "Going"
    case "maybe": "Maybe"
    case "cant": "Can't go"
    default: status
    }
}

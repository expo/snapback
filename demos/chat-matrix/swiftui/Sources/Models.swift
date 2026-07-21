import Foundation

// Mirrors demos/chat-matrix/shared/model.ts — the gateway's /rpc surface is
// the wire contract for the native cells.

enum Backend: String, CaseIterable, Identifiable, Codable, Sendable {
    case snapback, convex, supabase, sqlite
    var id: String { rawValue }
}

struct MessageRow: Codable, Identifiable, Equatable, Sendable {
    let _id: String
    let conversationId: String
    let role: String
    let content: String
    let status: String
    let createdAt: Double

    var id: String { _id }
    var isUser: Bool { role == "user" }
    var isBusy: Bool { status == "pending" || status == "streaming" }
}

struct ModelCatalog: Codable, Sendable {
    struct Entry: Codable, Identifiable, Sendable {
        let id: String
        let name: String
    }

    let featured: [String]
    let models: [Entry]
}

func conversationTitle(_ firstMessage: String) -> String {
    let trimmed = firstMessage
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .components(separatedBy: .whitespacesAndNewlines)
        .filter { !$0.isEmpty }
        .joined(separator: " ")
    return trimmed.count <= 40 ? trimmed : String(trimmed.prefix(39)) + "…"
}

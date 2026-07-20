import Foundation

struct GatewayClient: Sendable {
    let backend: Backend
    let origin: URL
    let persona: Persona

    private struct Request<Arguments: Encodable>: Encodable {
        let backend: String
        let name: String
        let args: Arguments
        let userId: String
    }

    private struct Envelope<Value: Decodable>: Decodable {
        let ok: Bool
        let value: Value?
        let error: String?
    }

    func listEvents() async throws -> [EventRow] {
        try await call(kind: "query", name: "listEvents", args: EmptyArguments())
    }

    func eventDetails(eventID: String) async throws -> [EventRow] {
        try await call(kind: "query", name: "eventDetails", args: EventArguments(eventId: eventID))
    }

    func guestList(eventID: String) async throws -> [RsvpRow] {
        try await call(kind: "query", name: "guestList", args: EventArguments(eventId: eventID))
    }

    func eventWall(eventID: String) async throws -> [PostRow] {
        try await call(kind: "query", name: "eventWall", args: EventArguments(eventId: eventID))
    }

    func rsvp(eventID: String, status: String) async throws -> String {
        try await call(
            kind: "mutate",
            name: "rsvp",
            args: RSVPArguments(eventId: eventID, guestName: persona.name, status: status)
        )
    }

    func postMessage(eventID: String, message: String) async throws -> String {
        try await call(
            kind: "mutate",
            name: "postMessage",
            args: PostArguments(
                eventId: eventID,
                authorName: persona.name,
                message: message
            )
        )
    }

    func createEvent(title: String, emoji: String, location: String, description: String) async throws -> String {
        try await call(
            kind: "mutate",
            name: "createEvent",
            args: CreateEventArguments(
                title: title,
                emoji: emoji.isEmpty ? "✨" : emoji,
                description: description,
                location: location,
                startsAt: Int64(Date().addingTimeInterval(3 * 24 * 60 * 60).timeIntervalSince1970 * 1_000),
                hostName: persona.name,
                accent: "tangerine"
            )
        )
    }

    private func call<Value: Decodable, Arguments: Encodable>(
        kind: String,
        name: String,
        args: Arguments
    ) async throws -> Value {
        var request = URLRequest(url: origin.appending(path: kind))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(
            Request(backend: backend.rawValue, name: name, args: args, userId: persona.userID)
        )

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw GatewayError(message: "Gateway returned a non-HTTP response")
        }
        let envelope = try JSONDecoder().decode(Envelope<Value>.self, from: data)
        guard (200 ..< 300).contains(http.statusCode), envelope.ok, let value = envelope.value else {
            throw GatewayError(message: envelope.error ?? "Gateway HTTP \(http.statusCode)")
        }
        return value
    }
}

private struct EmptyArguments: Encodable {}
private struct EventArguments: Encodable { let eventId: String }
private struct RSVPArguments: Encodable { let eventId: String; let guestName: String; let status: String }
private struct PostArguments: Encodable { let eventId: String; let authorName: String; let message: String }
private struct CreateEventArguments: Encodable {
    let title: String
    let emoji: String
    let description: String
    let location: String
    let startsAt: Int64
    let hostName: String
    let accent: String
}

private struct GatewayError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

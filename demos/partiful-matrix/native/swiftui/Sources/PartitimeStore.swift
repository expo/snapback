import Foundation

@MainActor
final class PartitimeStore: ObservableObject {
    enum LoadState: Equatable {
        case loading
        case ready
        case disconnected(String)
    }

    @Published private(set) var events: [EventRow] = []
    @Published private(set) var selectedEvent: EventRow?
    @Published private(set) var guests: [RsvpRow] = []
    @Published private(set) var posts: [PostRow] = []
    @Published private(set) var loadState: LoadState = .loading
    @Published private(set) var mutationError: String?
    @Published var selectedEventID: String?

    let client: GatewayClient
    private var pollingTask: Task<Void, Never>?

    init(client: GatewayClient) {
        self.client = client
    }

    func start() {
        pollingTask?.cancel()
        pollingTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                await self.refresh()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    func stop() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    func open(_ event: EventRow) async {
        selectedEventID = event.id
        selectedEvent = event
        await refresh()
    }

    func closeEvent() {
        selectedEventID = nil
        selectedEvent = nil
        guests = []
        posts = []
    }

    func respond(_ status: String) async {
        guard let eventID = selectedEventID else { return }
        do {
            mutationError = nil
            _ = try await client.rsvp(eventID: eventID, status: status)
            await refreshDetail(eventID: eventID)
        } catch {
            mutationError = error.localizedDescription
        }
    }

    func send(_ message: String) async -> Bool {
        guard let eventID = selectedEventID else { return false }
        do {
            mutationError = nil
            _ = try await client.postMessage(eventID: eventID, message: message)
            await refreshDetail(eventID: eventID)
            return true
        } catch {
            mutationError = error.localizedDescription
            return false
        }
    }

    func create(title: String, emoji: String, location: String, description: String) async -> Bool {
        do {
            mutationError = nil
            let eventID = try await client.createEvent(
                title: title,
                emoji: emoji,
                location: location,
                description: description
            )
            await refreshFeed()
            if let event = events.first(where: { $0.id == eventID }) {
                await open(event)
            }
            return true
        } catch {
            mutationError = error.localizedDescription
            return false
        }
    }

    func refresh() async {
        await refreshFeed()
        if let eventID = selectedEventID {
            await refreshDetail(eventID: eventID)
        }
    }

    func runAcceptance() async throws {
        let loadedEvents = try await client.listEvents()
        guard loadedEvents.count >= 3 else {
            throw AcceptanceError(message: "expected at least three events, received \(loadedEvents.count)")
        }
        guard loadedEvents.contains(where: { $0.id == "event_swim" }) else {
            throw AcceptanceError(message: "canonical event_swim is missing")
        }
        let details = try await client.eventDetails(eventID: "event_swim")
        guard details.first?.title == "Night Swim Radio" else {
            throw AcceptanceError(message: "event detail did not match the canonical fixture")
        }
        let initialGuests = try await client.guestList(eventID: "event_swim")
        let initialStatus = initialGuests.first(where: {
            $0.userId == client.persona.userID
        })?.status
        let targetStatus = initialStatus == "going" ? "maybe" : "going"
        _ = try await client.rsvp(eventID: "event_swim", status: targetStatus)
        let acceptedGuests = try await client.guestList(eventID: "event_swim")
        guard acceptedGuests.contains(where: {
            $0.userId == client.persona.userID && $0.status == targetStatus
        }) else {
            throw AcceptanceError(
                message: "RSVP mutation did not change \(initialStatus ?? "none") to \(targetStatus)"
            )
        }
    }

    private func refreshFeed() async {
        do {
            let next = try await client.listEvents()
            events = next
            loadState = .ready
        } catch {
            loadState = .disconnected(error.localizedDescription)
        }
    }

    private func refreshDetail(eventID: String) async {
        do {
            async let eventRows = client.eventDetails(eventID: eventID)
            async let nextGuests = client.guestList(eventID: eventID)
            async let nextPosts = client.eventWall(eventID: eventID)
            let (resolvedEvents, resolvedGuests, resolvedPosts) = try await (eventRows, nextGuests, nextPosts)
            selectedEvent = resolvedEvents.first
            guests = resolvedGuests
            posts = resolvedPosts
            loadState = .ready
        } catch {
            loadState = .disconnected(error.localizedDescription)
        }
    }
}

private struct AcceptanceError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

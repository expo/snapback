import Foundation

@MainActor
final class ChatStore: ObservableObject {
    @Published var backend: Backend
    @Published var model = "anthropic/claude-haiku-4.5"
    @Published private(set) var conversationId: String?
    @Published private(set) var messages: [MessageRow] = []
    @Published private(set) var sending = false
    @Published private(set) var lastError: String?

    let gateway = Gateway.fromEnvironment
    private var pollingTask: Task<Void, Never>?

    // SIMCTL_CHILD_CHAT_AUTODEMO=1 (or CHAT_AUTODEMO=1 on macOS) sends one
    // scripted message shortly after launch — the same headless-acceptance
    // hook the Expo app exposes as EXPO_PUBLIC_AUTODEMO.
    let autodemo = ProcessInfo.processInfo.environment["CHAT_AUTODEMO"] == "1"

    init() {
        let initial = ProcessInfo.processInfo.environment["CHAT_BACKEND"]
        backend = Backend(rawValue: initial ?? "") ?? .sqlite
    }

    func start() {
        pollingTask?.cancel()
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .milliseconds(700))
            }
        }
        if autodemo {
            Task {
                try? await Task.sleep(for: .seconds(2))
                await send("Reply with one short sentence praising the \(backend.rawValue) backend.")
            }
        }
    }

    func stop() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    func switchBackend(_ next: Backend) {
        guard next != backend else { return }
        backend = next
        newChat()
    }

    func selectModel(_ next: String) {
        model = next
        newChat()
    }

    func newChat() {
        conversationId = nil
        messages = []
        lastError = nil
    }

    func send(_ content: String) async {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !sending else { return }
        sending = true
        defer { sending = false }
        do {
            lastError = nil
            var target = conversationId
            if target == nil {
                target = try await gateway.createConversation(
                    backend: backend,
                    model: model,
                    title: conversationTitle(trimmed)
                )
                conversationId = target
            }
            _ = try await gateway.sendMessage(backend: backend, conversationId: target!, content: trimmed)
            await refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func refresh() async {
        guard let conversationId else { return }
        do {
            let rows = try await gateway.listMessages(backend: backend, conversationId: conversationId)
            // A backend switch may have raced the fetch; only apply matching rows.
            if rows.first?.conversationId ?? conversationId == conversationId {
                messages = rows
                lastError = nil
            }
        } catch {
            lastError = error.localizedDescription
        }
    }
}

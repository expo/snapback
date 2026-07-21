import SwiftUI

// The keyboard story is the SwiftUI selling point here: the composer lives in
// a bottom safeAreaInset, and iOS moves the safe area with the keyboard —
// avoidance is wholly framework-managed, no library, no measurement.

struct ChatView: View {
    @EnvironmentObject private var store: ChatStore
    @State private var draft = ""
    @State private var pickerOpen = false
    @FocusState private var composerFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            header
            messageList
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .background(Color(red: 0.957, green: 0.957, blue: 0.965))
        .sheet(isPresented: $pickerOpen) {
            ModelPickerView(current: store.model) { selected in
                store.selectModel(selected)
                pickerOpen = false
            }
        }
        .onAppear { if store.autodemo { composerFocused = true } }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                ForEach(Backend.allCases) { candidate in
                    Button(candidate.rawValue) { store.switchBackend(candidate) }
                        .buttonStyle(.plain)
                        .font(.footnote)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(store.backend == candidate ? Color.black : Color(white: 0.88))
                        .foregroundStyle(store.backend == candidate ? .white : Color(white: 0.3))
                        .clipShape(Capsule())
                        .accessibilityIdentifier("backend-\(candidate.rawValue)")
                }
            }
            HStack(spacing: 8) {
                Button { pickerOpen = true } label: {
                    Text(store.model)
                        .font(.footnote)
                        .lineLimit(1)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(.white, in: RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("model-button")
                Spacer()
                Text("built with SwiftUI")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .accessibilityIdentifier("stack-badge")
                Button("＋ New") { store.newChat() }
                    .font(.footnote.weight(.semibold))
                    .accessibilityIdentifier("new-chat")
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private var messageList: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                if store.messages.isEmpty {
                    VStack(spacing: 6) {
                        Text(store.conversationId == nil ? "Chat via \(store.backend.rawValue)" : "No messages yet")
                            .font(.callout.weight(.semibold))
                        Text("Model: \(store.model)\nSay something to start the conversation.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(24)
                }
                ForEach(store.messages) { message in
                    MessageBubble(message: message)
                }
                if let error = store.lastError {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(.horizontal, 12)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Message…", text: $draft, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...5)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.white, in: RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color(white: 0.85)))
                .focused($composerFocused)
                .onSubmit { submit() }
                .accessibilityIdentifier("composer-input")
            Button(action: submit) {
                Image(systemName: "arrow.up")
                    .font(.body.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(canSend ? Color.blue : Color.blue.opacity(0.35), in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .accessibilityIdentifier("send")
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .background(Color(red: 0.957, green: 0.957, blue: 0.965))
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !store.sending
    }

    private func submit() {
        guard canSend else { return }
        let content = draft
        draft = ""
        Task { await store.send(content) }
    }
}

struct MessageBubble: View {
    let message: MessageRow

    var body: some View {
        HStack {
            if message.isUser { Spacer(minLength: 48) }
            Group {
                if message.content.isEmpty && message.isBusy {
                    ProgressView().controlSize(.small)
                } else {
                    Text(message.content + (message.status == "streaming" ? " ▍" : ""))
                        .font(.subheadline)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(bubbleColor, in: RoundedRectangle(cornerRadius: 16))
            .foregroundStyle(message.isUser ? .white : .primary)
            if !message.isUser { Spacer(minLength: 48) }
        }
        .accessibilityIdentifier("message-\(message._id)")
    }

    private var bubbleColor: Color {
        if message.status == "error" { return Color(red: 0.99, green: 0.93, blue: 0.93) }
        return message.isUser ? .blue : .white
    }
}

struct ModelPickerView: View {
    let current: String
    let onSelect: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var catalog: ModelCatalog?
    @State private var query = ""
    @State private var loadError: String?

    private var rows: [ModelCatalog.Entry] {
        guard let catalog else { return [] }
        let trimmed = query.trimmingCharacters(in: .whitespaces).lowercased()
        if trimmed.isEmpty {
            let rest = catalog.models.filter { !catalog.featured.contains($0.id) }
            return catalog.featured.map { .init(id: $0, name: $0) } + rest
        }
        return catalog.models.filter {
            $0.id.lowercased().contains(trimmed) || $0.name.lowercased().contains(trimmed)
        }
    }

    var body: some View {
        NavigationStack {
            List(rows) { entry in
                Button {
                    onSelect(entry.id)
                } label: {
                    HStack {
                        Text(entry.id).font(.subheadline)
                        Spacer()
                        if catalog?.featured.contains(entry.id) == true {
                            Text("★").foregroundStyle(.orange)
                        }
                        if entry.id == current {
                            Image(systemName: "checkmark").foregroundStyle(.blue)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
            .searchable(text: $query, prompt: "Search models…")
            .navigationTitle("Choose a model")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .overlay {
                if let loadError {
                    Text("Model catalog unavailable: \(loadError)")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding()
                } else if catalog == nil {
                    ProgressView()
                }
            }
        }
        .task {
            do {
                catalog = try await Gateway.fromEnvironment.modelCatalog()
            } catch {
                loadError = error.localizedDescription
            }
        }
    }
}

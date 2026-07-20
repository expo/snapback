import Darwin
import SwiftUI
#if os(macOS)
import AppKit
#endif

@main
struct PartitimeApp: App {
    #if os(macOS)
    @NSApplicationDelegateAdaptor(PartitimeAppDelegate.self) private var appDelegate
    #endif

    private let client = GatewayClient(
        backend: RuntimeConfiguration.backend,
        origin: RuntimeConfiguration.gatewayURL,
        persona: .ada
    )

    var body: some Scene {
        WindowGroup {
            PartitimeRoot(client: client)
                .frame(minWidth: 360, minHeight: 640)
        }
        #if os(macOS)
        .defaultSize(width: 920, height: 780)
        #endif
    }
}

#if os(macOS)
private final class PartitimeAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        guard RuntimeConfiguration.acceptanceMode else { return }
        Task { @MainActor in
            let client = GatewayClient(
                backend: RuntimeConfiguration.backend,
                origin: RuntimeConfiguration.gatewayURL,
                persona: .ada
            )
            let store = PartitimeStore(client: client)
            do {
                try await store.runAcceptance()
                emitAcceptance("PARTITIME_ACCEPTANCE backend=\(client.backend.rawValue) result=pass")
                fflush(stdout)
                exit(0)
            } catch {
                emitAcceptance("PARTITIME_ACCEPTANCE backend=\(client.backend.rawValue) result=fail error=\(error.localizedDescription)")
                fflush(stdout)
                exit(2)
            }
        }
    }
}
#endif

private struct PartitimeRoot: View {
    @StateObject private var store: PartitimeStore

    init(client: GatewayClient) {
        _store = StateObject(wrappedValue: PartitimeStore(client: client))
    }

    var body: some View {
        Group {
            if store.selectedEventID == nil {
                FeedView(store: store)
            } else {
                EventView(store: store)
            }
        }
        .background(Color.partitimeCanvas)
        .tint(.partitimeInk)
        .task {
            store.start()
            #if os(macOS)
            return
            #else
            guard RuntimeConfiguration.acceptanceMode else { return }
            do {
                try await store.runAcceptance()
                emitAcceptance("PARTITIME_ACCEPTANCE backend=\(store.client.backend.rawValue) result=pass")
                fflush(stdout)
                exit(0)
            } catch {
                emitAcceptance("PARTITIME_ACCEPTANCE backend=\(store.client.backend.rawValue) result=fail error=\(error.localizedDescription)")
                fflush(stdout)
                exit(2)
            }
            #endif
        }
        .onDisappear { store.stop() }
    }
}

private func emitAcceptance(_ line: String) {
    print(line)
    guard let path = RuntimeConfiguration.acceptanceFile else { return }
    try? line.write(toFile: path, atomically: true, encoding: .utf8)
}

private struct FeedView: View {
    @ObservedObject var store: PartitimeStore
    @State private var showingCreate = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                BrandBar(backend: store.client.backend)
                VStack(alignment: .leading, spacing: 18) {
                    Text("SAN FRANCISCO · YOUR WEEK AHEAD")
                        .partitimeEyebrow()
                    Text("Make a plan worth\nleaving the chat for.")
                        .font(.system(size: 44, weight: .black, design: .rounded))
                        .minimumScaleFactor(0.7)
                        .accessibilityIdentifier("hero-title")
                    Text("Small gatherings, good people, no algorithmic sludge.")
                        .foregroundStyle(.secondary)
                    HStack(spacing: 12) {
                        Button("+ Make something happen") { showingCreate = true }
                            .buttonStyle(PartitimePrimaryButton())
                            .accessibilityIdentifier("new-event")
                        ConnectionBadge(state: store.loadState)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 34)

                VStack(alignment: .leading, spacing: 14) {
                    Text("\(String(format: "%02d", store.events.count)) · ON THE HORIZON")
                        .partitimeEyebrow()
                    switch store.loadState {
                    case .loading where store.events.isEmpty:
                        ProgressView("Loading the plans…")
                            .accessibilityIdentifier("feed-loading")
                    case .disconnected(let message) where store.events.isEmpty:
                        ContentUnavailableView("Could not load plans", systemImage: "wifi.exclamationmark", description: Text(message))
                            .accessibilityIdentifier("feed-error")
                    default:
                        ForEach(store.events) { event in
                            EventCard(event: event) {
                                Task { await store.open(event) }
                            }
                        }
                    }
                }
                .padding(24)
            }
        }
        .accessibilityIdentifier("partitime-feed")
        .sheet(isPresented: $showingCreate) {
            CreateEventView(store: store, isPresented: $showingCreate)
        }
    }
}

private struct BrandBar: View {
    let backend: Backend

    var body: some View {
        HStack(spacing: 10) {
            Text("p")
                .font(.headline.bold())
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(Color.partitimeOrange, in: Circle())
            Text("partitime")
                .font(.headline.weight(.black))
            Spacer()
            Text("SWIFTUI · \(backend.displayName.uppercased())")
                .partitimeEyebrow(color: .partitimeOrange)
                .accessibilityIdentifier("matrix-label")
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
        .background(.thinMaterial)
        .overlay(alignment: .bottom) { Divider() }
    }
}

private struct EventCard: View {
    let event: EventRow
    let open: () -> Void

    var body: some View {
        HStack(spacing: 16) {
            Text(event.emoji)
                .font(.system(size: 38))
                .frame(width: 82, height: 82)
                .background(Color.partitimeApricot, in: RoundedRectangle(cornerRadius: 14))
            VStack(alignment: .leading, spacing: 5) {
                Text(formatWhen(event.startsAt))
                    .partitimeEyebrow(color: .partitimeOrange)
                Text(event.title)
                    .font(.title3.weight(.black))
                    .accessibilityIdentifier("event-title-\(event.id)")
                Text(event.location)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("HOSTED BY \(event.hostName.uppercased())")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Button("View plan →", action: open)
                .buttonStyle(PartitimePrimaryButton(compact: true))
                .accessibilityIdentifier("open-\(event.id)")
        }
        .padding(16)
        .background(Color.partitimePaper, in: RoundedRectangle(cornerRadius: 18))
        .overlay { RoundedRectangle(cornerRadius: 18).stroke(Color.partitimeInk.opacity(0.13)) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("event-card-\(event.id)")
    }
}

private struct EventView: View {
    @ObservedObject var store: PartitimeStore
    @State private var draft = ""

    private var myStatus: String {
        store.guests.first(where: { $0.userId == store.client.persona.userID })?.status ?? "none"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    Button("← All plans") { store.closeEvent() }
                        .accessibilityIdentifier("back")
                    Spacer()
                    Text("SWIFTUI · \(store.client.backend.displayName.uppercased())")
                        .partitimeEyebrow(color: .partitimeOrange)
                }

                if let event = store.selectedEvent {
                    HStack(alignment: .center, spacing: 20) {
                        Text(event.emoji)
                            .font(.system(size: 58))
                            .frame(width: 112, height: 112)
                            .background(.white.opacity(0.25), in: Circle())
                        VStack(alignment: .leading, spacing: 8) {
                            Text("\(formatWhen(event.startsAt)) · HOSTED BY \(event.hostName.uppercased())")
                                .partitimeEyebrow()
                            Text(event.title)
                                .font(.system(size: 38, weight: .black, design: .rounded))
                                .accessibilityIdentifier("event-title")
                            Text(event.description)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(24)
                    .background(Color.partitimeApricot, in: RoundedRectangle(cornerRadius: 22))

                    VStack(alignment: .leading, spacing: 6) {
                        Text("MEET HERE").partitimeEyebrow()
                        Text(event.location).font(.title2.weight(.black))
                    }
                } else {
                    ProgressView("Loading the plan…")
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("WHO'S IN").partitimeEyebrow()
                    if myStatus == "host" {
                        Text("You're hosting this one ✦")
                            .padding(10)
                            .background(Color.partitimeSage, in: RoundedRectangle(cornerRadius: 10))
                            .accessibilityIdentifier("my-rsvp-host")
                    } else {
                        HStack {
                            RSVPButton(title: "Going", status: "going", selected: myStatus == "going", store: store)
                            RSVPButton(title: "Maybe", status: "maybe", selected: myStatus == "maybe", store: store)
                            RSVPButton(title: "Can't", status: "cant", selected: myStatus == "cant", store: store)
                        }
                    }
                    Text("Your RSVP: \(statusLabel(myStatus))")
                        .font(.caption.weight(.bold))
                        .accessibilityIdentifier("my-rsvp-\(myStatus)")
                    ForEach(store.guests) { guest in
                        HStack {
                            Text(guest.guestName).fontWeight(.semibold)
                            Spacer()
                            Text(statusLabel(guest.status)).font(.caption).foregroundStyle(.secondary)
                        }
                        .accessibilityIdentifier("guest-\(guest.userId)")
                    }
                }
                .partitimePanel()

                VStack(alignment: .leading, spacing: 12) {
                    Text("THE WALL").partitimeEyebrow()
                    if store.posts.isEmpty {
                        Text("Quiet so far. Say something.").foregroundStyle(.secondary)
                    }
                    ForEach(store.posts) { post in
                        HStack(alignment: .top) {
                            Text(post.authorName).font(.caption.weight(.bold)).frame(width: 72, alignment: .leading)
                            Text(post.message)
                        }
                        Divider()
                    }
                    HStack {
                        TextField("Say something as Ada…", text: $draft)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("wall-input")
                        Button("Send ↗") {
                            let message = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !message.isEmpty else { return }
                            Task {
                                if await store.send(message) { draft = "" }
                            }
                        }
                        .buttonStyle(PartitimePrimaryButton(compact: true))
                        .accessibilityIdentifier("wall-send")
                    }
                }
                .partitimePanel()

                if let error = store.mutationError {
                    Text(error).foregroundStyle(.red).accessibilityIdentifier("mutation-error")
                }
            }
            .padding(22)
        }
        .accessibilityIdentifier("partitime-event")
    }
}

private struct RSVPButton: View {
    let title: String
    let status: String
    let selected: Bool
    @ObservedObject var store: PartitimeStore

    var body: some View {
        Button(title) { Task { await store.respond(status) } }
            .buttonStyle(PartitimeChoiceButton(selected: selected))
            .accessibilityIdentifier("rsvp-\(status)")
    }
}

private struct CreateEventView: View {
    @ObservedObject var store: PartitimeStore
    @Binding var isPresented: Bool
    @State private var title = ""
    @State private var emoji = "🪩"
    @State private var location = ""
    @State private var description = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Make something happen").font(.title.bold())
            TextField("Emoji", text: $emoji).accessibilityIdentifier("create-emoji")
            TextField("Event title", text: $title).accessibilityIdentifier("create-title")
            TextField("Location", text: $location).accessibilityIdentifier("create-location")
            TextField("Description", text: $description).accessibilityIdentifier("create-description")
            HStack {
                Button("Cancel") { isPresented = false }
                Spacer()
                Button("Send the invite ↗") {
                    Task {
                        if await store.create(title: title, emoji: emoji, location: location, description: description) {
                            isPresented = false
                        }
                    }
                }
                .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || location.trimmingCharacters(in: .whitespaces).isEmpty)
                .buttonStyle(PartitimePrimaryButton())
                .accessibilityIdentifier("create-submit")
            }
        }
        .textFieldStyle(.roundedBorder)
        .padding(24)
        .frame(minWidth: 320, idealWidth: 480)
        .accessibilityIdentifier("create-panel")
    }
}

private struct ConnectionBadge: View {
    let state: PartitimeStore.LoadState

    var body: some View {
        let text = switch state {
        case .loading: "connecting"
        case .ready: "polling · 1s"
        case .disconnected: "disconnected"
        }
        Text(text)
            .font(.caption2.monospaced().weight(.semibold))
            .foregroundStyle(state == .ready ? Color.green : Color.secondary)
            .accessibilityIdentifier("connection")
    }
}

private struct PartitimePrimaryButton: ButtonStyle {
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(compact ? .caption.weight(.bold) : .subheadline.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, compact ? 13 : 18)
            .padding(.vertical, compact ? 9 : 12)
            .background(Color.partitimeInk.opacity(configuration.isPressed ? 0.72 : 1), in: Capsule())
    }
}

private struct PartitimeChoiceButton: ButtonStyle {
    let selected: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.caption.weight(.bold))
            .foregroundStyle(selected ? .white : Color.partitimeInk)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(selected ? Color.partitimeOrange : Color.clear, in: Capsule())
            .overlay { Capsule().stroke(Color.partitimeInk.opacity(0.25)) }
    }
}

private extension View {
    func partitimeEyebrow(color: Color = .secondary) -> some View {
        font(.caption2.monospaced().weight(.bold))
            .foregroundStyle(color)
    }

    func partitimePanel() -> some View {
        padding(18)
            .background(Color.partitimePaper, in: RoundedRectangle(cornerRadius: 18))
            .overlay { RoundedRectangle(cornerRadius: 18).stroke(Color.partitimeInk.opacity(0.12)) }
    }
}

private extension Color {
    static let partitimeCanvas = Color(red: 0.956, green: 0.941, blue: 0.91)
    static let partitimePaper = Color(red: 0.985, green: 0.97, blue: 0.94)
    static let partitimeInk = Color(red: 0.09, green: 0.082, blue: 0.07)
    static let partitimeOrange = Color(red: 1, green: 0.302, blue: 0.141)
    static let partitimeApricot = Color(red: 0.965, green: 0.635, blue: 0.365)
    static let partitimeSage = Color(red: 0.86, green: 0.89, blue: 0.74)
}

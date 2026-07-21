import SwiftUI

@main
struct ChatMatrixApp: App {
    @StateObject private var store = ChatStore()

    var body: some Scene {
        WindowGroup {
            ChatView()
                .environmentObject(store)
                .task { store.start() }
        }
        #if os(macOS)
        .defaultSize(width: 480, height: 720)
        #endif
    }
}

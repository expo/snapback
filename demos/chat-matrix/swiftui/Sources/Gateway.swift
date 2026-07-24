import Foundation

// Thin client for the chat-matrix gateway's portable /rpc surface. Like the
// partiful-matrix Apple cells, every backend is reached through the gateway;
// the Expo app is where provider-native clients are compared.

struct Gateway: Sendable {
    let origin: URL

    static var fromEnvironment: Gateway {
        let raw = ProcessInfo.processInfo.environment["CHAT_GATEWAY_ORIGIN"] ?? "http://127.0.0.1:4470"
        return Gateway(origin: URL(string: raw)!)
    }

    private struct RpcRequest<Arguments: Encodable>: Encodable {
        let backend: String
        let op: String
        let args: Arguments
    }

    private struct Envelope<Value: Decodable>: Decodable {
        let ok: Bool
        let value: Value?
        let error: String?
    }

    struct GatewayError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    func modelCatalog() async throws -> ModelCatalog {
        let (data, _) = try await URLSession.shared.data(from: origin.appending(path: "models"))
        return try JSONDecoder().decode(ModelCatalog.self, from: data)
    }

    func createConversation(backend: Backend, model: String, title: String) async throws -> String {
        struct Args: Encodable { let model: String; let title: String }
        return try await rpc(backend: backend, op: "createConversation", args: Args(model: model, title: title))
    }

    func listMessages(backend: Backend, conversationId: String) async throws -> [MessageRow] {
        struct Args: Encodable { let conversationId: String }
        return try await rpc(backend: backend, op: "listMessages", args: Args(conversationId: conversationId))
    }

    func sendMessage(backend: Backend, conversationId: String, content: String) async throws -> String {
        struct Args: Encodable { let conversationId: String; let content: String }
        return try await rpc(backend: backend, op: "sendMessage", args: Args(conversationId: conversationId, content: content))
    }

    private func rpc<Value: Decodable, Arguments: Encodable>(
        backend: Backend,
        op: String,
        args: Arguments
    ) async throws -> Value {
        var request = URLRequest(url: origin.appending(path: "rpc"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(RpcRequest(backend: backend.rawValue, op: op, args: args))
        let (data, _) = try await URLSession.shared.data(for: request)
        let envelope = try JSONDecoder().decode(Envelope<Value>.self, from: data)
        guard envelope.ok, let value = envelope.value else {
            throw GatewayError(message: envelope.error ?? "\(backend.rawValue).\(op) failed")
        }
        return value
    }
}

import ExpoModulesCore
import Snapback4Device

// The device in Rust, opened once per store and reached through one JSON
// call; the JavaScript tier (`snapback4/native`) keeps the session, the
// link and the transport. Handles are small integers the module hands out.
public final class Snapback4Module: Module {
  private var devices: [Int: OpaquePointer] = [:]
  private var mediaDirectories: [Int: URL] = [:]
  private var nextHandle = 1
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("Snapback4")

    Constant("witnessLaunch") { WitnessContainer.launch }
    Function("witnessAppend") { (line: String) in try WitnessContainer.append(line) }
    Function("witnessSignaled") { (label: String) -> Bool in try WitnessContainer.signaled(label) }

    // Where an app keeps its stores: the documents directory.
    Constant("documentDirectory") {
      FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.path ?? NSTemporaryDirectory()
    }

    // Open the device's store at `path` for the backend (`GET /schema`'s
    // JSON), or on the one it kept when `backend` is nil. Throws with the
    // module's refusal when it cannot open.
    AsyncFunction("open") { (path: String, backend: String?) -> Int in
      guard let device = sb4_open(path, backend) else {
        let reason = sb4_open_reason(path, backend)
        let text = reason.map { String(cString: $0) } ?? "{\"denied\":{\"code\":\"E_STORE\",\"family\":\"store\",\"message\":\"the device did not open\"}}"
        sb4_free(reason)
        throw Snapback4OpenException(text)
      }
      self.lock.lock()
      defer { self.lock.unlock() }
      let handle = self.nextHandle
      self.nextHandle += 1
      self.devices[handle] = device
      self.mediaDirectories[handle] = URL(fileURLWithPath: path + ".media", isDirectory: true)
      return handle
    }

    // One call: `request` is JSON with an `op`; the answer is JSON.
    AsyncFunction("call") { (handle: Int, request: String) -> String in
      self.lock.lock()
      defer { self.lock.unlock() }
      guard let device = self.devices[handle] else {
        return "{\"denied\":{\"code\":\"E_INPUT\",\"family\":\"input\",\"message\":\"no device with that handle\"}}"
      }
      guard let answer = sb4_call(device, request) else {
        return "{\"denied\":{\"code\":\"E_STORE\",\"family\":\"store\",\"message\":\"the module answered nothing\"}}"
      }
      defer { sb4_free(answer) }
      return String(cString: answer)
    }

    // @ref LLP 3000.007#8 — the opener owns ordinary media in Documents
    AsyncFunction("readAsset") { (handle: Int, id: String) -> String? in
      self.lock.lock()
      defer { self.lock.unlock() }
      let file = try self.assetFile(handle, id)
      guard FileManager.default.fileExists(atPath: file.path) else { return nil }
      return try Data(contentsOf: file).map { String(format: "%02x", $0) }.joined()
    }
    AsyncFunction("writeAsset") { (handle: Int, id: String, hex: String) in
      self.lock.lock()
      defer { self.lock.unlock() }
      let file = try self.assetFile(handle, id)
      let chars = Array(hex.utf8)
      guard chars.count % 2 == 0 else { throw Snapback4OpenException("invalid media bytes") }
      var bytes = Data(capacity: chars.count / 2)
      for i in stride(from: 0, to: chars.count, by: 2) {
        guard let byte = UInt8(String(bytes: chars[i...i+1], encoding: .utf8) ?? "", radix: 16) else { throw Snapback4OpenException("invalid media bytes") }
        bytes.append(byte)
      }
      try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
      try bytes.write(to: file, options: .atomic)
    }
    AsyncFunction("removeAsset") { (handle: Int, id: String) in
      self.lock.lock()
      defer { self.lock.unlock() }
      let file = try self.assetFile(handle, id)
      if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
    Function("assetUri") { (handle: Int, id: String) -> String in
      self.lock.lock()
      defer { self.lock.unlock() }
      return try self.assetFile(handle, id).absoluteString
    }

    Function("close") { (handle: Int) in
      self.lock.lock()
      defer { self.lock.unlock() }
      self.mediaDirectories.removeValue(forKey: handle)
      if let device = self.devices.removeValue(forKey: handle) {
        sb4_close(device)
      }
    }
  }
  private func assetFile(_ handle: Int, _ id: String) throws -> URL {
    guard let directory = mediaDirectories[handle], !id.isEmpty,
      id.utf8.allSatisfy({ ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) })
    else { throw Snapback4OpenException("invalid media id or closed device") }
    return directory.appendingPathComponent(id)
  }
}

internal final class Snapback4OpenException: GenericException<String> {
  override var reason: String {
    param
  }
}

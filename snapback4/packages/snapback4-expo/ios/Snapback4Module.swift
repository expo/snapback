import ExpoModulesCore
import Snapback4Device

// The device in Rust, opened once per store and reached through one JSON
// call; the JavaScript tier (`snapback4/native`) keeps the session, the
// link and the transport. Handles are small integers the module hands out.
public final class Snapback4Module: Module {
  private var devices: [Int: OpaquePointer] = [:]
  private var mediaFiles: [Int: MediaFiles] = [:]
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
      self.mediaFiles[handle] = MediaFiles(directory: URL(fileURLWithPath: path + ".media", isDirectory: true))
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
      try self.withMedia(handle) { try $0.read(id) }
    }
    AsyncFunction("writeAsset") { (handle: Int, id: String, hex: String) in
      try self.withMedia(handle) { try $0.write(id, hex: hex) }
    }
    AsyncFunction("removeAsset") { (handle: Int, id: String) in
      try self.withMedia(handle) { try $0.remove(id) }
    }
    Function("assetUri") { (handle: Int, id: String) -> String in
      try self.withMedia(handle) { try $0.uri(id) }
    }

    Function("close") { (handle: Int) in
      self.lock.lock()
      defer { self.lock.unlock() }
      self.mediaFiles.removeValue(forKey: handle)?.close()
      if let device = self.devices.removeValue(forKey: handle) {
        sb4_close(device)
      }
    }
  }
  private func withMedia<T>(_ handle: Int, _ body: (MediaFiles) throws -> T) throws -> T {
    lock.lock()
    defer { lock.unlock() }
    guard let files = mediaFiles[handle] else { throw Snapback4OpenException("invalid media id or closed device") }
    do { return try body(files) }
    catch let failure as MediaFiles.Failure { throw Snapback4OpenException(failure.rawValue) }
  }
}

internal final class Snapback4OpenException: GenericException<String> {
  override var reason: String {
    param
  }
}

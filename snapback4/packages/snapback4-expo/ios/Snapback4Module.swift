import ExpoModulesCore
import Snapback4Device

// The device in Rust, opened once per store and reached through one JSON
// call; the JavaScript tier (`snapback4/native`) keeps the session, the
// link and the transport. Handles are small integers the module hands out.
public final class Snapback4Module: Module {
  private var devices: [Int: OpaquePointer] = [:]
  private var nextHandle = 1
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("Snapback4")

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

    Function("close") { (handle: Int) in
      self.lock.lock()
      defer { self.lock.unlock() }
      if let device = self.devices.removeValue(forKey: handle) {
        sb4_close(device)
      }
    }
  }
}

internal final class Snapback4OpenException: GenericException<String> {
  override var reason: String {
    param
  }
}

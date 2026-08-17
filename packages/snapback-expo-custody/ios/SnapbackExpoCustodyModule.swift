import ExpoModulesCore

public final class SnapbackExpoCustodyModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SnapbackExpoCustody")

    AsyncFunction("platformGrade") { () -> [String: Any] in
      snapbackExpoCustodyCore.platformGrade()
    }

    AsyncFunction("read") { (appId: String, storageKey: String) -> [String: Any] in
      snapbackExpoCustodyCore.read(appId: appId, storageKey: storageKey).value
    }

    AsyncFunction("compareAndReplace") {
      (appId: String, storageKey: String, expectedRevision: Int?, serializedRecord: String) -> [String: Any] in
      snapbackExpoCustodyCore.compareAndReplace(
        appId: appId,
        storageKey: storageKey,
        expectedRevision: expectedRevision,
        serializedRecord: serializedRecord
      )
    }
  }
}

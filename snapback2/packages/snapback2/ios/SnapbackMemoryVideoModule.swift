import ExpoModulesCore
import AVKit

public final class SnapbackMemoryVideoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SnapbackMemoryVideo")
    View(MemoryVideoView.self) {
      Events("onPlaybackStart", "onFinished", "onError")
      Prop("source") { (view: MemoryVideoView, source: String?) in view.load(source) }
    }
  }
}

final class MemoryVideoView: ExpoView {
  let onPlaybackStart = EventDispatcher()
  let onFinished = EventDispatcher()
  let onError = EventDispatcher()
  private let controller = AVPlayerViewController()
  private var source: MemoryVideoSource?
  private var status: NSKeyValueObservation?
  private var playing: NSKeyValueObservation?
  private var ended: NSObjectProtocol?
  private var background: NSObjectProtocol?
  private var started = false
  private var attached = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    controller.allowsPictureInPicturePlayback = false
    controller.showsPlaybackControls = true
    addSubview(controller.view)
    background = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification,
      object: nil, queue: .main) { [weak self] _ in self?.finish() }
  }
  override func layoutSubviews() { super.layoutSubviews(); controller.view.frame = bounds }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { attached = true }
    else if attached { finish() }
  }
  func load(_ value: String?) {
    stop()
    guard let value else { return }
    guard value.hasPrefix("data:video/mp4;base64,"),
      let comma = value.firstIndex(of: ","), let bytes = Data(base64Encoded: String(value[value.index(after: comma)...])), !bytes.isEmpty else {
      onError(["message": "invalid in-memory MP4 source"]); return
    }
    let memory = MemoryVideoSource(bytes: bytes)
    source = memory
    let asset = AVURLAsset(url: URL(string: "snapback-memory://\(UUID().uuidString)/video.mp4")!)
    asset.resourceLoader.setDelegate(memory, queue: .main)
    let item = AVPlayerItem(asset: asset)
    let player = AVPlayer(playerItem: item)
    player.allowsExternalPlayback = false
    controller.player = player
    status = item.observe(\.status, options: [.new]) { [weak self, weak item] _, _ in
      guard let self, let item, item.status == .failed else { return }
      self.onError(["message": item.error?.localizedDescription ?? "video decoder refused the source"])
      self.finish()
    }
    playing = player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
      guard let self, player.timeControlStatus == .playing, !self.started else { return }
      self.started = true; self.onPlaybackStart([:])
    }
    ended = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime,
      object: item, queue: .main) { [weak self] _ in self?.finish() }
    player.play()
  }
  private func finish() {
    guard source != nil else { return }
    stop(); onFinished([:])
  }
  private func stop() {
    status = nil; playing = nil
    if let ended { NotificationCenter.default.removeObserver(ended) }; ended = nil
    controller.player?.pause(); controller.player?.replaceCurrentItem(with: nil); controller.player = nil
    source?.clear(); source = nil; started = false
  }
  deinit {
    stop()
    if let background { NotificationCenter.default.removeObserver(background) }
  }
}

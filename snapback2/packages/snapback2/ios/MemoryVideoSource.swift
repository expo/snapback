import AVFoundation
import UniformTypeIdentifiers

// @ref LLP 1013#2-decisions — native view-once media has no file or HTTP cache path.
final class MemoryVideoSource: NSObject, AVAssetResourceLoaderDelegate {
  private var bytes: Data
  init(bytes: Data) { self.bytes = bytes }
  func clear() { bytes.resetBytes(in: bytes.startIndex..<bytes.endIndex); bytes.removeAll() }

  func resourceLoader(_ resourceLoader: AVAssetResourceLoader,
    shouldWaitForLoadingOfRequestedResource request: AVAssetResourceLoadingRequest) -> Bool {
    guard !bytes.isEmpty else {
      request.finishLoading(with: NSError(domain: "SnapbackMemoryVideo", code: 1))
      return true
    }
    if let info = request.contentInformationRequest {
      info.contentType = UTType.mpeg4Movie.identifier
      info.contentLength = Int64(bytes.count)
      info.isByteRangeAccessSupported = true
    }
    if let range = request.dataRequest {
      let offset = max(range.requestedOffset, range.currentOffset)
      guard offset >= 0 && offset <= Int64(bytes.count) else {
        request.finishLoading(with: NSError(domain: "SnapbackMemoryVideo", code: 2))
        return true
      }
      let start = Int(offset)
      let count = range.requestsAllDataToEndOfResource ? bytes.count - start : min(range.requestedLength, bytes.count - start)
      if count > 0 { range.respond(with: bytes.subdata(in: start..<(start + count))) }
    }
    request.finishLoading()
    return true
  }
}

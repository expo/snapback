import Foundation
import AVFoundation
import VideoToolbox
// Decode every actual sample, including both terminal samples. Image-generator
// requests permit returning an arbitrarily earlier frame. Python independently
// binds presentation endpoints to the retained sample timing/edit tables.
let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let semaphore = DispatchSemaphore(value: 0)
Task {
 do {
  let duration = try await asset.load(.duration).seconds
  let tracks = try await asset.loadTracks(withMediaType: .video)
  guard duration > 0, let track = tracks.first else { throw NSError(domain:"NI.video",code:1) }
  let formats = try await track.load(.formatDescriptions)
  guard formats.contains(where:{CMFormatDescriptionGetMediaSubType($0)==kCMVideoCodecType_H264}) else { throw NSError(domain:"NI.video",code:2) }
  let reader = try AVAssetReader(asset:asset)
  // Presentation-order output coalesces samples sharing a PTS. Read compressed
  // samples in decode order and decode each one, preserving the encoded count.
  let output = AVAssetReaderTrackOutput(track:track,outputSettings:nil)
  reader.add(output)
  guard reader.startReading() else { throw NSError(domain:"NI.video",code:3) }
  var session: VTDecompressionSession?
  defer { if let session { VTDecompressionSessionInvalidate(session) } }
  var frames=0
  while let sample=output.copyNextSampleBuffer() {
   let count=CMSampleBufferGetNumSamples(sample)
   // AVAssetReader also emits empty edit-boundary markers, not encoded frames.
   if count == 0 { continue }
   guard let format=CMSampleBufferGetFormatDescription(sample),
         CMFormatDescriptionGetMediaSubType(format)==kCMVideoCodecType_H264 else { throw NSError(domain:"NI.video",code:5) }
   if session == nil {
    let status=VTDecompressionSessionCreate(allocator:kCFAllocatorDefault,formatDescription:format,decoderSpecification:nil,
      imageBufferAttributes:[kCVPixelBufferPixelFormatTypeKey:kCVPixelFormatType_32BGRA] as CFDictionary,
      outputCallback:nil,decompressionSessionOut:&session)
    guard status == noErr, session != nil else { throw NSError(domain:"NI.video",code:6) }
   }
   guard let decoder=session, VTDecompressionSessionCanAcceptFormatDescription(decoder,formatDescription:format) else { throw NSError(domain:"NI.video",code:7) }
   var decoded=0
   var failed=false
   // With neither asynchronous nor temporal processing enabled, the callback
   // completes before DecodeFrame returns, even when presentation times repeat.
   let status=VTDecompressionSessionDecodeFrame(decoder,sampleBuffer:sample,flags:[],infoFlagsOut:nil) { status,flags,image,_,_ in
    if status == noErr && !flags.contains(.frameDropped) && image != nil { decoded += 1 }
    else { failed=true }
   }
   guard status == noErr && !failed && decoded == count else { throw NSError(domain:"NI.video",code:8) }
   frames += decoded
  }
  guard reader.status == .completed && frames > 0 else { throw NSError(domain:"NI.video",code:4) }
  print(String(data:try JSONSerialization.data(withJSONObject:["codec":"h264","durationSeconds":duration,"decodedFrames":frames],options:[.sortedKeys]),encoding:.utf8)!)
 } catch { fputs("invalid-video\n",stderr); exit(2) }
 semaphore.signal()
}
semaphore.wait()

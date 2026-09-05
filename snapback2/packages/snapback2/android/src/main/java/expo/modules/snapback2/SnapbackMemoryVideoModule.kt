package expo.modules.snapback2

import android.content.Context
import android.media.MediaDataSource
import android.media.MediaPlayer
import android.util.Base64
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.widget.MediaController
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher

class SnapbackMemoryVideoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SnapbackMemoryVideo")
    View(MemoryVideoView::class) {
      Events("onPlaybackStart", "onFinished", "onError")
      Prop("source") { view: MemoryVideoView, source: String? -> view.load(source) }
    }
  }
}

// @ref LLP 1013#2-decisions — MediaDataSource serves admitted bytes without a file or URL.
internal class MemorySource(private var bytes: ByteArray) : MediaDataSource() {
  @Synchronized override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
    if (position < 0) throw java.io.IOException("negative video offset")
    if (size == 0) return 0
    if (position >= bytes.size) return -1
    val count = minOf(size, bytes.size - position.toInt())
    bytes.copyInto(buffer, offset, position.toInt(), position.toInt() + count)
    return count
  }
  @Synchronized override fun getSize() = bytes.size.toLong()
  @Synchronized override fun close() { bytes.fill(0); bytes = ByteArray(0) }
}

class MemoryVideoView(context: Context, appContext: AppContext) : ExpoView(context, appContext), SurfaceHolder.Callback {
  private val onPlaybackStart by EventDispatcher()
  private val onFinished by EventDispatcher()
  private val onError by EventDispatcher()
  private val surface = SurfaceView(context)
  private var player: MediaPlayer? = null
  private var memory: MemorySource? = null
  private var prepared = false
  private var started = false
  private val controls = MediaController(context)

  init {
    addView(surface, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    surface.holder.addCallback(this)
    controls.setAnchorView(this)
    controls.setMediaPlayer(object : MediaController.MediaPlayerControl {
      override fun start() { player?.takeIf { prepared }?.start() }
      override fun pause() { player?.takeIf { prepared }?.pause() }
      override fun getDuration() = player?.takeIf { prepared }?.duration ?: 0
      override fun getCurrentPosition() = player?.takeIf { prepared }?.currentPosition ?: 0
      override fun seekTo(position: Int) { player?.takeIf { prepared }?.seekTo(position) }
      override fun isPlaying() = player?.takeIf { prepared }?.isPlaying ?: false
      override fun getBufferPercentage() = 100
      override fun canPause() = true
      override fun canSeekBackward() = true
      override fun canSeekForward() = true
      override fun getAudioSessionId() = player?.audioSessionId ?: 0
    })
    surface.setOnClickListener { if (prepared) controls.show() }
  }
  fun load(value: String?) {
    stop()
    if (value == null) return
    try {
      require(value.startsWith("data:video/mp4;base64,")) { "invalid in-memory MP4 source" }
      val bytes = Base64.decode(value.substringAfter(','), Base64.DEFAULT)
      require(bytes.isNotEmpty()) { "empty video source" }
      memory = MemorySource(bytes)
      val next = MediaPlayer()
      player = next
      next.setDataSource(memory)
      next.setOnPreparedListener {
        if (player !== it) return@setOnPreparedListener
        prepared = true
        if (surface.holder.surface.isValid) { it.setDisplay(surface.holder); it.start() }
      }
      next.setOnInfoListener { _, what, _ ->
        if (what == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START && !started) {
          started = true; onPlaybackStart(emptyMap<String, Any>())
        }; false
      }
      next.setOnCompletionListener { finish() }
      next.setOnErrorListener { _, what, extra ->
        onError(mapOf("message" to "video decoder refused the source ($what/$extra)")); finish(); true
      }
      next.prepareAsync()
    } catch (error: Exception) {
      onError(mapOf("message" to (error.message ?: "invalid video source"))); finish()
    }
  }
  override fun surfaceCreated(holder: SurfaceHolder) {
    player?.setDisplay(holder)
    if (prepared) player?.start()
  }
  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}
  override fun surfaceDestroyed(holder: SurfaceHolder) { finish() }
  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    if (visibility != View.VISIBLE) finish()
  }
  override fun onDetachedFromWindow() { finish(); super.onDetachedFromWindow() }
  private fun finish() {
    val hadSource = memory != null
    stop()
    if (hadSource) onFinished(emptyMap<String, Any>())
  }
  private fun stop() {
    controls.hide(); prepared = false; started = false
    player?.release(); player = null
    memory?.close(); memory = null
  }
}

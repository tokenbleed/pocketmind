package io.github.tokenbleed.pocketmind

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import io.github.tokenbleed.pocketmind.specs.NativeSttRecorderSpec
import java.io.File
import java.io.RandomAccessFile

/**
 * Mono 16 kHz PCM16 WAV recorder for on-device speech-to-text.
 *
 * whisper.cpp's default input is a 16 kHz mono WAV, so this records in
 * exactly that format and patches the RIFF header sizes at stop, giving
 * the transcription engine a file it can consume without any JS-side
 * transcoding. One recording at a time; [cancel] always cleans up.
 */
@ReactModule(name = NativeSttRecorderSpec.NAME)
class SttRecorderModule(reactContext: ReactApplicationContext) :
    NativeSttRecorderSpec(reactContext) {

  private val appContext = reactContext.applicationContext

  private var audioRecord: AudioRecord? = null
  private var readerThread: Thread? = null
  private var wavFile: File? = null
  private var recording = false

  override fun getName(): String = NativeSttRecorderSpec.NAME

  override fun start(promise: Promise) {
    synchronized(this) {
      if (recording) {
        promise.reject("ALREADY_RECORDING", "a recording is already active")
        return
      }
      if (
          ContextCompat.checkSelfPermission(appContext, Manifest.permission.RECORD_AUDIO) !=
              PackageManager.PERMISSION_GRANTED
      ) {
        promise.reject("PERMISSION_DENIED", "RECORD_AUDIO has not been granted")
        return
      }
      try {
        val minBuffer =
            AudioRecord.getMinBufferSize(
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (minBuffer <= 0) {
          throw IllegalStateException("AudioRecord.getMinBufferSize returned $minBuffer")
        }
        val record =
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                minBuffer * 4,
            )
        if (record.state != AudioRecord.STATE_INITIALIZED) {
          record.release()
          throw IllegalStateException("AudioRecord failed to initialize")
        }

        val dir = File(appContext.cacheDir, "stt").apply { mkdirs() }
        val file = File(dir, "recording-${System.currentTimeMillis()}.wav")
        RandomAccessFile(file, "rw").use { raf ->
          raf.setLength(0)
          raf.write(buildWavHeader(0))
        }

        record.startRecording()
        audioRecord = record
        wavFile = file
        recording = true

        readerThread =
            Thread {
              val buffer = ShortArray(minBuffer / 2)
              val byteBuf = ByteArray(buffer.size * 2)
              try {
                RandomAccessFile(file, "rw").use { raf ->
                  raf.seek(HEADER_BYTES.toLong())
                  while (isRecording()) {
                    val read = record.read(buffer, 0, buffer.size)
                    if (read <= 0) {
                      break
                    }
                    for (i in 0 until read) {
                      // Little-endian PCM16; RandomAccessFile has no
                      // writeShortLE, so unpack by hand.
                      val s = buffer[i]
                      byteBuf[i * 2] = (s.toInt() and 0xff).toByte()
                      byteBuf[i * 2 + 1] = ((s.toInt() shr 8) and 0xff).toByte()
                    }
                    raf.write(byteBuf, 0, read * 2)
                  }
                }
              } catch (_: InterruptedException) {} catch (e: Exception) {
                // Surface failures at stop(); a dead reader thread must
                // not leave `recording` stuck true.
                stopInternal()
              }
            }
        readerThread?.start()
        promise.resolve(file.absolutePath)
      } catch (e: Exception) {
        recording = false
        releaseRecord()
        wavFile?.delete()
        wavFile = null
        promise.reject("START_FAILED", e.message ?: "failed to start recording")
      }
    }
  }

  override fun stop(promise: Promise) {
    synchronized(this) {
      val file =
          wavFile
              ?: run {
                promise.reject("NOT_RECORDING", "no recording is active")
                return
              }
      val dataSize = stopInternal()
      try {
        patchHeaderSizes(file, dataSize)
      } catch (e: Exception) {
        file.delete()
        promise.reject("STOP_FAILED", e.message ?: "failed to finalize recording")
        return
      }
      promise.resolve(file.absolutePath)
    }
  }

  override fun cancel(promise: Promise) {
    synchronized(this) {
      stopInternal()
      wavFile?.delete()
      wavFile = null
      promise.resolve(null)
    }
  }

  /** Stops the reader thread and the AudioRecord; returns bytes of PCM data written. */
  private fun stopInternal(): Long {
    recording = false
    readerThread?.let { t ->
      t.interrupt()
      try {
        t.join(2000)
      } catch (_: InterruptedException) {}
    }
    readerThread = null
    val dataSize = wavFile?.let { it.length() - HEADER_BYTES } ?: 0L
    releaseRecord()
    return dataSize
  }

  private fun releaseRecord() {
    audioRecord?.let { r ->
      try {
        if (r.state == AudioRecord.STATE_INITIALIZED) {
          r.stop()
        }
      } catch (_: Exception) {}
      r.release()
    }
    audioRecord = null
  }

  private fun isRecording(): Boolean = synchronized(this) { recording }

  companion object {
    private const val SAMPLE_RATE = 16000
    private const val HEADER_BYTES = 44
    private const val TAG = "SttRecorderModule"

    /** 44-byte canonical WAV header for mono 16 kHz PCM16, data size patched later. */
    private fun buildWavHeader(dataSize: Long): ByteArray {
      val header = ByteArray(HEADER_BYTES)
      fun putInt(offset: Int, value: Int) {
        header[offset] = (value and 0xff).toByte()
        header[offset + 1] = ((value shr 8) and 0xff).toByte()
        header[offset + 2] = ((value shr 16) and 0xff).toByte()
        header[offset + 3] = ((value shr 24) and 0xff).toByte()
      }
      fun putShort(offset: Int, value: Int) {
        header[offset] = (value and 0xff).toByte()
        header[offset + 1] = ((value shr 8) and 0xff).toByte()
      }
      fun putAscii(offset: Int, s: String) {
        for (i in s.indices) header[offset + i] = s[i].code.toByte()
      }
      val totalSize = 36 + dataSize
      putAscii(0, "RIFF")
      putInt(4, totalSize.toInt())
      putAscii(8, "WAVE")
      putAscii(12, "fmt ")
      putInt(16, 16) // fmt chunk size
      putShort(20, 1) // PCM
      putShort(22, 1) // mono
      putInt(24, SAMPLE_RATE)
      putInt(28, SAMPLE_RATE * 2) // byte rate
      putShort(32, 2) // block align
      putShort(34, 16) // bits per sample
      putAscii(36, "data")
      putInt(40, dataSize.toInt())
      return header
    }

    private fun patchHeaderSizes(file: File, dataSize: Long) {
      RandomAccessFile(file, "rw").use { raf ->
        raf.seek(4)
        writeIntLE(raf, (36 + dataSize).toInt())
        raf.seek(40)
        writeIntLE(raf, dataSize.toInt())
      }
    }

    private fun writeIntLE(raf: RandomAccessFile, value: Int) {
      raf.write(value and 0xff)
      raf.write((value shr 8) and 0xff)
      raf.write((value shr 16) and 0xff)
      raf.write((value shr 24) and 0xff)
    }
  }
}

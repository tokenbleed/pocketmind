package com.pocketpal

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.pocketpal.specs.NativeApiServerSpec
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import fi.iki.elonen.NanoHTTPD.ResponseException
import fi.iki.elonen.NanoHTTPD.Response.Status
import java.io.IOException
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.nio.charset.StandardCharsets
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** Shared ownership of the live server so the module and the
 *  foreground service can both tear it down. Idempotent. */
internal object ApiServerHolder {
  @Volatile var server: LocalApiServer? = null
    private set

  fun start(server: LocalApiServer) {
    shutdown()
    this.server = server
  }

  fun shutdown() {
    server?.stop()
    server = null
  }
}

/**
 * OpenAI-compatible HTTP server on top of NanoHTTPD.
 *
 * The routing surface is deliberately tiny: OPTIONS preflights, GET
 * /v1/models, and POST /v1/chat/completions. Anything else, wrong
 * methods, bodies over MAX_BODY_BYTES, and requests missing the
 * configured bearer key are answered natively without waking JS.
 * Valid requests are forwarded to JS as `apiServerRequest` events and
 * the response streams back through the module's respond methods.
 */
class LocalApiServer
internal constructor(
    port: Int,
    private val bindAll: Boolean,
    private val apiKey: String,
    private val emit: (id: String, method: String, path: String, body: String) -> Unit,
) : NanoHTTPD(if (bindAll) null else "127.0.0.1", port) {

  companion object {
    const val EVENT = "apiServerRequest"
    const val MAX_BODY_BYTES = 2L * 1024 * 1024
    private const val RESPONSE_DEADLINE_MS = 10L * 60 * 1000
  }

  /** What serve() hands NanoHTTPD once JS commits to a response shape. */
  private sealed interface Draft {
    data class Json(val status: Status, val body: String) : Draft
    data class Stream(val pipe: PipedInputStream) : Draft
  }

  private class Pending {
    val first = CompletableFuture<Draft>()
    var writer: PipedOutputStream? = null
    val dead = AtomicBoolean(false)
  }

  private val nextId = AtomicLong(1)
  private val pending = ConcurrentHashMap<String, Pending>()
  // Single writer thread: respondStreamChunk is called on the RN module
  // thread and must never block on a stalled client.
  private val writer = Executors.newSingleThreadExecutor { r ->
    Thread(r, "api-server-writer").apply { isDaemon = true }
  }

  private fun cors(response: Response): Response {
    response.addHeader("Access-Control-Allow-Origin", "*")
    response.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    response.addHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
    response.addHeader("Cache-Control", "no-cache")
    return response
  }

  private fun json(status: Status, body: String): Response =
      cors(newFixedLengthResponse(status, "application/json", body))

  private fun errorBody(message: String): String =
      "{\"error\":{\"message\":\"" +
          message.replace("\\", "\\\\").replace("\"", "\\\"") +
          "\",\"type\":\"api_error\"}}"

  private fun statusFor(code: Int): Status =
      when (code) {
        200 -> Status.OK
        400 -> Status.BAD_REQUEST
        401 -> Status.UNAUTHORIZED
        404 -> Status.NOT_FOUND
        405 -> Status.METHOD_NOT_ALLOWED
        429 -> Status.TOO_MANY_REQUESTS
        503 -> Status.SERVICE_UNAVAILABLE
        else -> Status.INTERNAL_ERROR
      }

  override fun serve(session: IHTTPSession): Response {
    val method = session.method
    val path = session.uri

    if (method == Method.OPTIONS) {
      return cors(newFixedLengthResponse(Status.NO_CONTENT, "text/plain", ""))
    }

    // Path and verb allowlist before anything touches JS.
    val known =
        (method == Method.GET && path == "/v1/models") ||
            (method == Method.POST && path == "/v1/chat/completions")
    if (!known) {
      val routed = path == "/v1/models" || path == "/v1/chat/completions"
      return json(
          if (routed) Status.METHOD_NOT_ALLOWED else Status.NOT_FOUND,
          errorBody("unknown route ${method.name} $path"))
    }

    // Bearer gate, when a key is configured.
    if (apiKey.isNotEmpty()) {
      val auth = session.headers["authorization"] ?: ""
      if (auth != "Bearer $apiKey") {
        return json(Status.UNAUTHORIZED, errorBody("missing or invalid API key"))
      }
    }

    var body = ""
    if (method == Method.POST) {
      val declared = session.headers["content-length"]?.toLongOrNull() ?: 0L
      if (declared > MAX_BODY_BYTES) {
        return json(Status.PAYLOAD_TOO_LARGE, errorBody("request body too large"))
      }
      val files = HashMap<String, String>()
      try {
        session.parseBody(files)
      } catch (e: IOException) {
        return json(Status.BAD_REQUEST, errorBody("malformed request body"))
      } catch (e: ResponseException) {
        return json(e.status, errorBody("malformed request body"))
      }
      body = files["postData"] ?: ""
      if (body.toByteArray(StandardCharsets.UTF_8).size > MAX_BODY_BYTES) {
        return json(Status.PAYLOAD_TOO_LARGE, errorBody("request body too large"))
      }
    }

    val id = nextId.getAndIncrement().toString()
    val req = Pending()
    pending[id] = req
    emit(id, method.name, path, body)

    return try {
      when (val draft = req.first.get(RESPONSE_DEADLINE_MS, TimeUnit.MILLISECONDS)) {
        is Draft.Json -> json(draft.status, draft.body)
        is Draft.Stream ->
            cors(newChunkedResponse(Status.OK, "text/event-stream", draft.pipe))
      }
    } catch (e: java.util.concurrent.TimeoutException) {
      pending.remove(id)
      json(Status.INTERNAL_ERROR, errorBody("handler did not respond"))
    } catch (e: Exception) {
      pending.remove(id)
      json(Status.INTERNAL_ERROR, errorBody("handler failed"))
    }
  }

  // ---- JS-driven response plumbing -------------------------------------

  internal fun respond(id: String, status: Int, body: String) {
    val req = pending.remove(id) ?: return
    req.dead.set(true)
    req.first.complete(Draft.Json(statusFor(status), body))
  }

  internal fun streamChunk(id: String, data: String) {
    val req = pending[id] ?: return
    val bytes = data.toByteArray(StandardCharsets.UTF_8)
    synchronized(req) {
      val out = req.writer
      if (out == null) {
        if (req.dead.get() || req.first.isDone) {
          return
        }
        val pipeOut = PipedOutputStream()
        val pipeIn = PipedInputStream(pipeOut, 64 * 1024)
        req.writer = pipeOut
        req.first.complete(Draft.Stream(pipeIn))
      }
    }
    writer.execute {
      try {
        val out = req.writer ?: return@execute
        if (!req.dead.get()) {
          out.write(bytes)
          out.flush()
        }
      } catch (e: IOException) {
        // Client went away mid-stream; stop touching this request.
        req.dead.set(true)
      }
    }
  }

  internal fun streamEnd(id: String) {
    val req = pending.remove(id) ?: return
    synchronized(req) {
      if (req.writer == null && !req.first.isDone) {
        // Empty stream: complete with an immediately-closed pipe.
        val pipeOut = PipedOutputStream()
        val pipeIn = PipedInputStream(pipeOut, 16)
        req.writer = pipeOut
        req.first.complete(Draft.Stream(pipeIn))
        try {
          pipeOut.close()
        } catch (e: IOException) {}
        req.dead.set(true)
        return
      }
    }
    writer.execute {
      try {
        req.writer?.let {
          it.flush()
          it.close()
        }
      } catch (e: IOException) {}
      req.dead.set(true)
    }
  }

  internal fun streamFail(id: String, status: Int, message: String) {
    val req = pending.remove(id) ?: return
    synchronized(req) {
      if (req.first.isDone) {
        // Headers already sent; the best we can do is drop the stream.
        writer.execute {
          try {
            req.writer?.close()
          } catch (e: IOException) {}
          req.dead.set(true)
        }
      } else {
        req.dead.set(true)
        req.first.complete(Draft.Json(statusFor(status), errorBody(message)))
      }
    }
  }

  internal fun shutdown() {
    pending.forEach { (_, req) ->
      req.dead.set(true)
      if (!req.first.isDone) {
        req.first.complete(
            Draft.Json(Status.INTERNAL_ERROR, errorBody("server stopped")))
      }
      try {
        req.writer?.close()
      } catch (e: IOException) {}
    }
    pending.clear()
    writer.shutdownNow()
  }

  override fun stop() {
    shutdown()
    super.stop()
  }

  fun boundAddress(): String {
    val port = listeningPort
    return if (bindAll) "0.0.0.0:$port" else "127.0.0.1:$port"
  }
}

@ReactModule(name = NativeApiServerSpec.NAME)
class ApiServerModule(private val reactContext: ReactApplicationContext) :
    NativeApiServerSpec(reactContext) {

  override fun start(port: Double, bindAll: Boolean, apiKey: String, promise: Promise) {
    val portNum = port.toInt()
    if (bindAll && apiKey.isEmpty()) {
      promise.reject(
          "ECONFIG",
          "binding on all interfaces requires an API key; set one or keep loopback-only")
      return
    }
    ApiServerHolder.server?.let { existing ->
      promise.resolve(existing.boundAddress())
      return
    }
    val server =
        LocalApiServer(portNum, bindAll, apiKey) { id, method, path, body ->
          val params = Arguments.createMap()
          params.putString("id", id)
          params.putString("method", method)
          params.putString("path", path)
          params.putString("body", body)
          reactContext
              .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
              .emit(LocalApiServer.EVENT, params)
        }
    try {
      server.start(1_000, false)
    } catch (e: IOException) {
      promise.reject(
          "EBIND", "could not bind port $portNum (it may already be in use): ${e.message}")
      return
    }
    ApiServerHolder.start(server)

    val intent =
        Intent(reactContext, ApiServerService::class.java)
            .putExtra(ApiServerService.EXTRA_ADDRESS, server.boundAddress())
            .putExtra(
                ApiServerService.EXTRA_SCOPE,
                if (bindAll) "device and LAN" else "this device")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      reactContext.startForegroundService(intent)
    } else {
      reactContext.startService(intent)
    }

    promise.resolve(server.boundAddress())
  }

  override fun stop(promise: Promise) {
    reactContext.stopService(Intent(reactContext, ApiServerService::class.java))
    ApiServerHolder.shutdown()
    promise.resolve(null)
  }

  override fun respond(id: String, status: Double, body: String) {
    ApiServerHolder.server?.respond(id, status.toInt(), body)
  }

  override fun respondStreamChunk(id: String, data: String) {
    ApiServerHolder.server?.streamChunk(id, data)
  }

  override fun respondStreamEnd(id: String) {
    ApiServerHolder.server?.streamEnd(id)
  }

  override fun respondStreamFail(id: String, status: Double, message: String) {
    ApiServerHolder.server?.streamFail(id, status.toInt(), message)
  }
}

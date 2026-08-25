package com.pocketpal

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import androidx.documentfile.provider.DocumentFile
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.pocketpal.specs.NativeSafFsSpec
import java.io.ByteArrayOutputStream

/**
 * Storage Access Bridge native side (see src/specs/NativeSafFs.ts).
 *
 * All operations resolve `relPath` one segment at a time under the
 * user-granted tree URI via DocumentFile.findFile, which walks content
 * URIs only - a '..' or absolute segment simply never matches a child
 * name, so nothing outside the granted tree is reachable even if the
 * JS-side jail is bypassed.
 */
@ReactModule(name = NativeSafFsSpec.NAME)
class SafFsModule(reactContext: ReactApplicationContext) :
    NativeSafFsSpec(reactContext) {

  override fun getName(): String = NativeSafFsSpec.NAME

  // --- path resolution ---------------------------------------------------

  /** Split a jailed relative path into clean segments; null when the
   *  path tries anything that cannot name a plain child ("..", absolute,
   *  empty/dot segments after trimming, excessive depth). */
  private fun segments(relPath: String): List<String>? {
    if (relPath.isEmpty()) return emptyList()
    if (relPath.contains('\u0000')) return null
    val parts = relPath.split('/')
    if (parts.size > MAX_DEPTH) return null
    val out = ArrayList<String>(parts.size)
    for (part in parts) {
      if (part.isEmpty() || part == "." || part == "..") return null
      if (part.length > 255) return null
      out.add(part)
    }
    return out
  }

  /** Control-flow carrier for native-path rejections; must be a Throwable
   *  so Kotlin catch clauses can intercept it. */
  private class Reject(val code: String, override val message: String) :
      Exception(message)

  /** Walk all but the last segment under the tree root (the last segment
   *  is the leaf the caller names). resolveParents=false throws ENOENT on
   *  the first missing child, resolveParents=true creates missing
   *  directories (write path only). Returns the parent document plus the
   *  clean segments. Throws Reject. */
  private fun resolve(
      treeUri: Uri,
      relPath: String,
      resolveParents: Boolean,
      context: Context
  ): Pair<DocumentFile, List<String>> {
    val segs = segments(relPath) ?: throw Reject(EINVAL, "invalid path: $relPath")
    var dir = DocumentFile.fromTreeUri(context, treeUri)
        ?: throw Reject(EINVAL, "not a tree uri: $treeUri")
    var i = 0
    while (i < segs.size - 1) {
      val child = dir.findFile(segs[i])
      if (child == null) {
        if (!resolveParents) {
          throw Reject(ENOENT, "no such file or directory: $relPath")
        }
        dir = dir.createDirectory(segs[i])
            ?: throw Reject(EIO, "failed to create directory: ${segs[i]}")
      } else if (!child.isDirectory) {
        throw Reject(ENOTDIR, "not a directory: $segs[i] in $relPath")
      } else {
        dir = child
      }
      i++
    }
    return Pair(dir, segs)
  }

  private fun treeOrNull(raw: String): Uri? =
      try {
        val uri = Uri.parse(raw)
        if (DocumentsContract.getTreeDocumentId(uri) != null) uri else null
      } catch (e: Exception) {
        null
      }

  // --- entry shaping -----------------------------------------------------

  private fun entryMap(doc: DocumentFile): WritableMap {
    val map = Arguments.createMap()
    map.putString("name", doc.name ?: "")
    map.putString("uri", doc.uri.toString())
    map.putBoolean("isDir", doc.isDirectory)
    map.putDouble("size", doc.length().toDouble())
    val mtime = doc.lastModified()
    if (mtime > 0) map.putDouble("mtime", mtime.toDouble()) else map.putNull("mtime")
    return map
  }

  private fun statMap(doc: DocumentFile?): WritableMap {
    val map = Arguments.createMap()
    if (doc == null) {
      map.putBoolean("exists", false)
      map.putBoolean("isDir", false)
      map.putDouble("size", 0.0)
      map.putNull("mtime")
    } else {
      map.putBoolean("exists", true)
      map.putBoolean("isDir", doc.isDirectory)
      map.putDouble("size", doc.length().toDouble())
      val mtime = doc.lastModified()
      if (mtime > 0) map.putDouble("mtime", mtime.toDouble()) else map.putNull("mtime")
    }
    return map
  }

  // --- spec methods ------------------------------------------------------

  override fun stat(treeUri: String, relPath: String, promise: Promise) {
    try {
      val tree = treeOrNull(treeUri) ?: return promise.reject(EINVAL, "invalid tree uri")
      val (parent, segs) = resolve(tree, relPath, false, reactApplicationContext)
      val leaf = segs.lastOrNull()?.let { parent.findFile(it) } ?: parent
      promise.resolve(statMap(leaf))
    } catch (e: Reject) {
      if (e.code == EACCES) promise.reject(EACCES, e.message) else promise.resolve(statMap(null))
    } catch (e: SecurityException) {
      promise.reject(EACCES, "grant revoked for tree")
    } catch (e: Exception) {
      promise.resolve(statMap(null))
    }
  }

  override fun listDir(treeUri: String, relPath: String, promise: Promise) {
    try {
      val tree = treeOrNull(treeUri) ?: return promise.reject(EINVAL, "invalid tree uri")
      val (parent, segs) = resolve(tree, relPath, false, reactApplicationContext)
      val dir = segs.lastOrNull()?.let { parent.findFile(it) } ?: parent
      if (!dir.isDirectory) {
        return promise.reject(ENOTDIR, "not a directory: $relPath")
      }
      val out: WritableArray = Arguments.createArray()
      dir.listFiles()
          .sortedBy { it.name?.lowercase() ?: "" }
          .forEach { out.pushMap(entryMap(it)) }
      promise.resolve(out)
    } catch (e: Reject) {
      promise.reject(e.code, e.message)
    } catch (e: SecurityException) {
      promise.reject(EACCES, "grant revoked for tree")
    } catch (e: Exception) {
      promise.reject("EIO", e.message ?: "listDir failed")
    }
  }

  override fun readFile(
      treeUri: String,
      relPath: String,
      maxBytes: Double,
      promise: Promise
  ) {
    try {
      val tree = treeOrNull(treeUri) ?: return promise.reject(EINVAL, "invalid tree uri")
      val (parent, segs) = resolve(tree, relPath, false, reactApplicationContext)
      if (segs.isEmpty()) return promise.reject(EISDIR, "path is the tree root")
      val file = parent.findFile(segs.last())
          ?: return promise.reject(ENOENT, "no such file: $relPath")
      if (file.isDirectory) return promise.reject(EISDIR, "is a directory: $relPath")
      val cap = maxBytes.toLong().coerceAtLeast(1L)
      val resolver = reactApplicationContext.contentResolver
      val buffer = ByteArrayOutputStream(minOf(cap, 1 shl 20).toInt())
      resolver.openInputStream(file.uri).use { input ->
        if (input == null) return promise.reject(ENOENT, "cannot open: $relPath")
        val chunk = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
          val n = input.read(chunk)
          if (n < 0) break
          total += n
          if (total > cap) {
            return promise.reject(EFBIG, "file exceeds the read cap: $relPath")
          }
          buffer.write(chunk, 0, n)
        }
      }
      promise.resolve(String(buffer.toByteArray(), Charsets.UTF_8))
    } catch (e: Reject) {
      promise.reject(e.code, e.message)
    } catch (e: SecurityException) {
      promise.reject(EACCES, "grant revoked for tree")
    } catch (e: Exception) {
      promise.reject("EIO", e.message ?: "readFile failed")
    }
  }

  override fun writeFile(
      treeUri: String,
      relPath: String,
      content: String,
      append: Boolean,
      promise: Promise
  ) {
    try {
      val tree = treeOrNull(treeUri) ?: return promise.reject(EINVAL, "invalid tree uri")
      val (parent, segs) = resolve(tree, relPath, true, reactApplicationContext)
      if (segs.isEmpty()) return promise.reject(EISDIR, "cannot write the tree root")
      val name = segs.last()
      val existing = parent.findFile(name)
      val target: DocumentFile
      val mode: String
      if (existing != null) {
        if (existing.isDirectory) {
          return promise.reject(EISDIR, "is a directory: $relPath")
        }
        target = existing
        mode = if (append) "wa" else "w"
      } else {
        target =
            parent.createFile(mimeFor(name), name)
                ?: return promise.reject(EIO, "failed to create: $name")
        mode = "w"
      }
      val bytes = content.toByteArray(Charsets.UTF_8)
      if (bytes.size > MAX_WRITE_BYTES) {
        return promise.reject(EFBIG, "content exceeds the write cap")
      }
      reactApplicationContext.contentResolver.openOutputStream(target.uri, mode).use { out ->
        if (out == null) return promise.reject(EIO, "cannot open for write: $relPath")
        out.write(bytes)
        out.flush()
      }
      promise.resolve(null)
    } catch (e: Reject) {
      promise.reject(e.code, e.message)
    } catch (e: SecurityException) {
      promise.reject(EACCES, "grant is read-only or revoked")
    } catch (e: Exception) {
      promise.reject("EIO", e.message ?: "writeFile failed")
    }
  }

  private fun mimeFor(name: String): String {
    val lower = name.substringAfterLast('.', "").lowercase()
    return when (lower) {
      "txt", "md", "markdown", "log", "csv", "json", "xml", "yml", "yaml",
      "ts", "tsx", "js", "jsx", "py", "rb", "go", "rs", "java", "kt", "c",
      "h", "cpp", "hpp", "sh", "html", "css", "ini", "conf", "toml" -> "text/plain"
      else -> "application/octet-stream"
    }
  }

  companion object {
    private const val EINVAL = "EINVAL"
    private const val ENOENT = "ENOENT"
    private const val EISDIR = "EISDIR"
    private const val ENOTDIR = "ENOTDIR"
    private const val EACCES = "EACCES"
    private const val EFBIG = "EFBIG"
    private const val EIO = "EIO"
    private const val MAX_DEPTH = 32
    private const val MAX_WRITE_BYTES = 1024 * 1024 // JS enforces the real 256KB cap
  }
}

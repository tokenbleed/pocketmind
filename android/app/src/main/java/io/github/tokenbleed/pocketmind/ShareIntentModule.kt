package io.github.tokenbleed.pocketmind

import android.content.Intent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import io.github.tokenbleed.pocketmind.specs.NativeShareIntentSpec

/**
 * Share-intent holder + module (see src/specs/NativeShareIntent.ts).
 *
 * The holder is written by MainActivity on ACTION_SEND / PROCESS_TEXT
 * (cold start and warm relaunch) and drained exactly once by the JS
 * router through [takePendingText]. The event emission is a poke only:
 * it carries no text, so delivery is at-most-once no matter how the
 * emission races the JS listener.
 */
object ShareIntentHolder {
    /** Cap on parked text; a share larger than this is truncated, not
     *  dropped, so the user still gets the leading content. */
    const val MAX_TEXT = 64 * 1024

    @Volatile
    private var pendingText: String? = null

    /**
     * Park share text from an intent. Returns true when the intent was
     * a usable share carrying non-blank text.
     */
    fun capture(intent: Intent?): Boolean {
        if (intent == null) return false
        val text = when (intent.action) {
            Intent.ACTION_SEND ->
                if (intent.type == "text/plain") {
                    intent.getStringExtra(Intent.EXTRA_TEXT)
                } else {
                    null
                }
            Intent.ACTION_PROCESS_TEXT ->
                if (intent.type == "text/plain") {
                    intent.getStringExtra(Intent.EXTRA_PROCESS_TEXT)
                } else {
                    null
                }
            else -> null
        } ?: return false
        val trimmed = text.trim().take(MAX_TEXT)
        if (trimmed.isEmpty()) return false
        pendingText = trimmed
        return true
    }

    /** Return and clear the parked text. */
    fun take(): String? {
        val text = pendingText
        pendingText = null
        return text
    }
}

@ReactModule(name = NativeShareIntentSpec.NAME)
class ShareIntentModule(reactContext: ReactApplicationContext) :
    NativeShareIntentSpec(reactContext) {

  override fun getName(): String = NativeShareIntentSpec.NAME

  override fun takePendingText(promise: Promise) {
      promise.resolve(ShareIntentHolder.take())
  }
}

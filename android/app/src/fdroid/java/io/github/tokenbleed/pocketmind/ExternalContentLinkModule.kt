package io.github.tokenbleed.pocketmind

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import io.github.tokenbleed.pocketmind.specs.NativeExternalContentLinkSpec

/**
 * Blob- and proprietary-SDK-free stand-in for the Play Billing
 * ExternalContentLinkModule, used by the fdroid flavor.
 *
 * The external-content-links program only exists on Google Play, so this
 * variant always reports ineligible/absent. The JS store layer treats a
 * false availability probe as fail-closed and renders the info-text
 * fallback instead of a checkout button, which is the correct UX off
 * Play. No billing client is linked, so the fdroid APK carries no
 * proprietary Google libraries.
 */
@ReactModule(name = NativeExternalContentLinkSpec.NAME)
class ExternalContentLinkModule(reactContext: ReactApplicationContext) :
    NativeExternalContentLinkSpec(reactContext) {

  override fun getName(): String = NativeExternalContentLinkSpec.NAME

  override fun prepareExternalLink(checkoutUrl: String, promise: Promise) {
    promise.resolve(outcomeMap(OUTCOME_INELIGIBLE))
  }

  override fun isExternalContentLinkAvailable(promise: Promise) {
    promise.resolve(false)
  }

  override fun reportExternalContentLink(
      purchaseId: String,
      token: String,
      promise: Promise
  ) {
    // Nothing to report without Play Billing; never throws, mirrors the
    // no-op semantics of the Play implementation.
    promise.resolve(null)
  }

  private fun outcomeMap(outcome: String): WritableMap {
    val map = Arguments.createMap()
    map.putString("outcome", outcome)
    return map
  }

  companion object {
    private const val OUTCOME_INELIGIBLE = "ineligible"
  }
}

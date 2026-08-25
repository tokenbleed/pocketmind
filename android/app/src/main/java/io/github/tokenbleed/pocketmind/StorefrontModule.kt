package io.github.tokenbleed.pocketmind

import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import io.github.tokenbleed.pocketmind.specs.NativeStorefrontSpec
import java.util.Locale

@ReactModule(name = NativeStorefrontSpec.NAME)
class StorefrontModule(reactContext: ReactApplicationContext) :
    NativeStorefrontSpec(reactContext) {

  override fun getName(): String = NativeStorefrontSpec.NAME

  override fun getCountryCode(promise: Promise) {
    try {
      val countryCode = Locale.getDefault().country
      promise.resolve(countryCode.ifEmpty { null })
    } catch (e: Exception) {
      promise.reject("ERROR", e.message)
    }
  }
}

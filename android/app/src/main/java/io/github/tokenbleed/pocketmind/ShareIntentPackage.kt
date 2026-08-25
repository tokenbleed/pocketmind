package io.github.tokenbleed.pocketmind

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import io.github.tokenbleed.pocketmind.specs.NativeShareIntentSpec

class ShareIntentPackage : TurboReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == NativeShareIntentSpec.NAME) {
      ShareIntentModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    return ReactModuleInfoProvider {
      mapOf(
          NativeShareIntentSpec.NAME to ReactModuleInfo(
              NativeShareIntentSpec.NAME,
              NativeShareIntentSpec.NAME,
              false, // canOverrideExistingModule
              false, // needsEagerInit
              false, // hasConstants
              false, // isCxxModule
              true   // isTurboModule
          )
      )
    }
  }
}

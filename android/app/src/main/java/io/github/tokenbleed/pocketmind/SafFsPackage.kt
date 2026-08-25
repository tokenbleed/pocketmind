package io.github.tokenbleed.pocketmind

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import io.github.tokenbleed.pocketmind.specs.NativeSafFsSpec

class SafFsPackage : TurboReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == NativeSafFsSpec.NAME) {
      SafFsModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    return ReactModuleInfoProvider {
      mapOf(
          NativeSafFsSpec.NAME to ReactModuleInfo(
              NativeSafFsSpec.NAME,
              NativeSafFsSpec.NAME,
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

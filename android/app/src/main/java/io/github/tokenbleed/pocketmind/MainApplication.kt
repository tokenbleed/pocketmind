package io.github.tokenbleed.pocketmind

import android.app.Application
import android.system.Os
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import io.github.tokenbleed.pocketmind.KeepAwakePackage
import io.github.tokenbleed.pocketmind.HardwareInfoPackage
import io.github.tokenbleed.pocketmind.StorefrontPackage
import io.github.tokenbleed.pocketmind.AuthSessionPackage
import io.github.tokenbleed.pocketmind.ExternalContentLinkPackage
import io.github.tokenbleed.pocketmind.PdfTextPackage
import io.github.tokenbleed.pocketmind.SafFsPackage
import io.github.tokenbleed.pocketmind.ShareIntentPackage
import io.github.tokenbleed.pocketmind.download.DownloadPackage

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
              add(KeepAwakePackage())
              add(HardwareInfoPackage())
              add(StorefrontPackage())
              add(AuthSessionPackage())
              add(ExternalContentLinkPackage())
              add(PdfTextPackage())
              add(ForegroundServicePackage())
              add(SafFsPackage())
              add(ApiServerPackage())
              add(ShareIntentPackage())
              add(DownloadPackage())
            }

        override fun getJSMainModuleName(): String = "index"

        // Independent of BuildConfig.DEBUG: releaseE2e is `debuggable=true`
        // for `adb run-as` but must still load the baked bundle, not from
        // a locally-running Metro server.
        override fun getUseDeveloperSupport(): Boolean = BuildConfig.USE_DEV_SUPPORT

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    migrateLegacyDbFiles()
    // Enable Adreno large buffer support on Qualcomm A7X/A8X GPUs.
    // The OpenCL backend in llama.rn self-gates on GPU family and the
    // cl_qcom_large_buffer extension - this is a no-op on non-Adreno devices.
    // Must be set before SoLoader.init so the native library picks it up.
    // See: https://github.com/ggml-org/llama.cpp/pull/20997
    Os.setenv("LM_GGML_OPENCL_ADRENO_USE_LARGE_BUFFER", "1", true)
    // pdfbox-android fonts/assets must be initialized before first use.
    com.tom_roush.pdfbox.android.PDFBoxResourceLoader.init(applicationContext)
    SoLoader.init(this, OpenSourceMergedSoMapping)
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      load()
    }
  }

  /**
   * One-time rename of the WatermelonDB files from the pre-rebrand name
   * (`pocketpalai.db`, at the app data root) to `pocketmind.db`. Watermelon's
   * JSI layer opens the file at getDatabasePath(name) with the `/databases`
   * segment stripped, i.e. the app data root, so the rename must land there
   * and before any JS runs. Idempotent: skips when the new file exists; old
   * files are only removed by renameTo itself (atomic per file).
   */
  private fun migrateLegacyDbFiles() {
    try {
      // /data/user/0/<pkg>/databases/x.db -> parent twice = app data root
      val dbRoot = getDatabasePath("placeholder.db").parentFile?.parentFile ?: return
      for (suffix in listOf("", "-wal", "-shm")) {
        val oldFile = java.io.File(dbRoot, "pocketpalai.db$suffix")
        val newFile = java.io.File(dbRoot, "pocketmind.db$suffix")
        if (oldFile.exists() && !newFile.exists()) {
          if (!oldFile.renameTo(newFile)) {
            android.util.Log.w("PocketMind", "legacy db rename failed for pocketpalai.db$suffix")
          }
        }
      }
    } catch (e: Exception) {
      android.util.Log.w("PocketMind", "legacy db migration skipped", e)
    }
  }
}

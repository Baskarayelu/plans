package xyz.oxoplans.nativeutil

import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.util.Log
import java.io.File
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Small native helpers for Plans:
 * - logLine(tag, message): writes to logcat under a fixed tag (PLANS_PRF for the passkey probe),
 *   so the lead can read probe results with `adb logcat -s PLANS_PRF`.
 * - deviceInfo(): Android version, model and the configured credential / autofill provider
 *   (Settings.Secure "credential_service" on Android 14+, "autofill_service" otherwise).
 * - shareImage(contentUri, text, title): the Android share sheet with an image AND a line of text
 *   (the settle-up card plus its link). The content:// URI comes from expo-file-system's provider.
 * - saveImage(path, name): copies a PNG into Pictures/Plans through MediaStore (Android 10+, no
 *   storage permission needed). Returns false on older Android so JS can fall back to sharing.
 */
class PlansNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PlansNative")

    Function("logLine") { tag: String, message: String ->
      val t = if (tag.length > 23) tag.substring(0, 23) else tag
      // logcat truncates long lines; split into chunks.
      var i = 0
      while (i < message.length) {
        val end = minOf(message.length, i + 3000)
        Log.i(t, message.substring(i, end))
        i = end
      }
      true
    }

    AsyncFunction("shareImage") { contentUri: String, text: String, title: String ->
      val activity = appContext.currentActivity ?: throw IllegalStateException("No activity")
      val uri = Uri.parse(contentUri)
      val send = Intent(Intent.ACTION_SEND)
      send.type = "image/png"
      send.putExtra(Intent.EXTRA_STREAM, uri)
      send.putExtra(Intent.EXTRA_TEXT, text)
      send.clipData = ClipData.newRawUri(title, uri)
      send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      val chooser = Intent.createChooser(send, title)
      chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      activity.startActivity(chooser)
      true
    }

    AsyncFunction("saveImage") { path: String, name: String ->
      val ctx = appContext.reactContext ?: throw IllegalStateException("No context")
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        false
      } else {
        val src = File(if (path.startsWith("file://")) Uri.parse(path).path ?: path else path)
        val resolver = ctx.contentResolver
        val values = ContentValues()
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name)
        values.put(MediaStore.MediaColumns.MIME_TYPE, "image/png")
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Plans")
        values.put(MediaStore.MediaColumns.IS_PENDING, 1)
        val target = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
          ?: throw IllegalStateException("Couldn't create the image")
        resolver.openOutputStream(target).use { out ->
          if (out == null) throw IllegalStateException("Couldn't write the image")
          src.inputStream().use { input -> input.copyTo(out) }
        }
        val done = ContentValues()
        done.put(MediaStore.MediaColumns.IS_PENDING, 0)
        resolver.update(target, done, null, null)
        true
      }
    }

    Function("deviceInfo") {
      val ctx = appContext.reactContext
      val resolver = ctx?.contentResolver
      fun secure(key: String): String? = try {
        if (resolver == null) null else Settings.Secure.getString(resolver, key)
      } catch (e: Throwable) {
        null
      }
      fun pkgVersion(pkg: String): String? = try {
        ctx?.packageManager?.getPackageInfo(pkg, 0)?.versionName
      } catch (e: Throwable) {
        null
      }
      mapOf(
        "sdkInt" to Build.VERSION.SDK_INT,
        "release" to Build.VERSION.RELEASE,
        "model" to Build.MODEL,
        "manufacturer" to Build.MANUFACTURER,
        "fingerprint" to Build.FINGERPRINT,
        "credentialService" to secure("credential_service"),
        "credentialServicePrimary" to secure("credential_service_primary"),
        "autofillService" to secure("autofill_service"),
        "gmsVersion" to pkgVersion("com.google.android.gms"),
        "isEmulator" to (Build.FINGERPRINT.contains("generic") || Build.MODEL.contains("sdk_gphone") || Build.HARDWARE.contains("ranchu"))
      )
    }
  }
}

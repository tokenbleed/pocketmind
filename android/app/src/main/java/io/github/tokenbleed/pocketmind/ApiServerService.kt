package io.github.tokenbleed.pocketmind

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground service that keeps the process (and with it the JS router
 * driving LocalApiServer) alive while the local API server is serving,
 * so backgrounded operation survives. The HTTP server itself is owned
 * by ApiServerModule/ApiServerHolder; this class owns only the
 * notification.
 */
class ApiServerService : Service() {

  companion object {
    const val CHANNEL_ID = "api_server"
    const val NOTIFICATION_ID = 0x4150
    const val EXTRA_ADDRESS = "address"
    const val EXTRA_SCOPE = "scope"

    fun buildNotification(context: Context, address: String, scope: String): Notification {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm?.getNotificationChannel(CHANNEL_ID) == null) {
          val channel =
              NotificationChannel(
                  CHANNEL_ID, "Local API server", NotificationManager.IMPORTANCE_LOW)
          channel.description = "Local OpenAI-compatible API server status"
          channel.setShowBadge(false)
          nm?.createNotificationChannel(channel)
        }
      }
      val contentIntent =
          PendingIntent.getActivity(
              context,
              0,
              Intent(context, MainActivity::class.java).addFlags(
                  Intent.FLAG_ACTIVITY_SINGLE_TOP),
              PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      return NotificationCompat.Builder(context, CHANNEL_ID)
          .setSmallIcon(R.drawable.ic_stat_agent)
          .setContentTitle("Local API server")
          .setContentText("http://$address ($scope)")
          .setOngoing(true)
          .setOnlyAlertOnce(true)
          .setSilent(true)
          .setContentIntent(contentIntent)
          .setCategory(NotificationCompat.CATEGORY_SERVICE)
          .build()
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val address = intent?.getStringExtra(EXTRA_ADDRESS) ?: "127.0.0.1:0"
    val scope = intent?.getStringExtra(EXTRA_SCOPE) ?: "this device"
    val notification = buildNotification(this, address, scope)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_STICKY
  }

  override fun onDestroy() {
    ApiServerHolder.shutdown()
    super.onDestroy()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // The JS runtime is gone; the router cannot answer anything.
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }
}

package expo.modules.otopolyliveupdates

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Display-ready content for one job, built in JS (translations and formatting stay there). */
class JobLiveUpdate : Record {
  /** "34 ABC 123 · Ahmet Yılmaz" */
  @Field val title: String = ""

  /** "İşlem devam ediyor · Renault Clio" */
  @Field val text: String = ""

  /** Business name, shown in the header. */
  @Field val subText: String = ""

  /** 0 = in progress, 1 = ready for pickup, 2 = delivered / finished. */
  @Field val stage: Int = 0

  /** Status chip text while ready ("Hazır"); while in progress the chip shows the elapsed time. */
  @Field val chipText: String = ""

  /** Epoch ms the job started; drives the chronometer. */
  @Field val startedAt: Double = 0.0

  /** Deep link opened on tap. */
  @Field val url: String = ""

  /** False for the final "delivered / cancelled" post: dismissible and auto-removed. */
  @Field val ongoing: Boolean = true

  /** Localised channel name, shown in system notification settings. */
  @Field val channelName: String = "Live job tracking"
}

/**
 * Android counterpart of the iOS job Live Activity.
 *
 * Posts one ongoing notification per job with NotificationCompat.ProgressStyle. On Android 16+ it asks
 * to be promoted to a Live Update (status bar chip, pinned at the top of the shade and Lock Screen);
 * older versions show it as a regular ongoing notification with a progress bar.
 */
class OtopolyLiveUpdatesModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  private val manager: NotificationManagerCompat
    get() = NotificationManagerCompat.from(context)

  override fun definition() = ModuleDefinition {
    Name("OtopolyLiveUpdates")

    /** Whether notifications can be shown at all (POST_NOTIFICATIONS granted, app not blocked). */
    Function("areNotificationsEnabled") {
      manager.areNotificationsEnabled()
    }

    /** Whether posts can appear as Live Updates (Android 16+ and the user has not turned them off). */
    Function("canPostPromoted") {
      Build.VERSION.SDK_INT >= 36 && manager.canPostPromotedNotifications()
    }

    /** Posts or replaces the notification for [jobId]; false when notifications are disabled. */
    Function("post") { jobId: String, update: JobLiveUpdate ->
      if (!manager.areNotificationsEnabled()) return@Function false
      ensureChannel(update.channelName)
      try {
        manager.notify(tag(jobId), NOTIFICATION_ID, build(jobId, update))
        true
      } catch (_: SecurityException) {
        false
      }
    }

    Function("end") { jobId: String ->
      manager.cancel(tag(jobId), NOTIFICATION_ID)
    }

    /** Job ids with a notification still showing (survives app restarts, like ActivityKit instances). */
    Function("activeJobIds") {
      manager.activeNotifications
        .filter { it.id == NOTIFICATION_ID && it.tag?.startsWith(TAG_PREFIX) == true }
        .filter { (it.notification.flags and Notification.FLAG_ONGOING_EVENT) != 0 }
        .map { it.tag.removePrefix(TAG_PREFIX) }
    }
  }

  private fun build(jobId: String, update: JobLiveUpdate): Notification {
    val stage = update.stage.coerceIn(0, 2)
    // Work segment, then the wait for pickup; points mark "ready" and "delivered".
    val style = NotificationCompat.ProgressStyle()
      .setStyledByProgress(true)
      .setProgressSegments(
        listOf(
          NotificationCompat.ProgressStyle.Segment(WORK_LENGTH).setColor(BRAND),
          NotificationCompat.ProgressStyle.Segment(PICKUP_LENGTH).setColor(READY)
        )
      )
      .setProgressPoints(
        listOf(
          NotificationCompat.ProgressStyle.Point(WORK_LENGTH).setColor(READY),
          NotificationCompat.ProgressStyle.Point(WORK_LENGTH + PICKUP_LENGTH).setColor(DONE)
        )
      )
      .setProgress(
        when (stage) {
          0 -> WORK_LENGTH / 2
          1 -> WORK_LENGTH
          else -> WORK_LENGTH + PICKUP_LENGTH
        }
      )

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.otopoly_live_update_icon)
      .setColor(BRAND)
      .setContentTitle(update.title)
      .setContentText(update.text)
      .setSubText(update.subText.ifBlank { null })
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setOngoing(update.ongoing)
      .setAutoCancel(!update.ongoing)
      .setRequestPromotedOngoing(update.ongoing)
      .setStyle(style)
      .setContentIntent(openIntent(jobId, update.url))

    if (stage == 0 && update.startedAt > 0) {
      builder.setWhen(update.startedAt.toLong()).setShowWhen(true).setUsesChronometer(true)
    } else {
      builder.setShowWhen(false)
      if (update.chipText.isNotBlank()) builder.setShortCriticalText(update.chipText)
    }
    if (!update.ongoing) builder.setTimeoutAfter(FINISHED_TIMEOUT_MS)
    return builder.build()
  }

  private fun openIntent(jobId: String, url: String): PendingIntent? {
    val intent = if (url.isNotBlank()) {
      Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName)
    } else {
      context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      jobId.hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  private fun ensureChannel(name: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val system = context.getSystemService(NotificationManager::class.java) ?: return
    val existing = system.getNotificationChannel(CHANNEL_ID)
    if (existing != null && existing.name == name) return
    // Re-creating an existing channel only updates its name; importance stays what the user chose.
    // LOW: no sound or heads-up for every update, but still allowed to be promoted (MIN is not).
    system.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
      }
    )
  }

  private fun tag(jobId: String) = TAG_PREFIX + jobId

  private companion object {
    const val CHANNEL_ID = "otopoly-live-jobs"
    const val TAG_PREFIX = "otopoly.job:"
    const val NOTIFICATION_ID = 7301
    const val WORK_LENGTH = 70
    const val PICKUP_LENGTH = 30
    const val FINISHED_TIMEOUT_MS = 15 * 60 * 1000L
    val BRAND = 0xFFEA6E43.toInt()
    val READY = 0xFF2563EB.toInt()
    val DONE = 0xFF15803D.toInt()
  }
}

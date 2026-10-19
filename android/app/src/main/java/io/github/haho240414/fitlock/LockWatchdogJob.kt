package io.github.haho240414.fitlock

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * 15분마다: 잠금이 켜져 있는데 서비스가 죽어 있으면(삼성 등 절전이 앱을 멈춤) 다시 켠다.
 * 다시 켜는 게 막히면(배터리 제한 때문에 백그라운드에서 못 켬) '눌러서 다시 켜기' 알림 — 하루 한 번.
 */
class LockWatchdogJob : JobService() {
    override fun onStartJob(params: JobParameters?): Boolean {
        if (LockPrefs.enabled(this) && !LockService.running) {
            try {
                LockService.start(this)
                Log.i(TAG, "service restarted")
            } catch (e: Exception) {
                Log.w(TAG, "restart blocked", e)
                notifyStopped(this)
            }
        }
        return false
    }

    override fun onStopJob(params: JobParameters?): Boolean = false

    companion object {
        private const val TAG = "FitLockWatchdog"
        private const val JOB_ID = 4201
        private const val NOTIF_ID = 3

        fun schedule(ctx: Context) {
            val js = ctx.getSystemService(JobScheduler::class.java) ?: return
            if (js.getPendingJob(JOB_ID) != null) return
            val job = JobInfo.Builder(JOB_ID, ComponentName(ctx, LockWatchdogJob::class.java))
                .setPeriodic(15 * 60_000L)
                .setPersisted(true)
                .build()
            try { js.schedule(job) } catch (e: Exception) { Log.w(TAG, "schedule", e) }
        }

        fun cancel(ctx: Context) {
            ctx.getSystemService(JobScheduler::class.java)?.cancel(JOB_ID)
        }

        @SuppressLint("MissingPermission")
        fun notifyStopped(ctx: Context) {
            val p = LockPrefs.prefs(ctx)
            val today = LockPrefs.dayKey()
            if (p.getString("stoppedWarnDay", "") == today) return
            p.edit().putString("stoppedWarnDay", today).apply()
            LockService.createChannels(ctx)
            val open = PendingIntent.getActivity(
                ctx, 2, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val n = NotificationCompat.Builder(ctx, LockService.CHANNEL_ALERT)
                .setSmallIcon(R.drawable.ic_stat_fitlock)
                .setContentTitle("운동 잠금이 멈췄어요")
                .setContentText("폰이 절전으로 핏락을 멈췄어요. 눌러서 다시 켜기 (배터리 '제한 없음'이면 덜 멈춰요)")
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            try { NotificationManagerCompat.from(ctx).notify(NOTIF_ID, n) } catch (_: SecurityException) {}
        }
    }
}

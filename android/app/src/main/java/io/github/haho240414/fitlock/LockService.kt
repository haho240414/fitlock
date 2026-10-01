package io.github.haho240414.fitlock

import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 잠금을 켜 두면 계속 도는 서비스(상단 알림에 오늘 기록·상태를 보여준다).
 * 화면 꺼짐·켜짐 방송은 매니페스트로는 못 받아서, 이 서비스가 실행 중일 때 등록해 듣는다.
 *
 * 화면이 꺼지는 순간 '잠글 때'면 운동 화면(LockActivity)을 미리 띄워 둔다 → 화면을 켜면 바로 보인다.
 * (잠금화면 위에 띄우는 건 '다른 앱 위에 표시' 권한이 있어야 백그라운드에서 화면을 열 수 있다 — 안드로이드 10+)
 * 카메라·센서는 서비스에서 절대 켜지 않는다. 운동 화면이 보일 때 그 화면이 켠다.
 */
class LockService : Service() {
    private lateinit var places: PlaceChecker
    private val handler = Handler(Looper.getMainLooper())
    private var receiver: BroadcastReceiver? = null
    private var pendingLock = false
    private val refreshTick = Runnable { refreshDecision() }

    override fun onCreate() {
        super.onCreate()
        running = true
        places = PlaceChecker(this)
        createChannels(this)
        goForeground()
        registerScreen()
        if (LockDecider.placesConfig(this).first != null) places.startPassive()
        refreshDecision()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // startForegroundService 로 불렸으면 5초 안에 startForeground 해야 한다
        goForeground()
        if (intent?.action == ACTION_STOP || !LockPrefs.enabled(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (LockDecider.placesConfig(this).first != null) places.startPassive() else places.stopPassive()
        refreshDecision()
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        handler.removeCallbacksAndMessages(null)
        receiver?.let { try { unregisterReceiver(it) } catch (_: Exception) {} }
        receiver = null
        places.stopPassive()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun goForeground() {
        try {
            val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
            ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(this, lastDecision), type)
        } catch (e: Exception) {
            // 백그라운드에서 다시 켜질 때 막힐 수 있다(안드로이드 12+). 앱을 열면 다시 켠다
            Log.w(TAG, "startForeground", e)
        }
    }

    private fun registerScreen() {
        val r = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                when (i.action) {
                    Intent.ACTION_SCREEN_OFF -> onScreenOff()
                    Intent.ACTION_SCREEN_ON -> onScreenOn()
                    Intent.ACTION_USER_PRESENT -> onUserPresent()
                }
            }
        }
        val f = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        // 화면 꺼짐·켜짐은 시스템만 보낼 수 있는 방송이라 EXPORTED 여도 다른 앱이 흉내 못 낸다
        ContextCompat.registerReceiver(this, r, f, ContextCompat.RECEIVER_EXPORTED)
        receiver = r
    }

    private fun onScreenOff() {
        if (!LockPrefs.enabled(this)) return
        val (mode, _) = LockDecider.placesConfig(this)
        if (mode != null && places.stale(LockDecider.MAX_FIX_AGE_MS)) {
            // 위치가 오래됐으면 한 번 새로 받고 정한다 (화면이 꺼져 있는 동안이라 몇 초 걸려도 괜찮다)
            places.requestFresh(8000) { decideAndLaunch("screen_off") }
        } else {
            decideAndLaunch("screen_off")
        }
    }

    private fun onScreenOn() {
        if (!LockPrefs.enabled(this)) return
        // 미리 띄우기가 안 됐으면(늦었거나 실패) 잠금화면이 떠 있는 동안 한 번 더
        if (pendingLock && !LockActivity.alive) decideAndLaunch("screen_on")
    }

    private fun onUserPresent() {
        pendingLock = false
        refreshDecision()
    }

    private fun decideAndLaunch(trigger: String) {
        val d = LockDecider.decide(this, places)
        setDecision(d)
        if (!d.lock) {
            pendingLock = false
            return
        }
        pendingLock = true
        if (!Settings.canDrawOverlays(this)) {
            warnOverlay()
            return
        }
        val pm = getSystemService(PowerManager::class.java)
        val km = getSystemService(KeyguardManager::class.java)
        // 화면이 꺼져 있거나(미리 띄우기) 잠금화면이 떠 있을 때만 — 이미 풀고 쓰는 중이면 끼어들지 않는다
        if (pm != null && km != null && pm.isInteractive && !km.isKeyguardLocked) return
        launch(this, trigger)
    }

    /** 결정을 다시 계산해 알림을 고친다 (자유 시간이 끝나는 시각에도 한 번) */
    private fun refreshDecision() {
        setDecision(LockDecider.decide(this, places))
    }

    private fun setDecision(d: LockGate.Decision) {
        lastDecision = d
        handler.removeCallbacks(refreshTick)
        if (d.reason == "free" && d.until > System.currentTimeMillis()) {
            handler.postDelayed(refreshTick, d.until - System.currentTimeMillis() + 1000)
        }
        updateNotification(this)
    }

    /** '다른 앱 위에 표시'가 꺼져 잠금을 못 띄웠다 — 하루 한 번만 알린다 */
    @SuppressLint("MissingPermission")
    private fun warnOverlay() {
        val p = LockPrefs.prefs(this)
        val today = LockPrefs.dayKey()
        if (p.getString("overlayWarnDay", "") == today) return
        p.edit().putString("overlayWarnDay", today).apply()
        val open = PendingIntent.getActivity(
            this, 1, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(this, CHANNEL_ALERT)
            .setSmallIcon(R.drawable.ic_stat_fitlock)
            .setContentTitle("운동 잠금 화면을 못 띄웠어요")
            .setContentText("'다른 앱 위에 표시'를 켜 주세요. 눌러서 고치기")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(this).notify(NOTIF_WARN_ID, n) } catch (_: SecurityException) {}
    }

    companion object {
        private const val TAG = "FitLockService"
        const val CHANNEL = "lock_status"
        const val CHANNEL_ALERT = "lock_alert"
        const val NOTIF_ID = 1
        const val NOTIF_WARN_ID = 2
        const val ACTION_STOP = "io.github.haho240414.fitlock.STOP"
        const val ACTION_REFRESH = "io.github.haho240414.fitlock.REFRESH"

        @Volatile var running = false
        @Volatile var lastDecision: LockGate.Decision? = null

        fun start(ctx: Context) {
            ContextCompat.startForegroundService(ctx, Intent(ctx, LockService::class.java))
        }

        /** 결정·알림 다시 계산 (설정이 바뀌었거나 잠금 화면이 닫힐 때) */
        fun refresh(ctx: Context) {
            if (!running) return
            try {
                ctx.startService(Intent(ctx, LockService::class.java).setAction(ACTION_REFRESH))
            } catch (e: Exception) {
                lastDecision = LockDecider.decide(ctx, null)
                updateNotification(ctx)
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, LockService::class.java))
            NotificationManagerCompat.from(ctx).cancel(NOTIF_ID)
        }

        /** 운동 화면 띄우기 */
        fun launch(ctx: Context, reason: String) {
            val i = Intent(ctx, LockActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
                .putExtra(LockActivity.EXTRA_REASON, reason)
            try {
                ctx.startActivity(i)
            } catch (e: Exception) {
                Log.w(TAG, "launch", e)
            }
        }

        fun createChannels(ctx: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "잠금 상태", NotificationManager.IMPORTANCE_LOW).apply {
                description = "잠금이 켜져 있는 동안 오늘 기록과 상태를 보여줘요"
                setShowBadge(false)
            })
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ALERT, "잠금 문제 알림", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "권한 때문에 잠금 화면을 못 띄웠을 때 알려줘요"
            })
        }

        private fun fmtTime(t: Long): String = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date(t))

        fun buildNotification(ctx: Context, d: LockGate.Decision?): Notification {
            val cfg = LockPrefs.config(ctx)
            val ex = cfg.optString("exerciseName", "스쿼트").ifEmpty { "스쿼트" }
            val target = cfg.optInt("target", 10)
            val state = when (d?.reason) {
                "free" -> "자유 시간 · ${fmtTime(d?.until ?: 0L)}부터 다시 잠겨요"
                "schedule" -> "지금은 잠금 쉬는 시간대예요"
                "place" -> "정한 장소가 아니라 잠금 쉬는 중이에요"
                "place-unknown" -> "위치를 몰라서 잠금 쉬는 중이에요"
                "call" -> "통화 중이라 쉬는 중이에요"
                "off" -> "잠금 꺼짐"
                else -> "화면을 켜면 $ex ${target}개를 해야 열려요"
            }
            val summary = cfg.optString("summary", "")
            val open = PendingIntent.getActivity(
                ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            return NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_fitlock)
                .setContentTitle(if (summary.isNotEmpty()) summary else "핏락")
                .setContentText(state)
                .setStyle(NotificationCompat.BigTextStyle().bigText(state))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(open)
                .build()
        }

        @SuppressLint("MissingPermission")
        fun updateNotification(ctx: Context) {
            if (!running) return
            try {
                NotificationManagerCompat.from(ctx).notify(NOTIF_ID, buildNotification(ctx, lastDecision))
            } catch (_: SecurityException) {
                // 알림 권한이 없으면 안 보일 뿐 서비스는 돈다
            }
        }
    }
}

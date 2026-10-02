package io.github.haho240414.fitlock

import android.Manifest
import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import org.json.JSONObject

/**
 * 웹 화면 ↔ 잠금 기능. 앱 화면(MainActivity)과 잠금 화면(LockActivity) 둘 다에서 쓴다.
 * 권한 묻기는 Capacitor 기본 requestPermissions({permissions:[별칭]}) 를 쓴다(별칭은 아래 permissions).
 */
@CapacitorPlugin(
    name = "FitLock",
    permissions = [
        Permission(alias = "camera", strings = [Manifest.permission.CAMERA]),
        Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS]),
        Permission(alias = "location", strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION]),
        Permission(alias = "backgroundLocation", strings = [Manifest.permission.ACCESS_BACKGROUND_LOCATION]),
    ],
)
class FitLockPlugin : Plugin() {
    private var places: PlaceChecker? = null

    private fun placeChecker(): PlaceChecker = places ?: PlaceChecker(context).also { places = it }

    private val lockActivity: LockActivity? get() = activity as? LockActivity

    private fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED

    /** 어느 화면인지·기기 정보 */
    @PluginMethod
    fun getInfo(call: PluginCall) {
        val r = JSObject()
        val lock = lockActivity
        r.put("screen", if (lock != null) "lock" else "app")
        r.put("reason", lock?.reasonText ?: "")
        r.put("visible", lock?.isVisibleNow ?: true)
        r.put("barHeight", lock?.estimatedBarDp() ?: 0)
        r.put("sdk", Build.VERSION.SDK_INT)
        r.put("release", Build.VERSION.RELEASE ?: "")
        r.put("manufacturer", Build.MANUFACTURER ?: "")
        r.put("model", Build.MODEL ?: "")
        r.put("debug", (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0)
        r.put("version", try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""
        } catch (_: Exception) { "" })
        call.resolve(r)
    }

    /** 권한·서비스·지금 잠글지 */
    @PluginMethod
    fun getStatus(call: PluginCall) {
        val ctx = context
        val pm = ctx.getSystemService(PowerManager::class.java)
        val km = ctx.getSystemService(KeyguardManager::class.java)
        val r = JSObject()
        r.put("overlay", Settings.canDrawOverlays(ctx))
        r.put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled())
        r.put("battery", pm?.isIgnoringBatteryOptimizations(ctx.packageName) == true)
        r.put("camera", granted(Manifest.permission.CAMERA))
        r.put("location", granted(Manifest.permission.ACCESS_FINE_LOCATION))
        r.put("backgroundLocation", placeChecker().hasFine() && placeChecker().hasBackground())
        r.put("serviceRunning", LockService.running)
        r.put("enabled", LockPrefs.enabled(ctx))
        r.put("unlockedUntil", LockPrefs.unlockedUntil(ctx))
        r.put("skipsToday", LockPrefs.skipsToday(ctx))
        r.put("freeSkipsLeft", LockPrefs.freeSkipsLeft(ctx))
        r.put("keyguardSecure", km?.isDeviceSecure == true)
        r.put("sdk", Build.VERSION.SDK_INT)
        val d = LockDecider.decide(ctx, placeChecker())
        r.put("decision", JSObject().put("lock", d.lock).put("reason", d.reason).put("until", d.until))
        call.resolve(r)
    }

    /** 앱 화면의 잠금 설정을 받아 저장하고 서비스를 켜고 끈다 */
    @PluginMethod
    fun setConfig(call: PluginCall) {
        val cfg = call.getObject("config")
        if (cfg == null) {
            call.reject("config 가 없어요")
            return
        }
        val ctx = context
        LockPrefs.setConfig(ctx, JSONObject(cfg.toString()))
        try {
            if (cfg.optBoolean("enabled", false)) {
                if (LockService.running) LockService.refresh(ctx) else LockService.start(ctx)
            } else {
                LockService.stop(ctx)
            }
        } catch (e: Exception) {
            Log.w(TAG, "service", e)
            call.reject("잠금 서비스를 켜지 못했어요: ${e.message}")
            return
        }
        call.resolve(JSObject().put("serviceRunning", LockService.running))
    }

    /** 상단 알림 요약만 바꾸기 (잠금 화면에서 운동한 뒤 — 앱 화면이 안 열려 있어도) */
    @PluginMethod
    fun setSummary(call: PluginCall) {
        val cfg = LockPrefs.config(context)
        cfg.put("summary", call.getString("summary", "") ?: "")
        LockPrefs.setConfig(context, cfg)
        LockService.refresh(context)
        call.resolve()
    }

    /** 설정 화면 열기: overlay(다른 앱 위에 표시) · app(앱 정보 — 제한된 설정 허용) · notifications · battery */
    @PluginMethod
    fun openSettings(call: PluginCall) {
        val pkg = context.packageName
        val target = call.getString("target", "app")
        val intent = when (target) {
            "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$pkg"))
            "notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
            "battery" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            else -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
        }
        try {
            activity.startActivity(intent)
        } catch (e: Exception) {
            try {
                activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg")))
            } catch (e2: Exception) {
                call.reject("설정을 열지 못했어요")
                return
            }
        }
        call.resolve()
    }

    /** 배터리 최적화에서 빼 달라는 시스템 창 */
    @SuppressLint("BatteryLife")
    @PluginMethod
    fun requestBatteryExemption(call: PluginCall) {
        try {
            activity.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")))
        } catch (e: Exception) {
            try { activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) } catch (_: Exception) {}
        }
        call.resolve()
    }

    /** 잠금 화면: 웹 화면 준비 끝 (안 오면 네이티브가 그냥 열어 준다) */
    @PluginMethod
    fun lockReady(call: PluginCall) {
        activity.runOnUiThread { lockActivity?.onWebReady() }
        call.resolve()
    }

    /** 잠금 화면: 끝 — result: success | pass */
    @PluginMethod
    fun finishLock(call: PluginCall) {
        val result = call.getString("result", "success") ?: "success"
        val lock = lockActivity
        if (lock == null) {
            call.resolve(JSObject().put("closed", false))
            return
        }
        call.resolve(JSObject().put("closed", true))
        activity.runOnUiThread { lock.finishFromWeb(result) }
    }

    /** 잠금 화면: 운동하는 동안 화면이 꺼지지 않게 (seconds 뒤엔 다시 꺼질 수 있게) */
    @PluginMethod
    fun keepAwake(call: PluginCall) {
        val sec = call.data.optInt("seconds", 45)
        lockActivity?.keepAwake(sec)
        call.resolve()
    }

    /** 네이티브가 모아 둔 이벤트(건너뛰기·홈·전화·자동 통과)를 가져가고 비운다 */
    @PluginMethod
    fun drainEvents(call: PluginCall) {
        val arr = LockPrefs.drainEvents(context)
        val out = JSArray()
        for (i in 0 until arr.length()) out.put(arr.get(i))
        call.resolve(JSObject().put("events", out))
    }

    /** 자유 시간 끝내기 — 다음에 화면을 끄면 바로 다시 잠긴다 */
    @PluginMethod
    fun relock(call: PluginCall) {
        LockPrefs.setUnlockedUntil(context, 0L)
        LockService.refresh(context)
        call.resolve()
    }

    /** 앱에서 '잠금화면 보기' — 실제 잠금 화면을 띄워 본다(기록 손해 없음) */
    @PluginMethod
    fun previewLock(call: PluginCall) {
        LockService.launch(activity, LockActivity.REASON_PREVIEW)
        call.resolve()
    }

    @PluginMethod
    fun getRingerMode(call: PluginCall) {
        val am = context.getSystemService(AudioManager::class.java)
        val mode = when (am?.ringerMode) {
            AudioManager.RINGER_MODE_SILENT -> "silent"
            AudioManager.RINGER_MODE_VIBRATE -> "vibrate"
            else -> "normal"
        }
        call.resolve(JSObject().put("mode", mode))
    }

    @PluginMethod
    fun vibrate(call: PluginCall) {
        val ms = call.data.optLong("ms", 30L).coerceIn(5L, 1000L)
        try {
            val v: Vibrator? = if (Build.VERSION.SDK_INT >= 31) {
                context.getSystemService(VibratorManager::class.java)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Vibrator::class.java)
            }
            v?.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (_: Exception) {
        }
        call.resolve()
    }

    /** 지금 위치·와이파이 (장소 등록용) */
    @PluginMethod
    fun getPlace(call: PluginCall) {
        val pc = placeChecker()
        if (!pc.hasFine()) {
            call.reject("위치 권한이 없어요")
            return
        }
        pc.requestFresh(12_000L) { loc ->
            val r = JSObject()
            if (loc != null) {
                r.put("lat", loc.latitude)
                r.put("lng", loc.longitude)
                r.put("accuracy", loc.accuracy.toDouble())
                r.put("ageMs", pc.ageMs(loc))
            }
            val ssid = if (pc.wifiConnected()) pc.ssid() else null
            if (ssid != null) r.put("ssid", ssid)
            call.resolve(r)
        }
    }

    /**
     * 카메라마다 시야각 — 렌즈 초점거리와 센서 크기로 계산한다(웹은 이걸 모른다).
     * WebView 카메라 이름의 번호('camera 2, facing back')가 이 목록의 순서(index)다.
     * WebView 의 줌은 잘라 내기 방식이라 1배 아래(초광각)로 못 내려간다 → 넓게 보려면 따로 보이는 광각 카메라를 골라야 한다.
     */
    @PluginMethod
    fun listCameras(call: PluginCall) {
        val out = JSArray()
        try {
            val cm = context.getSystemService(CameraManager::class.java)
            val ids = cm?.cameraIdList ?: emptyArray()
            ids.forEachIndexed { index, id ->
                val o = JSObject()
                o.put("index", index)
                o.put("id", id)
                try {
                    val c = cm!!.getCameraCharacteristics(id)
                    o.put("facing", when (c.get(CameraCharacteristics.LENS_FACING)) {
                        CameraCharacteristics.LENS_FACING_FRONT -> "front"
                        CameraCharacteristics.LENS_FACING_BACK -> "back"
                        else -> "external"
                    })
                    val focals = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
                    val phys = c.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
                    val pixel = c.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
                    val active = c.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
                    val f = focals?.minOrNull()
                    if (f != null && f > 0f && phys != null) {
                        var w = phys.width.toDouble()
                        var h = phys.height.toDouble()
                        // 실제로 쓰는 영역(active array)만큼만
                        if (pixel != null && active != null && pixel.width > 0 && pixel.height > 0) {
                            w = w * active.width() / pixel.width
                            h = h * active.height() / pixel.height
                        }
                        val deg = { size: Double -> Math.toDegrees(2 * Math.atan(size / (2.0 * f))) }
                        o.put("focal", f.toDouble())
                        o.put("fovLong", deg(maxOf(w, h)))   // 폰을 세로로 세우면 위아래 시야
                        o.put("fovShort", deg(minOf(w, h)))  // 세로로 세우면 좌우 시야
                        o.put("fovDiag", deg(Math.hypot(w, h)))
                    }
                    if (Build.VERSION.SDK_INT >= 30) {
                        c.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)?.let {
                            o.put("zoomMin", it.lower.toDouble())
                            o.put("zoomMax", it.upper.toDouble())
                        }
                    }
                    if (Build.VERSION.SDK_INT >= 28) {
                        val caps = c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)
                        o.put("logical", caps?.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA) == true)
                        o.put("physicalCount", c.physicalCameraIds.size)
                    }
                } catch (e: Exception) {
                    o.put("error", e.message ?: "characteristics")
                }
                out.put(o)
            }
        } catch (e: Exception) {
            call.reject("카메라 목록을 못 읽었어요: ${e.message}")
            return
        }
        call.resolve(JSObject().put("cameras", out))
    }

    @PluginMethod
    fun emergencyCall(call: PluginCall) {
        val lock = lockActivity
        if (lock != null) {
            activity.runOnUiThread { lock.emergencyCall() }
        } else {
            try { activity.startActivity(Intent("com.android.phone.EmergencyDialer.DIAL")) } catch (_: Exception) {
                try { activity.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:112"))) } catch (_: Exception) {}
            }
        }
        call.resolve()
    }

    companion object {
        private const val TAG = "FitLockPlugin"
    }
}

package io.github.haho240414.fitlock

import android.content.Context
import android.media.AudioManager
import android.os.Build
import org.json.JSONArray
import java.util.Calendar

/** 지금 설정·시각·통화·장소로 잠글지 정한다 (계산은 LockGate, 여기선 폰 상태를 모아 넘긴다) */
object LockDecider {
    /** 이보다 오래된 위치는 '모름'으로 본다 */
    const val MAX_FIX_AGE_MS = 20 * 60_000L

    /** 장소를 쓰면 (모드, 장소 목록), 안 쓰면 (null, null) */
    fun placesConfig(ctx: Context): Pair<String?, JSONArray?> {
        val p = LockPrefs.config(ctx).optJSONObject("places") ?: return null to null
        val list = p.optJSONArray("list")
        if (!p.optBoolean("enabled", false) || list == null || list.length() == 0) return null to null
        return p.optString("mode", "only") to list
    }

    /** 전화가 울리거나 통화 중(메신저 음성 통화 포함)인지 — 권한 없이 오디오 모드로 본다 */
    fun inCall(ctx: Context): Boolean {
        val am = ctx.getSystemService(AudioManager::class.java) ?: return false
        val m = am.mode
        if (m == AudioManager.MODE_RINGTONE || m == AudioManager.MODE_IN_CALL || m == AudioManager.MODE_IN_COMMUNICATION) return true
        if (Build.VERSION.SDK_INT >= 30 && m == AudioManager.MODE_CALL_SCREENING) return true
        if (Build.VERSION.SDK_INT >= 33 && (m == AudioManager.MODE_CALL_REDIRECT || m == AudioManager.MODE_COMMUNICATION_REDIRECT)) return true
        return false
    }

    fun decide(ctx: Context, places: PlaceChecker?, now: Long = System.currentTimeMillis()): LockGate.Decision {
        val cfg = LockPrefs.config(ctx)
        val cal = Calendar.getInstance().apply { timeInMillis = now }
        // Calendar: 일=1 … 토=7 → 월=1 … 일=7
        val dow = ((cal.get(Calendar.DAY_OF_WEEK) + 5) % 7) + 1
        val minute = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
        val sched = cfg.optJSONObject("schedule")
        val (mode, list) = placesConfig(ctx)
        val place = if (mode != null && places != null) places.status(list, MAX_FIX_AGE_MS) else LockGate.Place.NOT_USED
        return LockGate.decide(
            enabled = cfg.optBoolean("enabled", false),
            inCall = inCall(ctx),
            now = now,
            unlockedUntil = LockPrefs.unlockedUntil(ctx),
            scheduleOn = sched?.optBoolean("enabled", false) == true,
            windows = LockGate.parseWindows(sched?.optJSONArray("windows")),
            dow = dow,
            minute = minute,
            placeMode = mode,
            place = place,
        )
    }

    /** 운동·건너뛰기 뒤 자유 시간 (분, 설정값) */
    fun freeMinutes(ctx: Context): Int = LockPrefs.config(ctx).optInt("freeMinutes", 60)
}

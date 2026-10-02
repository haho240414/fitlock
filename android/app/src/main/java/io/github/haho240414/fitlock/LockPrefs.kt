package io.github.haho240414.fitlock

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale
import java.util.UUID

/**
 * 잠금 설정(앱 화면이 FitLock.setConfig 로 넘긴 JSON)과 네이티브 쪽 상태를 SharedPreferences 에 둔다.
 * 서비스는 웹 화면 없이도 이것만 보고 잠글지 정한다.
 * - unlockedUntil : 운동·건너뛰기 뒤 그냥 열어 두는 시각
 * - skipDay/skips : 오늘 '이번엔 건너뛰기'를 몇 번 했는지 (버튼 글씨용)
 * - events        : 웹 화면이 못 봤을 수도 있는 일(건너뛰기·홈·전화·자동 통과) → 앱이 열릴 때 웹이 가져가 포인트·기록에 반영
 */
object LockPrefs {
    private const val NAME = "fitlock"

    fun prefs(ctx: Context): SharedPreferences = ctx.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun config(ctx: Context): JSONObject = try {
        JSONObject(prefs(ctx).getString("config", null) ?: "{}")
    } catch (e: Exception) {
        JSONObject()
    }

    fun setConfig(ctx: Context, json: JSONObject) {
        prefs(ctx).edit().putString("config", json.toString()).commit()
    }

    fun enabled(ctx: Context): Boolean = config(ctx).optBoolean("enabled", false)

    fun unlockedUntil(ctx: Context): Long = prefs(ctx).getLong("unlockedUntil", 0L)

    fun setUnlockedUntil(ctx: Context, t: Long) {
        prefs(ctx).edit().putLong("unlockedUntil", t).commit()
    }

    /** 이 기기 시간대의 오늘 'YYYY-MM-DD' */
    fun dayKey(at: Long = System.currentTimeMillis()): String {
        val c = Calendar.getInstance().apply { timeInMillis = at }
        return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
    }

    fun nextMidnight(now: Long = System.currentTimeMillis()): Long {
        val c = Calendar.getInstance().apply {
            timeInMillis = now
            add(Calendar.DAY_OF_MONTH, 1)
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return c.timeInMillis
    }

    fun skipsToday(ctx: Context): Int {
        val p = prefs(ctx)
        return if (p.getString("skipDay", "") == dayKey()) p.getInt("skips", 0) else 0
    }

    fun addSkip(ctx: Context): Int {
        val n = skipsToday(ctx) + 1
        prefs(ctx).edit().putString("skipDay", dayKey()).putInt("skips", n).commit()
        return n
    }

    /** 오늘 기록 손해 없이 남은 건너뛰기 (하루 무료 + 건너뛰기권) */
    fun freeSkipsLeft(ctx: Context): Int {
        val cfg = config(ctx)
        val free = cfg.optInt("skipsPerDay", 3) + cfg.optInt("skipTickets", 0)
        return maxOf(0, free - skipsToday(ctx))
    }

    fun pushEvent(ctx: Context, type: String, extra: JSONObject? = null) {
        val p = prefs(ctx)
        val arr = try { JSONArray(p.getString("events", "[]")) } catch (e: Exception) { JSONArray() }
        val e = JSONObject()
        e.put("id", UUID.randomUUID().toString())
        e.put("type", type)
        e.put("at", System.currentTimeMillis())
        if (extra != null) for (k in extra.keys()) e.put(k, extra.get(k))
        arr.put(e)
        // 너무 쌓이면 오래된 것부터 버린다
        val keep = JSONArray()
        val from = maxOf(0, arr.length() - 200)
        for (i in from until arr.length()) keep.put(arr.get(i))
        p.edit().putString("events", keep.toString()).commit()
    }

    /** 쌓인 이벤트를 꺼내고 비운다 */
    @Synchronized
    fun drainEvents(ctx: Context): JSONArray {
        val p = prefs(ctx)
        val arr = try { JSONArray(p.getString("events", "[]")) } catch (e: Exception) { JSONArray() }
        p.edit().putString("events", "[]").commit()
        return arr
    }
}

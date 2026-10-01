package io.github.haho240414.fitlock

import org.json.JSONArray
import org.json.JSONObject

/**
 * 화면이 꺼질 때 '운동 잠금 화면을 띄울까'를 정하는 순수 계산 (안드로이드 없이 단위 테스트: LockGateTest).
 *
 * 띄우지 않는 경우(위에서부터):
 *  꺼 둠 → 통화 중 → 운동한 뒤 자유 시간 → 잠금 시간대 밖 → 장소 조건(모르면 안 띄움: 사람을 가두지 않는다).
 */
object LockGate {
    /** days: 1=월 … 7=일, start·end: 0시부터 분 (start > end 면 밤을 넘긴다, 같으면 하루 종일) */
    data class Window(val days: Set<Int>, val start: Int, val end: Int)

    enum class Place { NOT_USED, INSIDE, OUTSIDE, UNKNOWN }

    data class Decision(val lock: Boolean, val reason: String, val until: Long = 0L)

    /** "07:30" → 450, 이상하면 -1 */
    fun parseTime(s: String?): Int {
        val m = Regex("""^(\d{1,2}):(\d{2})$""").find(s?.trim() ?: return -1) ?: return -1
        val h = m.groupValues[1].toInt()
        val mi = m.groupValues[2].toInt()
        return if (h in 0..23 && mi in 0..59) h * 60 + mi else -1
    }

    fun parseWindows(arr: JSONArray?): List<Window> {
        if (arr == null) return emptyList()
        val out = ArrayList<Window>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val start = parseTime(o.optString("start"))
            val end = parseTime(o.optString("end"))
            if (start < 0 || end < 0) continue
            val days = HashSet<Int>()
            val d = o.optJSONArray("days")
            if (d != null) for (k in 0 until d.length()) d.optInt(k).takeIf { it in 1..7 }?.let { days.add(it) }
            out.add(Window(days, start, end))
        }
        return out
    }

    /** dow 1=월 … 7=일, minute 0..1439 */
    fun inWindows(windows: List<Window>, dow: Int, minute: Int): Boolean {
        val prev = if (dow == 1) 7 else dow - 1
        return windows.any { w ->
            when {
                w.start == w.end -> dow in w.days
                w.start < w.end -> dow in w.days && minute >= w.start && minute < w.end
                // 밤을 넘기는 시간대(예: 22:00~02:00): 그날 22시 이후 또는 전날 시작해서 오늘 2시 전
                else -> (dow in w.days && minute >= w.start) || (prev in w.days && minute < w.end)
            }
        }
    }

    fun decide(
        enabled: Boolean,
        inCall: Boolean,
        now: Long,
        unlockedUntil: Long,
        scheduleOn: Boolean,
        windows: List<Window>,
        dow: Int,
        minute: Int,
        placeMode: String?, // null = 장소 안 씀, "only" = 이곳에서만 잠금, "except" = 이곳에선 잠금 안 함
        place: Place,
    ): Decision {
        if (!enabled) return Decision(false, "off")
        if (inCall) return Decision(false, "call")
        if (now < unlockedUntil) return Decision(false, "free", unlockedUntil)
        if (scheduleOn && !inWindows(windows, dow, minute)) return Decision(false, "schedule")
        if (placeMode != null && place != Place.NOT_USED) {
            if (place == Place.UNKNOWN) return Decision(false, "place-unknown")
            val inside = place == Place.INSIDE
            if (placeMode == "except" && inside) return Decision(false, "place")
            if (placeMode != "except" && !inside) return Decision(false, "place")
        }
        return Decision(true, "lock")
    }

    /**
     * 운동(또는 건너뛰기) 뒤 언제까지 그냥 열어 둘지.
     * freeMinutes: 0 = 매번, -1 = 하루 한 번(다음 날 0시까지), 그 밖 = 분. minMinutes 보다 짧게는 안 한다.
     */
    fun freeUntil(now: Long, freeMinutes: Int, nextMidnight: Long, minMinutes: Int = 0): Long {
        if (freeMinutes < 0) return maxOf(nextMidnight, now + minMinutes * 60_000L)
        return now + maxOf(freeMinutes, minMinutes) * 60_000L
    }

    /** 두 위경도 사이 거리(m) */
    fun distanceM(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val r = 6371000.0
        val p1 = Math.toRadians(lat1)
        val p2 = Math.toRadians(lat2)
        val dp = Math.toRadians(lat2 - lat1)
        val dl = Math.toRadians(lng2 - lng1)
        val a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2)
        return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }

    /**
     * 장소 판정. places: [{lat,lng,radius,ssid}], fix: 최근 위치(없으면 null), ssid: 지금 연결된 와이파이 이름,
     * wifiKnown: 와이파이 상태를 아는지(연결 안 됨이거나 이름을 읽었으면 true — 권한이 없어 이름이 가려지면 false)
     */
    fun placeStatus(places: JSONArray?, fixLat: Double?, fixLng: Double?, fixAccuracy: Float?, ssid: String?, wifiKnown: Boolean): Place {
        if (places == null || places.length() == 0) return Place.NOT_USED
        val gpsKnown = fixLat != null && fixLng != null
        var allRuledOut = true
        var any = false
        for (i in 0 until places.length()) {
            val p: JSONObject = places.optJSONObject(i) ?: continue
            any = true
            // 장소마다: 아는 방법(와이파이·GPS) 중 하나라도 '여기'면 안, 아는 방법이 '아니다'라고 하면 밖, 아무것도 모르면 모름
            var ruledOut = false
            val pSsid = p.optString("ssid", "").takeIf { it.isNotEmpty() && it != "null" }
            if (pSsid != null && wifiKnown) {
                if (ssid != null && pSsid == ssid) return Place.INSIDE
                ruledOut = true
            }
            if (p.has("lat") && !p.isNull("lat") && p.has("lng") && !p.isNull("lng") && gpsKnown) {
                val radius = p.optDouble("radius", 150.0).coerceIn(50.0, 2000.0)
                val slack = minOf((fixAccuracy ?: 0f).toDouble(), radius)
                if (distanceM(p.getDouble("lat"), p.getDouble("lng"), fixLat!!, fixLng!!) <= radius + slack) return Place.INSIDE
                ruledOut = true
            }
            if (!ruledOut) allRuledOut = false
        }
        return if (any && allRuledOut) Place.OUTSIDE else if (any) Place.UNKNOWN else Place.NOT_USED
    }
}

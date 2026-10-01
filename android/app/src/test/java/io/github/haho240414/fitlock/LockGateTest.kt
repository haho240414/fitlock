package io.github.haho240414.fitlock

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LockGateTest {
    private val everyDay = setOf(1, 2, 3, 4, 5, 6, 7)
    private val day7to23 = LockGate.Window(everyDay, 7 * 60, 23 * 60)

    private fun decide(
        enabled: Boolean = true, inCall: Boolean = false, now: Long = 1_000_000L, unlockedUntil: Long = 0L,
        scheduleOn: Boolean = false, windows: List<LockGate.Window> = listOf(day7to23), dow: Int = 3, minute: Int = 12 * 60,
        placeMode: String? = null, place: LockGate.Place = LockGate.Place.NOT_USED,
    ) = LockGate.decide(enabled, inCall, now, unlockedUntil, scheduleOn, windows, dow, minute, placeMode, place)

    @Test fun parseTime() {
        assertEquals(450, LockGate.parseTime("07:30"))
        assertEquals(0, LockGate.parseTime("0:00"))
        assertEquals(-1, LockGate.parseTime("24:00"))
        assertEquals(-1, LockGate.parseTime("abc"))
        assertEquals(-1, LockGate.parseTime(null))
    }

    @Test fun windows() {
        assertTrue(LockGate.inWindows(listOf(day7to23), 1, 7 * 60))
        assertFalse(LockGate.inWindows(listOf(day7to23), 1, 23 * 60))
        assertFalse(LockGate.inWindows(listOf(day7to23), 1, 6 * 60 + 59))
        // 평일만
        val weekdays = LockGate.Window(setOf(1, 2, 3, 4, 5), 9 * 60, 18 * 60)
        assertTrue(LockGate.inWindows(listOf(weekdays), 5, 10 * 60))
        assertFalse(LockGate.inWindows(listOf(weekdays), 6, 10 * 60))
        // 밤을 넘김: 금요일 22시~토요일 2시
        val night = LockGate.Window(setOf(5), 22 * 60, 2 * 60)
        assertTrue(LockGate.inWindows(listOf(night), 5, 23 * 60))
        assertTrue(LockGate.inWindows(listOf(night), 6, 60))
        assertFalse(LockGate.inWindows(listOf(night), 6, 3 * 60))
        assertFalse(LockGate.inWindows(listOf(night), 5, 60))
        // 시작 = 끝 → 그날 하루 종일
        assertTrue(LockGate.inWindows(listOf(LockGate.Window(setOf(2), 0, 0)), 2, 13 * 60))
        assertFalse(LockGate.inWindows(emptyList(), 2, 13 * 60))
    }

    @Test fun parseWindowsFromJson() {
        val arr = JSONArray("""[{"days":[1,2,3],"start":"07:00","end":"23:00"},{"days":[9],"start":"x","end":"10:00"}]""")
        val w = LockGate.parseWindows(arr)
        assertEquals(1, w.size)
        assertEquals(setOf(1, 2, 3), w[0].days)
        assertEquals(420, w[0].start)
    }

    @Test fun decideOrder() {
        assertEquals("off", decide(enabled = false).reason)
        assertEquals("call", decide(inCall = true).reason)
        val free = decide(now = 100, unlockedUntil = 200)
        assertEquals("free", free.reason)
        assertEquals(200L, free.until)
        assertEquals("lock", decide(now = 300, unlockedUntil = 200).reason)
        assertEquals("schedule", decide(scheduleOn = true, minute = 23 * 60 + 30).reason)
        assertTrue(decide(scheduleOn = true, minute = 8 * 60).lock)
        assertTrue(decide(scheduleOn = false, minute = 3 * 60).lock) // 시간대를 끄면 언제나
    }

    @Test fun decidePlaces() {
        assertTrue(decide(placeMode = "only", place = LockGate.Place.INSIDE).lock)
        assertEquals("place", decide(placeMode = "only", place = LockGate.Place.OUTSIDE).reason)
        assertEquals("place", decide(placeMode = "except", place = LockGate.Place.INSIDE).reason)
        assertTrue(decide(placeMode = "except", place = LockGate.Place.OUTSIDE).lock)
        // 모르면 잠그지 않는다
        assertEquals("place-unknown", decide(placeMode = "only", place = LockGate.Place.UNKNOWN).reason)
        assertEquals("place-unknown", decide(placeMode = "except", place = LockGate.Place.UNKNOWN).reason)
        // 장소 목록이 비면(NOT_USED) 장소 조건 없음
        assertTrue(decide(placeMode = "only", place = LockGate.Place.NOT_USED).lock)
    }

    @Test fun freeUntil() {
        val now = 1_000_000L
        assertEquals(now + 60 * 60_000L, LockGate.freeUntil(now, 60, now + 999_999_999L))
        assertEquals(now, LockGate.freeUntil(now, 0, now + 999L))
        assertEquals(now + 10 * 60_000L, LockGate.freeUntil(now, 0, now + 999L, minMinutes = 10))
        assertEquals(now + 5_000_000L, LockGate.freeUntil(now, -1, now + 5_000_000L))
        // 하루 한 번인데 자정이 코앞이면 최소 시간은 지킨다
        assertEquals(now + 30 * 60_000L, LockGate.freeUntil(now, -1, now + 1000L, minMinutes = 30))
    }

    @Test fun places() {
        val home = JSONObject().put("lat", 37.5665).put("lng", 126.9780).put("radius", 150).put("ssid", "MyHome")
        val list = JSONArray().put(home)
        // 와이파이 이름이 같으면 안
        assertEquals(LockGate.Place.INSIDE, LockGate.placeStatus(list, null, null, null, "MyHome", true))
        // 반경 안 (약 100m)
        assertEquals(LockGate.Place.INSIDE, LockGate.placeStatus(list, 37.5674, 126.9780, 20f, null, false))
        // 멀리 (약 1.1km) → 밖
        assertEquals(LockGate.Place.OUTSIDE, LockGate.placeStatus(list, 37.5765, 126.9780, 20f, null, false))
        // 위치도 와이파이도 모름 → 모름
        assertEquals(LockGate.Place.UNKNOWN, LockGate.placeStatus(list, null, null, null, null, false))
        // 다른 와이파이 + 위치 모름 → 밖 (아는 방법이 '아니다')
        assertEquals(LockGate.Place.OUTSIDE, LockGate.placeStatus(list, null, null, null, "Cafe", true))
        // 정확도가 나빠도 반경만큼은 봐준다 (250m 떨어짐, 정확도 200m, 반경 150 → 150+150=300 안)
        assertEquals(LockGate.Place.INSIDE, LockGate.placeStatus(list, 37.5687, 126.9780, 200f, null, false))
        // 장소 두 곳: GPS 전용 + 와이파이 전용. 와이파이만 알고 위치 모름 → GPS 장소는 모름 → 모름
        val two = JSONArray().put(JSONObject().put("lat", 37.0).put("lng", 127.0).put("radius", 150))
            .put(JSONObject().put("ssid", "Office"))
        assertEquals(LockGate.Place.UNKNOWN, LockGate.placeStatus(two, null, null, null, "Cafe", true))
        assertEquals(LockGate.Place.INSIDE, LockGate.placeStatus(two, null, null, null, "Office", true))
        assertEquals(LockGate.Place.NOT_USED, LockGate.placeStatus(JSONArray(), 37.0, 127.0, 10f, null, true))
    }

    @Test fun distance() {
        val d = LockGate.distanceM(37.5665, 126.9780, 37.5765, 126.9780)
        assertTrue(d > 1100 && d < 1120)
    }
}

package io.github.haho240414.fitlock

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONArray

/**
 * '지금 정한 장소(집 등)에 있나' — 위치와 와이파이 이름으로 본다. 위치는 이 폰 안에서만 쓴다.
 * 배터리를 아끼려고 GPS 를 계속 켜지 않는다: 다른 앱이 받은 위치를 같이 듣고(PASSIVE), 오래된 위치면 그때만 한 번 새로 받는다.
 * 권한이 없거나 모르면 UNKNOWN → 잠그지 않는다(사람을 가두지 않는다).
 */
class PlaceChecker(context: Context) {
    private val ctx = context.applicationContext
    private val lm = ctx.getSystemService(LocationManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var last: Location? = null
    private var passive: LocationListener? = null

    fun hasFine(): Boolean =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun hasBackground(): Boolean =
        Build.VERSION.SDK_INT < 29 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun startPassive() {
        if (passive != null || !hasFine() || lm == null) return
        val l = Listener { loc -> remember(loc) }
        try {
            lm.requestLocationUpdates(LocationManager.PASSIVE_PROVIDER, 60_000L, 0f, l, Looper.getMainLooper())
            passive = l
        } catch (e: Exception) {
            Log.w(TAG, "passive", e)
        }
    }

    fun stopPassive() {
        passive?.let { try { lm?.removeUpdates(it) } catch (_: Exception) {} }
        passive = null
    }

    private fun remember(loc: Location?) {
        if (loc == null) return
        val cur = last
        if (cur == null || loc.elapsedRealtimeNanos >= cur.elapsedRealtimeNanos) last = loc
    }

    /** 가장 최근 위치 (여러 공급자 중) */
    @SuppressLint("MissingPermission")
    fun bestLastKnown(): Location? {
        if (!hasFine() || lm == null) return last
        val providers = ArrayList<String>()
        if (Build.VERSION.SDK_INT >= 31) providers.add(LocationManager.FUSED_PROVIDER)
        providers.add(LocationManager.GPS_PROVIDER)
        providers.add(LocationManager.NETWORK_PROVIDER)
        providers.add(LocationManager.PASSIVE_PROVIDER)
        for (p in providers) {
            try { remember(lm.getLastKnownLocation(p)) } catch (_: Exception) {}
        }
        return last
    }

    /** 위치가 몇 ms 전 것인지 */
    fun ageMs(loc: Location): Long = (SystemClock.elapsedRealtimeNanos() - loc.elapsedRealtimeNanos) / 1_000_000L

    /** 위치 한 번 새로 받기 (timeoutMs 안에 안 오면 아는 것 중 가장 최근 것) */
    @SuppressLint("MissingPermission")
    fun requestFresh(timeoutMs: Long, cb: (Location?) -> Unit) {
        if (!hasFine() || lm == null) { cb(null); return }
        val provider = when {
            Build.VERSION.SDK_INT >= 31 && lm.hasProvider(LocationManager.FUSED_PROVIDER) && lm.isProviderEnabled(LocationManager.FUSED_PROVIDER) -> LocationManager.FUSED_PROVIDER
            lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            lm.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            else -> null
        }
        if (provider == null) { cb(bestLastKnown()); return }
        var done = false
        val finish = { loc: Location? ->
            if (!done) {
                done = true
                remember(loc)
                cb(loc ?: bestLastKnown())
            }
        }
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                val signal = CancellationSignal()
                handler.postDelayed({ signal.cancel(); finish(null) }, timeoutMs)
                lm.getCurrentLocation(provider, signal, ctx.mainExecutor) { loc -> handler.post { finish(loc) } }
            } else {
                val holder = arrayOfNulls<Listener>(1)
                val l = Listener { loc ->
                    holder[0]?.let { lm.removeUpdates(it) }
                    finish(loc)
                }
                holder[0] = l
                @Suppress("DEPRECATION")
                lm.requestSingleUpdate(provider, l, Looper.getMainLooper())
                handler.postDelayed({
                    try { lm.removeUpdates(l) } catch (_: Exception) {}
                    finish(null)
                }, timeoutMs)
            }
        } catch (e: Exception) {
            Log.w(TAG, "requestFresh", e)
            finish(null)
        }
    }

    /** 와이파이에 연결돼 있는지 (권한 없이 알 수 있다) */
    fun wifiConnected(): Boolean = try {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        cm?.getNetworkCapabilities(cm.activeNetwork)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    } catch (_: Exception) {
        false
    }

    /** 연결된 와이파이 이름 (위치 권한이 없으면 가려져서 null) */
    fun ssid(): String? = try {
        val wm = ctx.getSystemService(WifiManager::class.java)
        @Suppress("DEPRECATION")
        val s = wm?.connectionInfo?.ssid
        if (s == null || s == WifiManager.UNKNOWN_SSID || s.isBlank() || s == "<unknown ssid>") null else s.trim('"')
    } catch (_: Exception) {
        null
    }

    /** places(JSON 목록) 기준 지금 위치. maxAgeMs 보다 오래된 위치는 모르는 것으로 본다 */
    fun status(places: JSONArray?, maxAgeMs: Long): LockGate.Place {
        val loc = bestLastKnown()?.takeIf { ageMs(it) <= maxAgeMs }
        val connected = wifiConnected()
        val ssid = if (connected) ssid() else null
        val wifiKnown = !connected || ssid != null
        return LockGate.placeStatus(places, loc?.latitude, loc?.longitude, loc?.accuracy, ssid, wifiKnown)
    }

    /** 오래된 위치라 새로 받을 필요가 있는지 */
    fun stale(maxAgeMs: Long): Boolean = bestLastKnown()?.let { ageMs(it) > maxAgeMs } ?: true

    /**
     * 안드로이드 10 이하에선 onStatusChanged 등이 기본 구현 없는 메서드라, 람다 하나로 만든 리스너는
     * 시스템이 그걸 부를 때 앱이 죽는다 → 전부 구현한 클래스를 쓴다.
     */
    private class Listener(val f: (Location) -> Unit) : LocationListener {
        override fun onLocationChanged(location: Location) = f(location)
        @Deprecated("API 29 이하 호환")
        override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
    }

    companion object {
        private const val TAG = "FitLockPlace"
    }
}

package io.github.haho240414.fitlock

import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.OnBackPressedCallback
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.BridgeActivity
import com.getcapacitor.CapConfig
import org.json.JSONObject
import java.io.File
import java.lang.ref.WeakReference

/**
 * 잠금화면 '위에' 뜨는 운동 화면. 시스템 잠금(PIN·지문)을 바꾸지 않는다 — 그 위에 화면을 하나 더 띄울 뿐이다.
 * 웹 화면은 lock.html (같은 웹앱, 같은 저장소). 아래 버튼 줄('긴급 전화'·'급할 때 그냥 열기')은 네이티브라서
 * 웹 화면이 멈추거나 죽어도 언제나 눌린다.
 *
 * 사람을 가두지 않기:
 *  - 전화가 울리거나 통화 중이면 바로 닫힌다
 *  - 웹 화면이 WATCHDOG_MS 안에 준비되지 않으면 그냥 열어 준다
 *  - 홈·최근 앱 버튼으로도 나갈 수 있다 (건너뛰기로 기록)
 */
class LockActivity : BridgeActivity() {
    private val handler = Handler(Looper.getMainLooper())
    private var reason = "screen_off"
    private var webReady = false
    private var closing = false
    private var leavingOnPurpose = false
    private var resumedNow = false
    private var lastVisible: Boolean? = null
    private var skipBtn: Button? = null
    private var bar: LinearLayout? = null
    private var screenReceiver: BroadcastReceiver? = null
    private var modeListener: Any? = null
    var barHeightDp = 0
        private set

    private val watchdog = Runnable { if (!webReady && !closing) passThrough("watchdog") }
    private val clearAwake = Runnable { window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    private val callPoll = object : Runnable {
        override fun run() {
            if (closing) return
            if (LockDecider.inCall(this@LockActivity)) {
                stepAside()
                return
            }
            handler.postDelayed(this, 700)
        }
    }

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        // 잠금화면 위에 보이기 (화면을 켜지는 않는다 — 화면이 꺼질 때 미리 띄워 두고, 사용자가 켜면 보인다)
        if (Build.VERSION.SDK_INT >= 27) setShowWhenLocked(true)
        else window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        registerPlugin(FitLockPlugin::class.java)
        config = lockConfig()
        super.onCreate(savedInstanceState)
        alive = true
        current = WeakReference(this)
        reason = intent?.getStringExtra(EXTRA_REASON) ?: reason
        window.setBackgroundDrawable(ColorDrawable(BG))
        // 카메라 영상(video)을 탭 없이 재생 (카메라 켜기는 비동기라 탭 제스처가 끊긴 뒤 재생됨)
        bridge?.webView?.settings?.mediaPlaybackRequiresUserGesture = false
        addNativeBar()
        // 뒤로 가기로는 닫히지 않는다 (급할 땐 아래 버튼). 앱 플러그인보다 나중에 등록해서 먼저 받는다
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {}
        })
        registerScreen()
        watchCalls()
        handler.postDelayed(watchdog, WATCHDOG_MS)
        if (LockDecider.inCall(this)) stepAside()
    }

    /** 같은 웹앱을 쓰되 lock.html 로 시작하는 설정 (capacitor.config.json 을 읽어 시작 경로만 바꾼다) */
    private fun lockConfig(): CapConfig? = try {
        val json = JSONObject(assets.open("capacitor.config.json").bufferedReader().use { it.readText() })
        val server = json.optJSONObject("server") ?: JSONObject().also { json.put("server", it) }
        server.put("appStartPath", "/lock.html")
        val dir = File(filesDir, "lockcfg").apply { mkdirs() }
        File(dir, "capacitor.config.json").writeText(json.toString())
        CapConfig.loadFromFile(this, dir.absolutePath)
    } catch (e: Exception) {
        Log.w(TAG, "lock config", e)
        null
    }

    private fun dp(v: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun pill(text: String, bg: Int, fg: Int, onClick: () -> Unit): Button = Button(this).apply {
        this.text = text
        isAllCaps = false
        maxLines = 2
        setTextColor(fg)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        typeface = Typeface.DEFAULT_BOLD
        background = GradientDrawable().apply {
            cornerRadius = dp(14).toFloat()
            setColor(bg)
        }
        stateListAnimator = null
        setPadding(dp(6), 0, dp(6), 0)
        setOnClickListener { onClick() }
    }

    private fun addNativeBar() {
        val root = findViewById<ViewGroup>(android.R.id.content) ?: return
        val b = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(0xE60B0E1A.toInt())
            setPadding(dp(12), dp(8), dp(12), dp(12))
        }
        val emergency = pill("🚨 긴급 전화", 0xFF3A1A22.toInt(), 0xFFFF8A95.toInt()) { emergencyCall() }
        emergency.contentDescription = "긴급 전화 걸기"
        val skip = pill(skipLabel(), 0xFF1C2240.toInt(), Color.WHITE) { skip("skip") }
        skip.contentDescription = "급할 때 운동 없이 그냥 열기"
        b.addView(emergency, LinearLayout.LayoutParams(0, dp(54), 1f).apply { marginEnd = dp(8) })
        b.addView(skip, LinearLayout.LayoutParams(0, dp(54), 1.6f))
        root.addView(b, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        ViewCompat.setOnApplyWindowInsetsListener(b) { v, insets ->
            val bottom = insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom
            v.setPadding(dp(12), dp(8), dp(12), dp(12) + bottom)
            v.post { pushBarHeight() }
            insets
        }
        b.post { pushBarHeight() }
        bar = b
        skipBtn = skip
    }

    private fun skipLabel(): String {
        if (reason == REASON_PREVIEW) return "닫기 (미리 보기)"
        val left = LockPrefs.freeSkipsLeft(this)
        return if (left > 0) "급할 때 그냥 열기\n무료 ${left}번 남음" else "급할 때 그냥 열기\n(기록에 남아요)"
    }

    /** 웹 화면이 아래 버튼 줄에 가리지 않게 높이를 알려 준다 */
    private fun pushBarHeight() {
        val h = bar?.height ?: return
        if (h <= 0) return
        barHeightDp = Math.round(h / resources.displayMetrics.density)
        bridge?.webView?.evaluateJavascript("document.documentElement.style.setProperty('--native-bar','${barHeightDp}px')", null)
    }

    /** 처음 그리기 전 어림값 */
    fun estimatedBarDp(): Int = if (barHeightDp > 0) barHeightDp else 54 + 8 + 12 + 24

    val reasonText: String get() = reason

    /** 화면이 켜져 있고 이 화면이 맨 앞인지 */
    val isVisibleNow: Boolean get() = lastVisible == true

    private fun updateVisible() {
        val screenOn = getSystemService(PowerManager::class.java)?.isInteractive != false
        val v = resumedNow && screenOn
        if (v == lastVisible) return
        lastVisible = v
        showing = v
        // 웹 화면: 보일 때만 센서·카메라를 켠다
        bridge?.triggerWindowJSEvent(if (v) "fitlock:visible" else "fitlock:hidden")
        if (v) {
            keepAwake(30)
            skipBtn?.text = skipLabel()
        }
    }

    override fun onResume() {
        super.onResume()
        resumedNow = true
        updateVisible()
        handler.removeCallbacks(callPoll)
        handler.post(callPoll)
    }

    override fun onPause() {
        super.onPause()
        resumedNow = false
        updateVisible()
    }

    override fun onStop() {
        super.onStop()
        resumedNow = false
        updateVisible()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_REASON)?.let { reason = it }
        skipBtn?.text = skipLabel()
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // 홈·최근 앱 버튼으로 나감 → 막지 않고 건너뛰기로 기록
        if (!closing && !leavingOnPurpose) skip("home")
    }

    override fun onDestroy() {
        alive = false
        showing = false
        handler.removeCallbacksAndMessages(null)
        screenReceiver?.let { try { unregisterReceiver(it) } catch (_: Exception) {} }
        screenReceiver = null
        unwatchCalls()
        super.onDestroy()
    }

    private fun registerScreen() {
        val r = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) { updateVisible() }
        }
        val f = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
        }
        ContextCompat.registerReceiver(this, r, f, ContextCompat.RECEIVER_EXPORTED)
        screenReceiver = r
    }

    /** 전화가 오면(울림·통화·메신저 통화) 바로 비킨다 — 안드로이드 12+ 는 오디오 모드 변화를 듣고, 그 밖엔 0.7초마다 본다 */
    private fun watchCalls() {
        if (Build.VERSION.SDK_INT < 31) return
        val am = getSystemService(AudioManager::class.java) ?: return
        val l = AudioManager.OnModeChangedListener { if (LockDecider.inCall(this)) handler.post { stepAside() } }
        try {
            am.addOnModeChangedListener(mainExecutor, l)
            modeListener = l
        } catch (e: Exception) {
            Log.w(TAG, "mode listener", e)
        }
    }

    private fun unwatchCalls() {
        if (Build.VERSION.SDK_INT < 31) return
        val l = modeListener as? AudioManager.OnModeChangedListener ?: return
        try { getSystemService(AudioManager::class.java)?.removeOnModeChangedListener(l) } catch (_: Exception) {}
        modeListener = null
    }

    /* ---------- 닫기 ---------- */

    private fun now() = System.currentTimeMillis()

    private fun freeUntil(minMinutes: Int) =
        LockGate.freeUntil(now(), LockDecider.freeMinutes(this), LockPrefs.nextMidnight(now()), minMinutes)

    /** 전화: 기록 손해 없이 바로 비키고, 통화 뒤 10분은 잠그지 않는다 */
    private fun stepAside() {
        if (closing) return
        closing = true
        if (reason != REASON_PREVIEW) {
            LockPrefs.pushEvent(this, "call")
            LockPrefs.setUnlockedUntil(this, now() + 10 * 60_000L)
        }
        bridge?.triggerWindowJSEvent("fitlock:hidden")
        LockService.refresh(this)
        finishNow()
    }

    /** 급할 때 그냥 열기 / 홈 버튼으로 나감. 운동 없이도 언제나 열린다 */
    private fun skip(type: String) {
        if (closing) return
        closing = true
        if (reason != REASON_PREVIEW) {
            LockPrefs.addSkip(this)
            LockPrefs.pushEvent(this, type)
            // 급할 때 연 거라 바로 다시 잠기지 않게 최소 10분
            LockPrefs.setUnlockedUntil(this, freeUntil(10))
        }
        bridge?.triggerWindowJSEvent("fitlock:hidden")
        LockService.refresh(this)
        if (type == "home") finishNow() else dismissKeyguardThenFinish()
    }

    /** 웹 화면이 준비되지 않음(멈춤·오류) → 그냥 열어 준다 */
    private fun passThrough(why: String) {
        if (closing) return
        closing = true
        if (reason != REASON_PREVIEW) {
            LockPrefs.pushEvent(this, "pass", JSONObject().put("reason", why))
            LockPrefs.setUnlockedUntil(this, now() + 30 * 60_000L)
        }
        LockService.refresh(this)
        finishNow()
    }

    /** 긴급 전화: 긴급 통화 화면을 열고(잠금 상태에서도 쓸 수 있다) 이 화면은 비킨다 */
    fun emergencyCall() {
        if (closing) return
        closing = true
        leavingOnPurpose = true
        if (reason != REASON_PREVIEW) {
            LockPrefs.pushEvent(this, "pass", JSONObject().put("reason", "emergency"))
            LockPrefs.setUnlockedUntil(this, now() + 30 * 60_000L)
        }
        val tries = listOf(
            Intent("com.android.phone.EmergencyDialer.DIAL"),
            Intent(Intent.ACTION_DIAL, Uri.parse("tel:112")),
        )
        for (i in tries) {
            try {
                startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                break
            } catch (_: Exception) {
            }
        }
        LockService.refresh(this)
        finishNow()
    }

    /** 웹 화면이 끝을 알림: success(운동 다 함) / pass(센서·카메라를 못 써서 그냥 열어 줌) */
    fun finishFromWeb(result: String) {
        if (closing) return
        closing = true
        if (reason != REASON_PREVIEW) {
            LockPrefs.setUnlockedUntil(this, if (result == "success") freeUntil(0) else freeUntil(30))
        }
        LockService.refresh(this)
        dismissKeyguardThenFinish()
    }

    fun onWebReady() {
        webReady = true
        handler.removeCallbacks(watchdog)
        pushBarHeight()
    }

    fun keepAwake(seconds: Int) {
        runOnUiThread {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            handler.removeCallbacks(clearAwake)
            handler.postDelayed(clearAwake, seconds.coerceIn(5, 300) * 1000L)
        }
    }

    /** 잠금(키가드)이 걸려 있으면 시스템 잠금 해제(PIN·지문)를 띄우고, 끝나면 닫는다 */
    private fun dismissKeyguardThenFinish() {
        val km = getSystemService(KeyguardManager::class.java)
        if (km != null && km.isKeyguardLocked) {
            try {
                km.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                    override fun onDismissSucceeded() { finishNow() }
                    override fun onDismissCancelled() { finishNow() }
                    override fun onDismissError() { finishNow() }
                })
                handler.postDelayed({ finishNow() }, 20_000)
                return
            } catch (e: Exception) {
                Log.w(TAG, "requestDismissKeyguard", e)
            }
        }
        finishNow()
    }

    private fun finishNow() {
        if (!isFinishing && !isDestroyed) finishAndRemoveTask()
    }

    companion object {
        private const val TAG = "FitLockLock"
        const val EXTRA_REASON = "reason"
        const val REASON_PREVIEW = "preview"
        private const val WATCHDOG_MS = 12_000L
        private val BG = 0xFF0B0E1A.toInt()

        @Volatile var alive = false
        @Volatile var showing = false
        var current: WeakReference<LockActivity>? = null
    }
}

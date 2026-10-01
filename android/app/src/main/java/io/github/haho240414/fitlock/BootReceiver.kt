package io.github.haho240414.fitlock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** 폰을 다시 켰거나 앱을 업데이트했을 때 잠금이 켜져 있었으면 서비스를 다시 켠다 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                if (!LockPrefs.enabled(ctx)) return
                try {
                    LockService.start(ctx)
                } catch (e: Exception) {
                    // 일부 폰은 여기서도 막는다 → 앱을 한 번 열면 다시 켜진다
                    Log.w("FitLockBoot", "start", e)
                }
            }
        }
    }
}

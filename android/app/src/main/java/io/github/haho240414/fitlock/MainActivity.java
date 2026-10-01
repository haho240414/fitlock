package io.github.haho240414.fitlock;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 이 앱 안의 플러그인: 잠금 서비스·권한·잠금 화면·장소 (FitLockPlugin.kt)
        registerPlugin(FitLockPlugin.class);
        super.onCreate(savedInstanceState);
        // 카메라 영상(video)을 탭 없이 재생 ('지금 운동하기'에서 카메라 모드)
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
